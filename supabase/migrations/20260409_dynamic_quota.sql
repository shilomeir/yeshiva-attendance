-- ============================================================
-- Dynamic quota: ~3 slots per 25 students (rounded to nearest)
--
-- Formula:  GREATEST(1, ROUND((class_size * 3)::numeric / 25))
-- Examples:
--   25 students → quota 3
--   26 students → quota 3  (3.12 rounds to 3)
--   30 students → quota 4  (3.60 rounds to 4)
--   50 students → quota 6  (6.00)
--
-- Matches the client-side calcQuota() function in OffCampusSheet.tsx.
-- ============================================================

CREATE OR REPLACE FUNCTION create_checkout_with_quota_check(
  p_student_id      UUID,
  p_class_id        TEXT,
  p_grade           TEXT,
  p_reason          TEXT         DEFAULT NULL,
  p_expected_return TIMESTAMPTZ  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_outside_count INT;
  v_class_size    INT;
  v_quota         INT;
  v_event_id      UUID;
  v_now           TIMESTAMPTZ := NOW();
  -- Use Israel local date so the urgent-exempt check matches stored dates
  v_today         TEXT := (NOW() AT TIME ZONE 'Asia/Jerusalem')::DATE::TEXT;
BEGIN

  -- ── 1. Count total students enrolled in this class ──────────────
  SELECT COUNT(*) INTO v_class_size
  FROM students
  WHERE "classId" = p_class_id;

  -- ── 2. Compute dynamic quota (min 1) ────────────────────────────
  v_quota := GREATEST(1, ROUND((v_class_size * 3)::numeric / 25));

  -- ── 3. Count students currently outside (excluding urgent-exempt) ─
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
        AND ar.date       <= v_today
        AND (ar."endDate" IS NULL OR ar."endDate" >= v_today)
    );

  -- ── 4. Quota check ───────────────────────────────────────────────
  IF v_outside_count >= v_quota THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'quota_exceeded',
      'current', v_outside_count,
      'quota',   v_quota
    );
  END IF;

  -- ── 5. Create checkout event ─────────────────────────────────────
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

  -- ── 6. Update student status ─────────────────────────────────────
  UPDATE students
  SET "currentStatus" = 'OFF_CAMPUS',
      "lastSeen"      = v_now
  WHERE id = p_student_id;

  RETURN jsonb_build_object('success', true, 'eventId', v_event_id::TEXT);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'server_error');
END;
$$;

-- Grant execution to both anon and authenticated (matches previous grants)
GRANT EXECUTE ON FUNCTION create_checkout_with_quota_check(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION create_checkout_with_quota_check(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO anon;
