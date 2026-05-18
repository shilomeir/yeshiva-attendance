-- Audit Phase 6 — student GPS submission RPC.
--
-- Allows students to submit their GPS position during a LOCATION-mode audit
-- session. Authentication is device-token-based (no supervisor PIN needed).
-- The RPC computes the distance from campus, assigns a distance bucket, and
-- upserts an audit_entries row with source='AUTO_GPS'.
--
-- Distance buckets (fn_distance_bucket):
--   GREEN  (≤ 300 m)   → IN_YESHIVA
--   BLUE   (≤ 1 km)    → OUT_WITH_PERMISSION
--   ORANGE (≤ 5 km)    → OUT_WITH_PERMISSION  (triggers audit_alert)
--   RED    (> 5 km)    → OUT_WITH_PERMISSION  (triggers audit_alert)
--
-- Only ORANGE and RED create alert rows (existing tg_audit_entries_alert trigger).

BEGIN;

CREATE OR REPLACE FUNCTION public.submit_student_audit_gps(
  p_session_id    UUID,
  p_student_id    UUID,
  p_device_token  TEXT,
  p_gps_lat       DOUBLE PRECISION,
  p_gps_lng       DOUBLE PRECISION,
  p_accuracy_m    DOUBLE PRECISION DEFAULT NULL,
  p_gps_status    TEXT             DEFAULT 'OK'
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_session       audit_sessions%ROWTYPE;
  v_student       students%ROWTYPE;
  v_snap_idx      INT;
  v_snap          JSONB;
  v_dist_m        DOUBLE PRECISION;
  v_bucket        TEXT;
  v_status        TEXT;
  -- Yeshivat Shavi Hevron campus (Kiryat Arba / Hebron)
  v_campus_lat    CONSTANT DOUBLE PRECISION := 31.5253;
  v_campus_lng    CONSTANT DOUBLE PRECISION := 35.1056;
BEGIN
  -- 1. Validate gps_status value
  IF p_gps_status IS NOT NULL AND p_gps_status NOT IN (
    'OK','DENIED','TIMEOUT','OFFLINE','UNAVAILABLE','LOW_ACCURACY'
  ) THEN
    RETURN jsonb_build_object('error', 'INVALID_GPS_STATUS');
  END IF;

  -- 2. Verify student by device token
  SELECT * INTO v_student
  FROM students
  WHERE id = p_student_id AND "deviceToken" = p_device_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'AUTH'); END IF;

  -- 3. Verify session is ACTIVE and LOCATION mode
  SELECT * INTO v_session FROM audit_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'SESSION_NOT_FOUND'); END IF;
  IF v_session.status <> 'ACTIVE' THEN RETURN jsonb_build_object('error', 'SESSION_CLOSED'); END IF;
  IF v_session.mode <> 'LOCATION' THEN RETURN jsonb_build_object('error', 'WRONG_MODE'); END IF;

  -- 4. Locate student in snapshot (0-based index — matches bulk_mark convention)
  SELECT (arr.idx - 1)::INT
  INTO   v_snap_idx
  FROM   jsonb_array_elements(v_session.student_snapshot) WITH ORDINALITY AS arr(snap, idx)
  WHERE  arr.snap->>'id' = p_student_id::TEXT
  LIMIT  1;

  IF v_snap_idx IS NULL THEN
    RETURN jsonb_build_object('error', 'STUDENT_NOT_IN_SESSION');
  END IF;

  v_snap := v_session.student_snapshot -> v_snap_idx;

  -- 5. Compute distance and bucket
  v_dist_m := fn_haversine_m(v_campus_lat, v_campus_lng, p_gps_lat, p_gps_lng);
  v_bucket  := fn_distance_bucket(v_dist_m);

  -- GREEN = inside campus → IN_YESHIVA; everything else = outside with permission
  -- (ORANGE/RED will still trigger audit_alerts via the existing tg_audit_entries_alert trigger)
  v_status := CASE WHEN v_bucket = 'GREEN' THEN 'IN_YESHIVA' ELSE 'OUT_WITH_PERMISSION' END;

  -- 6. Upsert audit entry
  INSERT INTO audit_entries (
    session_id, student_id, student_snapshot_idx, class_id, grade,
    status, source, had_active_departure_at_audit, submitted_by,
    gps_lat, gps_lng, gps_accuracy_m,
    distance_from_campus_m, distance_bucket, gps_status
  )
  SELECT
    p_session_id,
    p_student_id,
    v_snap_idx,
    v_snap->>'classId',
    v_snap->>'grade',
    v_status,
    'AUTO_GPS',
    EXISTS (
      SELECT 1
      FROM   jsonb_array_elements(v_session.active_departures_snapshot) dep
      WHERE  dep->>'studentId' = p_student_id::TEXT
    ),
    'student:' || v_student."idNumber",
    p_gps_lat,
    p_gps_lng,
    p_accuracy_m,
    v_dist_m,
    v_bucket,
    p_gps_status
  ON CONFLICT (session_id, student_snapshot_idx) DO UPDATE SET
    status                 = v_status,
    source                 = 'AUTO_GPS',
    gps_lat                = p_gps_lat,
    gps_lng                = p_gps_lng,
    gps_accuracy_m         = p_accuracy_m,
    distance_from_campus_m = v_dist_m,
    distance_bucket        = v_bucket,
    gps_status             = p_gps_status,
    submitted_by           = 'student:' || v_student."idNumber",
    updated_at             = now();

  RETURN jsonb_build_object(
    'ok',             true,
    'distanceM',      round(v_dist_m::numeric, 0),
    'distanceBucket', v_bucket,
    'status',         v_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_student_audit_gps(UUID, UUID, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_student_audit_gps(UUID, UUID, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TEXT) TO anon, authenticated;

COMMIT;
