-- Add an explicit pre-check for overlapping live departures inside submit_departure.
-- Previously, the GiST exclusion constraint would fire and surface a raw Postgres
-- exception message to the client.  Now we detect the conflict before the INSERT
-- and return a structured error code the client can display in Hebrew.

CREATE OR REPLACE FUNCTION submit_departure(
  p_student_id    UUID,
  p_start_at      TIMESTAMPTZ,
  p_end_at        TIMESTAMPTZ,
  p_reason        TEXT        DEFAULT NULL,
  p_is_urgent     BOOLEAN     DEFAULT FALSE,
  p_source        TEXT        DEFAULT 'SELF',
  p_approved_by   TEXT        DEFAULT NULL,
  p_force_pending BOOLEAN     DEFAULT FALSE,
  p_actor_id      TEXT        DEFAULT NULL,
  p_actor_role    TEXT        DEFAULT 'STUDENT'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_class_id          TEXT;
  v_class_size        INT;
  v_quota             INT;
  v_overlapping_count INT := 0;
  v_overlapping       JSONB := '[]'::jsonb;
  v_status            TEXT;
  v_departure_id      UUID;
  v_now               TIMESTAMPTZ := NOW();
BEGIN

  -- ── 0. Source authorization ────────────────────────────────────────────────
  IF p_source = 'ADMIN_OVERRIDE' AND p_actor_role NOT IN ('ADMIN', 'SUPERVISOR') THEN
    RETURN jsonb_build_object(
      'error',   'unauthorized',
      'message', 'source=ADMIN_OVERRIDE requires actor_role ADMIN or SUPERVISOR'
    );
  END IF;

  -- ── 1. Time window validation ──────────────────────────────────────────────
  IF p_end_at <= p_start_at THEN
    RETURN jsonb_build_object('error', 'invalid_range', 'message', 'end_at must be after start_at');
  END IF;
  IF p_end_at > p_start_at + INTERVAL '30 days' THEN
    RETURN jsonb_build_object('error', 'range_too_long', 'message', 'Window cannot exceed 30 days');
  END IF;

  -- ── 2. Resolve class_id (denormalize at submission time) ──────────────────
  SELECT "classId" INTO v_class_id
  FROM students
  WHERE id = p_student_id;

  IF v_class_id IS NULL THEN
    RETURN jsonb_build_object('error', 'student_not_found');
  END IF;

  -- ── 2b. Check for existing overlapping live departures by this student ─────
  IF EXISTS (
    SELECT 1 FROM departures
    WHERE student_id = p_student_id
      AND status IN ('PENDING', 'APPROVED', 'ACTIVE')
      AND tstzrange(start_at, end_at, '[)') && tstzrange(p_start_at, p_end_at, '[)')
  ) THEN
    RETURN jsonb_build_object(
      'error',   'DUPLICATE_DEPARTURE',
      'message', 'קיימת בקשת יציאה פעילה לאותה תקופה'
    );
  END IF;

  -- ── 3. Advisory lock — prevents concurrent quota bypass for same class ─────
  PERFORM pg_advisory_xact_lock(hashtext(v_class_id));

  -- ── 4. Dynamic quota ───────────────────────────────────────────────────────
  SELECT COUNT(*) INTO v_class_size
  FROM students
  WHERE "classId" = v_class_id;

  v_quota := GREATEST(1, ROUND((v_class_size * 3)::numeric / 25));

  -- ── 5. Decide initial status ───────────────────────────────────────────────
  IF p_source = 'ADMIN_OVERRIDE' THEN
    -- Admin/supervisor: skip quota entirely, always APPROVED
    v_status := 'APPROVED';

  ELSIF p_is_urgent THEN
    -- Urgent: always needs explicit admin approval
    v_status := 'PENDING';

  ELSE
    -- Normal request: count overlapping live non-urgent departures in this class
    -- Quota counts ANY APPROVED or ACTIVE departure whose window overlaps ours,
    -- excluding urgent-exempted ones and the student themselves.
    SELECT
      COUNT(*),
      COALESCE(
        jsonb_agg(jsonb_build_object(
          'studentId',   d.student_id::TEXT,
          'studentName', s."fullName",
          'endAt',       d.end_at
        )),
        '[]'::jsonb
      )
    INTO v_overlapping_count, v_overlapping
    FROM departures d
    JOIN students s ON s.id = d.student_id
    WHERE d.class_id  = v_class_id
      AND d.status    IN ('APPROVED', 'ACTIVE')
      AND d.is_urgent = FALSE
      AND d.student_id != p_student_id
      AND tstzrange(d.start_at, d.end_at, '[)') && tstzrange(p_start_at, p_end_at, '[)');

    IF v_overlapping_count >= v_quota THEN
      IF NOT p_force_pending THEN
        -- Return quota info WITHOUT inserting.
        -- Client shows the banner; user decides whether to force-send to admin.
        RETURN jsonb_build_object(
          'status',      'QUOTA_FULL',
          'current',     v_overlapping_count,
          'quota',       v_quota,
          'overlapping', v_overlapping
        );
      ELSE
        -- Student explicitly chose "send to admin anyway" → PENDING
        v_status := 'PENDING';
      END IF;
    ELSE
      v_status := 'APPROVED';
    END IF;
  END IF;

  -- ── 6. Insert the departure row ────────────────────────────────────────────
  v_departure_id := gen_random_uuid();

  INSERT INTO departures (
    id, student_id, class_id,
    start_at, end_at,
    status, source, is_urgent,
    reason, approved_by,
    created_at, approved_at
  ) VALUES (
    v_departure_id,
    p_student_id,
    v_class_id,
    p_start_at,
    p_end_at,
    v_status,
    p_source,
    p_is_urgent,
    p_reason,
    CASE WHEN v_status = 'APPROVED' THEN COALESCE(p_approved_by, p_actor_id, 'auto') ELSE NULL END,
    v_now,
    CASE WHEN v_status = 'APPROVED' THEN v_now ELSE NULL END
  );

  -- ── 7. If APPROVED and start_at ≤ now → activate immediately ──────────────
  IF v_status = 'APPROVED' AND p_start_at <= v_now THEN
    UPDATE departures
    SET status       = 'ACTIVE',
        activated_at = v_now
    WHERE id = v_departure_id;

    UPDATE students
    SET "currentStatus" = 'OFF_CAMPUS',
        "lastSeen"      = v_now
    WHERE id = p_student_id;

    RETURN jsonb_build_object(
      'id',      v_departure_id::TEXT,
      'status',  'ACTIVE',
      'quota',   v_quota,
      'current', v_overlapping_count
    );
  END IF;

  -- ── 8. If PENDING and quota was full → notify admin (flag in response) ─────
  RETURN jsonb_build_object(
    'id',           v_departure_id::TEXT,
    'status',       v_status,
    'quota',        v_quota,
    'current',      v_overlapping_count,
    'notifyAdmin',  (v_status = 'PENDING' AND p_force_pending AND NOT p_is_urgent)
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('error', 'server_error', 'message', SQLERRM);
END;
$$;
