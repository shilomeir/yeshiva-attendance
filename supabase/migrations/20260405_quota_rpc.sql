-- Migration: create_checkout_with_quota_check
-- Atomically checks class quota and creates a CHECK_OUT event if quota is available.

CREATE OR REPLACE FUNCTION create_checkout_with_quota_check(
  p_student_id TEXT,
  p_class_id   TEXT,
  p_grade      TEXT,
  p_reason     TEXT DEFAULT NULL,
  -- TEXT (not TIMESTAMPTZ) because events."expectedReturn" is a TEXT column (ISO-8601 string).
  -- PostgreSQL will not implicitly cast TIMESTAMPTZ → TEXT in an INSERT, so keeping this as
  -- TEXT avoids a type-mismatch error when a non-null return time is provided.
  p_expected_return TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_quota       INT;
  v_current     INT;
  v_event_id    UUID;
  v_today       TEXT;
  v_now         TIMESTAMPTZ;
BEGIN
  -- Determine quota based on grade name
  IF p_grade IN ('אברכים', 'בוגרצים') THEN
    v_quota := 6;
  ELSE
    v_quota := 3;
  END IF;

  -- Serialize concurrent checkouts for the same class
  PERFORM pg_advisory_xact_lock(hashtext(p_class_id));

  v_today := (NOW() AT TIME ZONE 'UTC')::DATE::TEXT;

  -- Count students in this class who are currently OFF_CAMPUS or OVERDUE,
  -- excluding those covered by an approved urgent absence request today.
  SELECT COUNT(*)
  INTO v_current
  FROM students s
  WHERE s."classId" = p_class_id
    AND s."currentStatus" IN ('OFF_CAMPUS', 'OVERDUE')
    AND NOT EXISTS (
      SELECT 1
      FROM absence_requests ar
      WHERE ar."studentId" = s.id
        AND ar."isUrgent" = TRUE
        AND ar.status = 'APPROVED'
        AND ar.date = v_today
    );

  -- Quota exceeded?
  IF v_current >= v_quota THEN
    RETURN json_build_object(
      'success', FALSE,
      'error',   'quota_exceeded',
      'current', v_current,
      'quota',   v_quota
    );
  END IF;

  -- Create the CHECK_OUT event
  v_event_id := gen_random_uuid();
  v_now      := NOW();

  INSERT INTO events (
    id,
    "studentId",
    type,
    timestamp,
    reason,
    "expectedReturn",
    "gpsLat",
    "gpsLng",
    "gpsStatus",
    "distanceFromCampus",
    note,
    "syncedAt"
  ) VALUES (
    v_event_id,
    p_student_id::UUID,
    'CHECK_OUT',
    v_now,
    p_reason,
    p_expected_return,
    NULL,
    NULL,
    'PENDING',
    NULL,
    NULL,
    v_now
  );

  -- Update student status to OFF_CAMPUS
  UPDATE students
  SET "currentStatus" = 'OFF_CAMPUS',
      "lastSeen"      = v_now
  WHERE id = p_student_id::UUID;

  RETURN json_build_object(
    'success', TRUE,
    'eventId', v_event_id::TEXT
  );
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION create_checkout_with_quota_check(TEXT, TEXT, TEXT, TEXT, TEXT)
  TO authenticated;

GRANT EXECUTE ON FUNCTION create_checkout_with_quota_check(TEXT, TEXT, TEXT, TEXT, TEXT)
  TO anon;
