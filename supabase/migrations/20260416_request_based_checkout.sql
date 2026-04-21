-- ============================================================
-- Request-based checkout system
--
-- Two new RPCs to replace direct checkout with planned requests:
--
-- 1. check_absence_quota  — pre-flight quota check for the request form.
--    Returns space availability + list of conflicting students.
--
-- 2. auto_checkout_students — called every ~60 s from the dashboard.
--    Fires CHECK_OUT events for students whose approved request
--    startTime has arrived.
-- ============================================================


-- ─── 1. check_absence_quota ──────────────────────────────────────────────────
--
-- Bug fixes applied (see fix_check_absence_quota_type_casts migration):
-- 1. p_exclude_student_id was UUID but absence_requests.studentId is TEXT → crash
-- 2. p_date/p_end_date were DATE but absence_requests.date is TEXT → crash
-- 3. Urgent approved requests were counted toward quota (they must be exempt)
-- 4. Stale approved requests from already-returned students consumed quota slots

CREATE OR REPLACE FUNCTION check_absence_quota(
  p_class_id            TEXT,
  p_date                TEXT,    -- YYYY-MM-DD
  p_end_date            TEXT,    -- YYYY-MM-DD (same as p_date for single-day)
  p_start_time          TEXT,    -- HH:MM
  p_end_time            TEXT,    -- HH:MM
  p_exclude_student_id  TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_class_size    INT;
  v_quota         INT;
  v_current_count INT;
  v_overlapping   JSONB;
  v_today         TEXT;
  v_now_time      TEXT;
BEGIN
  v_today    := (NOW() AT TIME ZONE 'Asia/Jerusalem')::DATE::TEXT;
  v_now_time := TO_CHAR(NOW() AT TIME ZONE 'Asia/Jerusalem', 'HH24:MI');

  -- Class size (all students in class)
  SELECT COUNT(*) INTO v_class_size
  FROM students
  WHERE "classId" = p_class_id;

  -- Dynamic quota: ~3 slots per 25 students (minimum 1)
  v_quota := GREATEST(1, ROUND((v_class_size * 3)::numeric / 25));

  -- Count approved, non-urgent requests overlapping in date AND time.
  -- A request only consumes a slot if the student is still outside,
  -- or their departure is in the future (prevents stale approved requests
  -- from blocking new departures after students return early).
  SELECT
    COUNT(*),
    COALESCE(
      jsonb_agg(jsonb_build_object(
        'studentName', s."fullName",
        'endDate',     ar."endDate",
        'endTime',     ar."endTime"
      )),
      '[]'::jsonb
    )
  INTO v_current_count, v_overlapping
  FROM absence_requests ar
  JOIN students s ON ar."studentId" = s.id
  WHERE s."classId" = p_class_id
    AND ar.status = 'APPROVED'
    -- Urgent requests are quota-exempt
    AND (ar."isUrgent" IS NULL OR ar."isUrgent" = false)
    -- Exclude the submitting student's own requests
    AND (p_exclude_student_id IS NULL OR ar."studentId" != p_exclude_student_id)
    -- Date range overlap (TEXT YYYY-MM-DD comparison is lexicographically correct)
    AND ar.date                             <= p_end_date
    AND COALESCE(ar."endDate", ar.date)     >= p_date
    -- Time range overlap
    AND ar."startTime" < p_end_time
    AND ar."endTime"   > p_start_time
    -- Only count if student is still outside OR departure hasn't happened yet
    AND (
      s."currentStatus" IN ('OFF_CAMPUS', 'OVERDUE')
      OR (
        s."currentStatus" = 'ON_CAMPUS'
        AND (
          ar.date > v_today
          OR (ar.date = v_today AND ar."startTime" > v_now_time)
        )
      )
    );

  RETURN jsonb_build_object(
    'hasSpace',    v_current_count < v_quota,
    'current',     v_current_count,
    'quota',       v_quota,
    'overlapping', v_overlapping
  );
END;
$$;

GRANT EXECUTE ON FUNCTION check_absence_quota(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION check_absence_quota(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon;


-- ─── 2. auto_checkout_students ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION auto_checkout_students()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count     INT := 0;
  v_rec       RECORD;
  v_now_jlm   TIMESTAMPTZ;
  v_today     DATE;
  v_now_time  TEXT;
  v_end_date  DATE;
  v_return_ts TIMESTAMPTZ;
BEGIN
  v_now_jlm  := NOW() AT TIME ZONE 'Asia/Jerusalem';
  v_today    := (v_now_jlm)::DATE;
  v_now_time := TO_CHAR(v_now_jlm, 'HH24:MI');

  -- Find ON_CAMPUS students whose earliest approved request has started today
  FOR v_rec IN
    SELECT DISTINCT ON (ar."studentId")
      ar."studentId",
      ar.reason,
      ar."endDate",
      ar."endTime"
    FROM absence_requests ar
    JOIN students s ON ar."studentId" = s.id
    WHERE ar.status = 'APPROVED'
      AND s."currentStatus" = 'ON_CAMPUS'
      -- Request spans today
      AND ar.date                             <= v_today
      AND COALESCE(ar."endDate", ar.date)     >= v_today
      -- Start time has passed
      AND ar."startTime"                      <= v_now_time
      -- End time has not yet passed
      AND (
        COALESCE(ar."endDate", ar.date) > v_today
        OR ar."endTime" > v_now_time
      )
    ORDER BY ar."studentId", ar.date ASC, ar."startTime" ASC
  LOOP
    v_end_date  := COALESCE(v_rec."endDate"::DATE, v_today);
    v_return_ts := (v_end_date::TEXT || ' ' || v_rec."endTime" || ':00')::TIMESTAMP
                   AT TIME ZONE 'Asia/Jerusalem';

    INSERT INTO events (
      id, "studentId", type, timestamp, reason,
      "expectedReturn", "gpsStatus", "syncedAt"
    ) VALUES (
      gen_random_uuid(),
      v_rec."studentId",
      'CHECK_OUT',
      NOW(),
      v_rec.reason,
      v_return_ts,
      'UNAVAILABLE',
      NOW()
    );

    UPDATE students
    SET "currentStatus" = 'OFF_CAMPUS',
        "lastSeen"      = NOW()
    WHERE id = v_rec."studentId";

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION auto_checkout_students() TO authenticated;
GRANT EXECUTE ON FUNCTION auto_checkout_students() TO anon;
