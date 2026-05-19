-- Audit QA fixes — addresses the critical blockers identified by the verification pass:
--
--   1. submit_student_audit_gps had p_student_id UUID; students.id is TEXT.
--      Drop the broken overload and recreate with TEXT.
--   2. submit_audit_entry, bulk_mark_unmarked_audit_entries, and
--      submit_student_audit_gps did not check whether the class was already
--      FINISHED — supervisors / stale clients could still mutate. Adds a
--      CLASS_FINISHED guard to all three.
--   3. Drop the anon read-all RLS policies on audit_* tables. All client
--      access already goes through SECURITY DEFINER RPCs (which bypass RLS),
--      so removing the policies only blocks raw table access with the anon
--      key — exactly what we want for snapshot PII + GPS coordinates.
--   4. Revoke anon EXECUTE on get_audit_session and list_audit_sessions —
--      these return full audit history; admin-only via authenticated role.
--      get_active_audit_session stays anon-callable (used by supervisor +
--      student to detect an ongoing audit).

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. submit_student_audit_gps: fix UUID→TEXT mismatch and add FINISHED guard
-- ────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.submit_student_audit_gps(UUID, UUID, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TEXT);

CREATE OR REPLACE FUNCTION public.submit_student_audit_gps(
  p_session_id    UUID,
  p_student_id    TEXT,
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
  v_class_state   audit_class_states%ROWTYPE;
  v_snap_idx      INT;
  v_snap          JSONB;
  v_class_id      TEXT;
  v_dist_m        DOUBLE PRECISION;
  v_bucket        TEXT;
  v_status        TEXT;
  v_campus_lat    CONSTANT DOUBLE PRECISION := 31.5253;
  v_campus_lng    CONSTANT DOUBLE PRECISION := 35.1056;
BEGIN
  IF p_gps_status IS NOT NULL AND p_gps_status NOT IN (
    'OK','DENIED','TIMEOUT','OFFLINE','UNAVAILABLE','LOW_ACCURACY'
  ) THEN
    RETURN jsonb_build_object('error', 'INVALID_GPS_STATUS');
  END IF;

  -- Auth: students.id is TEXT and "deviceToken" is TEXT — compare directly.
  SELECT * INTO v_student
  FROM students
  WHERE id = p_student_id AND "deviceToken" = p_device_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'AUTH'); END IF;

  SELECT * INTO v_session FROM audit_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'SESSION_NOT_FOUND'); END IF;
  IF v_session.status <> 'ACTIVE' THEN RETURN jsonb_build_object('error', 'SESSION_CLOSED'); END IF;
  IF v_session.mode <> 'LOCATION' THEN RETURN jsonb_build_object('error', 'WRONG_MODE'); END IF;

  SELECT (arr.idx - 1)::INT
  INTO   v_snap_idx
  FROM   jsonb_array_elements(v_session.student_snapshot) WITH ORDINALITY AS arr(snap, idx)
  WHERE  arr.snap->>'id' = p_student_id
  LIMIT  1;

  IF v_snap_idx IS NULL THEN
    RETURN jsonb_build_object('error', 'STUDENT_NOT_IN_SESSION');
  END IF;

  v_snap     := v_session.student_snapshot -> v_snap_idx;
  v_class_id := v_snap->>'classId';

  -- FINISHED guard: once the supervisor closes a class, no further mutations.
  SELECT * INTO v_class_state
  FROM audit_class_states
  WHERE session_id = p_session_id AND class_id = v_class_id;
  IF FOUND AND v_class_state.status = 'FINISHED' THEN
    RETURN jsonb_build_object('error', 'CLASS_FINISHED');
  END IF;

  v_dist_m := fn_haversine_m(v_campus_lat, v_campus_lng, p_gps_lat, p_gps_lng);
  v_bucket  := fn_distance_bucket(v_dist_m);
  v_status := CASE WHEN v_bucket = 'GREEN' THEN 'IN_YESHIVA' ELSE 'OUT_WITH_PERMISSION' END;

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
    v_class_id,
    v_snap->>'grade',
    v_status,
    'AUTO_GPS',
    EXISTS (
      SELECT 1
      FROM   jsonb_array_elements(v_session.active_departures_snapshot) dep
      WHERE  dep->>'studentId' = p_student_id
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

REVOKE ALL ON FUNCTION public.submit_student_audit_gps(UUID, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_student_audit_gps(UUID, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TEXT) TO anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. submit_audit_entry: add CLASS_FINISHED guard
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.submit_audit_entry(
  p_session_id     UUID,
  p_student_id     TEXT,
  p_status         TEXT,
  p_note           TEXT,
  p_supervisor_pin TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_session              audit_sessions%ROWTYPE;
  v_class_state          audit_class_states%ROWTYPE;
  v_actor_class_id       TEXT;
  v_is_admin             BOOLEAN := FALSE;
  v_snap_record          JSONB;
  v_snap_idx             INT;
  v_student_class_id     TEXT;
  v_student_grade        TEXT;
  v_had_active_dep       BOOLEAN;
  v_actor_label          TEXT;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('IN_YESHIVA','OUT_WITH_PERMISSION','OUT_WITHOUT_PERMISSION') THEN
    RETURN jsonb_build_object('error', 'INVALID_STATUS');
  END IF;

  v_actor_class_id := _resolve_supervisor_class(p_supervisor_pin);
  IF v_actor_class_id IS NULL THEN
    IF verify_admin_pin(p_supervisor_pin) THEN
      v_is_admin := TRUE; v_actor_label := 'admin';
    ELSE
      RETURN jsonb_build_object('error', 'AUTH');
    END IF;
  ELSE
    v_actor_label := v_actor_class_id;
  END IF;

  SELECT * INTO v_session FROM audit_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'SESSION_NOT_FOUND'); END IF;
  IF v_session.status <> 'ACTIVE' THEN RETURN jsonb_build_object('error', 'SESSION_CLOSED'); END IF;

  SELECT (idx - 1)::INT, snap INTO v_snap_idx, v_snap_record
  FROM jsonb_array_elements(v_session.student_snapshot) WITH ORDINALITY AS arr(snap, idx)
  WHERE snap->>'id' = p_student_id LIMIT 1;

  IF v_snap_idx IS NULL THEN RETURN jsonb_build_object('error', 'STUDENT_NOT_IN_SESSION'); END IF;

  v_student_class_id := v_snap_record->>'classId';
  v_student_grade    := v_snap_record->>'grade';

  IF NOT v_is_admin AND v_actor_class_id <> v_student_class_id THEN
    RETURN jsonb_build_object('error', 'NOT_AUTHORIZED_FOR_CLASS');
  END IF;

  -- FINISHED guard: a closed class is immutable, even with a valid PIN.
  -- Admin can still mutate (intentional — admin can correct after close).
  SELECT * INTO v_class_state
  FROM audit_class_states
  WHERE session_id = p_session_id AND class_id = v_student_class_id;
  IF NOT v_is_admin AND FOUND AND v_class_state.status = 'FINISHED' THEN
    RETURN jsonb_build_object('error', 'CLASS_FINISHED');
  END IF;

  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(v_session.active_departures_snapshot) AS dep WHERE dep->>'studentId' = p_student_id)
  INTO v_had_active_dep;

  INSERT INTO audit_entries (session_id, student_id, student_snapshot_idx, class_id, grade, status, note, source, had_active_departure_at_audit, submitted_by)
  VALUES (p_session_id, p_student_id, v_snap_idx, v_student_class_id, v_student_grade, p_status, p_note, 'SUPERVISOR', v_had_active_dep, v_actor_label)
  ON CONFLICT (session_id, student_snapshot_idx) DO UPDATE
    SET status = EXCLUDED.status, note = EXCLUDED.note, source = 'SUPERVISOR', submitted_by = EXCLUDED.submitted_by;

  UPDATE audit_class_states
  SET status = 'IN_PROGRESS', started_at = COALESCE(started_at, now())
  WHERE session_id = p_session_id AND class_id = v_student_class_id AND status = 'NOT_STARTED';

  RETURN (SELECT to_jsonb(t) FROM (
    SELECT e.id, e.session_id AS "sessionId", e.student_id AS "studentId",
      e.student_snapshot_idx AS "studentSnapshotIdx", e.class_id AS "classId", e.grade, e.status, e.note, e.source,
      e.had_active_departure_at_audit AS "hadActiveDepartureAtAudit",
      e.submitted_by AS "submittedBy", e.submitted_at AS "submittedAt", e.updated_at AS "updatedAt"
    FROM audit_entries e WHERE e.session_id = p_session_id AND e.student_snapshot_idx = v_snap_idx) t);
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. bulk_mark_unmarked_audit_entries: add CLASS_FINISHED guard
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.bulk_mark_unmarked_audit_entries(
  p_session_id      UUID,
  p_class_id        TEXT,
  p_status          TEXT,
  p_supervisor_pin  TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_session         audit_sessions%ROWTYPE;
  v_class_state     audit_class_states%ROWTYPE;
  v_actor_class_id  TEXT;
  v_is_admin        BOOLEAN := FALSE;
  v_actor_label     TEXT;
  v_marked_count    INT;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('IN_YESHIVA','OUT_WITH_PERMISSION','OUT_WITHOUT_PERMISSION') THEN
    RETURN jsonb_build_object('error', 'INVALID_STATUS');
  END IF;

  v_actor_class_id := _resolve_supervisor_class(p_supervisor_pin);
  IF v_actor_class_id IS NULL THEN
    IF verify_admin_pin(p_supervisor_pin) THEN
      v_is_admin := TRUE; v_actor_label := 'admin';
    ELSE
      RETURN jsonb_build_object('error', 'AUTH');
    END IF;
  ELSE
    v_actor_label := v_actor_class_id;
  END IF;

  SELECT * INTO v_session FROM audit_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'SESSION_NOT_FOUND'); END IF;
  IF v_session.status <> 'ACTIVE' THEN RETURN jsonb_build_object('error', 'SESSION_CLOSED'); END IF;

  IF NOT v_is_admin AND v_actor_class_id <> p_class_id THEN
    RETURN jsonb_build_object('error', 'NOT_AUTHORIZED_FOR_CLASS');
  END IF;
  IF NOT (p_class_id = ANY(v_session.class_ids)) THEN
    RETURN jsonb_build_object('error', 'CLASS_NOT_IN_SESSION');
  END IF;

  -- FINISHED guard: once a supervisor calls finish_class_audit, no more bulk marks.
  -- Admin can still mutate (mirrors submit_audit_entry behaviour).
  SELECT * INTO v_class_state
  FROM audit_class_states
  WHERE session_id = p_session_id AND class_id = p_class_id;
  IF NOT v_is_admin AND FOUND AND v_class_state.status = 'FINISHED' THEN
    RETURN jsonb_build_object('error', 'CLASS_FINISHED');
  END IF;

  WITH class_students AS (
    SELECT (idx - 1)::INT          AS snap_idx,
           (snap->>'id')::TEXT     AS student_id,
           (snap->>'classId')::TEXT AS class_id,
           (snap->>'grade')::TEXT  AS grade,
           EXISTS (
             SELECT 1 FROM jsonb_array_elements(v_session.active_departures_snapshot) AS dep
             WHERE dep->>'studentId' = snap->>'id'
           ) AS had_active_dep
    FROM jsonb_array_elements(v_session.student_snapshot) WITH ORDINALITY AS arr(snap, idx)
    WHERE snap->>'classId' = p_class_id
  )
  INSERT INTO audit_entries (
    session_id, student_id, student_snapshot_idx, class_id, grade,
    status, source, had_active_departure_at_audit, submitted_by
  )
  SELECT p_session_id, cs.student_id, cs.snap_idx, cs.class_id, cs.grade,
         p_status, 'SUPERVISOR', cs.had_active_dep, v_actor_label
  FROM class_students cs
  ON CONFLICT (session_id, student_snapshot_idx) DO NOTHING;

  GET DIAGNOSTICS v_marked_count = ROW_COUNT;

  UPDATE audit_class_states
  SET status = 'IN_PROGRESS', started_at = COALESCE(started_at, now())
  WHERE session_id = p_session_id AND class_id = p_class_id AND status = 'NOT_STARTED';

  RETURN jsonb_build_object('markedCount', v_marked_count);
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Lock down anon reads on audit_* tables
-- ────────────────────────────────────────────────────────────────────────────
-- All client access already goes through SECURITY DEFINER RPCs (which bypass
-- RLS). Removing read-all only blocks raw table reads with the anon key —
-- which currently exposes snapshot PII, supervisor notes, and GPS coords.

DROP POLICY IF EXISTS audit_sessions_read_all     ON public.audit_sessions;
DROP POLICY IF EXISTS audit_class_states_read_all ON public.audit_class_states;
DROP POLICY IF EXISTS audit_entries_read_all      ON public.audit_entries;
DROP POLICY IF EXISTS audit_alerts_read_all       ON public.audit_alerts;

-- Service role + authenticated (admin) can still read directly for back-office
-- queries / debugging. Anon must go through RPCs.
CREATE POLICY audit_sessions_read_authenticated ON public.audit_sessions
  FOR SELECT USING (auth.role() IN ('authenticated','service_role'));
CREATE POLICY audit_class_states_read_authenticated ON public.audit_class_states
  FOR SELECT USING (auth.role() IN ('authenticated','service_role'));
CREATE POLICY audit_entries_read_authenticated ON public.audit_entries
  FOR SELECT USING (auth.role() IN ('authenticated','service_role'));
CREATE POLICY audit_alerts_read_authenticated ON public.audit_alerts
  FOR SELECT USING (auth.role() IN ('authenticated','service_role'));

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Restrict admin-only audit RPCs to authenticated role
-- ────────────────────────────────────────────────────────────────────────────
-- get_audit_session and list_audit_sessions return full audit history —
-- admin-only. The admin is signed in via supabase.auth.signInWithPassword
-- so they have the 'authenticated' role; supervisors and students use anon
-- and should not be able to inspect arbitrary past audits.
--
-- get_active_audit_session stays anon-callable: supervisors and students
-- need it to detect an ongoing audit. It returns only the active session,
-- which the supervisor's own class is already in by design.

-- IMPORTANT: revoke from PUBLIC (which includes anon) plus the explicit
-- roles. Just revoking from anon leaves a PUBLIC grant in the ACL that
-- shadows it, so the function stayed callable until PUBLIC was also revoked.
REVOKE EXECUTE ON FUNCTION public.get_audit_session(UUID)        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.list_audit_sessions(INT, INT)  FROM PUBLIC, anon, authenticated;

GRANT  EXECUTE ON FUNCTION public.get_audit_session(UUID)        TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.list_audit_sessions(INT, INT)  TO authenticated, service_role;

COMMIT;
