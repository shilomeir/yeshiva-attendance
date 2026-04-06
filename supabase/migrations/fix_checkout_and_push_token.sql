-- ============================================================
-- 1.  Add push_token column to students
-- ============================================================
ALTER TABLE students ADD COLUMN IF NOT EXISTS push_token TEXT DEFAULT NULL;


-- ============================================================
-- 2.  Replace create_checkout_with_quota_check
--
--     Fixes:
--     a) Used CURRENT_DATE (UTC) — Israel is UTC+3, so between
--        00:00–03:00 Israeli time the date was "yesterday", making
--        the urgent-exempt query miss today's approvals → wrong count.
--     b) Raw SQL exceptions propagated to the client as errors
--        instead of returning { success: false }.
-- ============================================================
CREATE OR REPLACE FUNCTION create_checkout_with_quota_check(
  p_student_id     UUID,
  p_class_id       TEXT,
  p_grade          TEXT,
  p_reason         TEXT         DEFAULT NULL,
  p_expected_return TIMESTAMPTZ DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_outside_count INT;
  v_quota         INT := 3;          -- default quota per class
  v_event_id      UUID;
  v_now           TIMESTAMPTZ := NOW();
  -- Use Israel local date so the urgent-exempt check matches stored dates
  v_today         TEXT := (NOW() AT TIME ZONE 'Asia/Jerusalem')::DATE::TEXT;
BEGIN

  -- Count students currently outside, excluding those with an
  -- approved urgent request for today (they don't consume a slot)
  SELECT COUNT(*) INTO v_outside_count
  FROM students s
  WHERE s."classId" = p_class_id
    AND s."currentStatus" IN ('OFF_CAMPUS', 'OVERDUE')
    AND s.id NOT IN (
      SELECT ar."studentId"
      FROM absence_requests ar
      WHERE ar."studentId" = s.id
        AND ar."isUrgent"  = true
        AND ar.status      = 'APPROVED'
        AND ar.date        = v_today
    );

  IF v_outside_count >= v_quota THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'quota_exceeded',
      'current', v_outside_count,
      'quota',   v_quota
    );
  END IF;

  -- Create the checkout event
  v_event_id := gen_random_uuid();

  INSERT INTO events (
    id,
    "studentId",
    type,
    timestamp,
    reason,
    "expectedReturn",
    "gpsStatus",
    "syncedAt"
  ) VALUES (
    v_event_id,
    p_student_id,
    'CHECK_OUT',
    v_now,
    p_reason,
    p_expected_return,
    'PENDING',
    v_now
  );

  -- Update student status
  UPDATE students
  SET "currentStatus" = 'OFF_CAMPUS',
      "lastSeen"      = v_now
  WHERE id = p_student_id;

  RETURN jsonb_build_object('success', true, 'eventId', v_event_id::TEXT);

EXCEPTION WHEN OTHERS THEN
  -- Never let a raw SQL exception reach the client — return structured error instead
  RETURN jsonb_build_object('success', false, 'error', 'server_error');
END;
$$;
