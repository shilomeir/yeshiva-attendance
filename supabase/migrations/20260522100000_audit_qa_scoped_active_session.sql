-- Audit QA v2 — scoped active-session RPCs.
--
-- The previous fix locked down direct table reads, but get_active_audit_session
-- was still anon-callable and returned the FULL active session via
-- get_audit_session(v_id) — including studentSnapshot (PII), classSnapshot,
-- activeDeparturesSnapshot, every entry, supervisor notes, and GPS coords for
-- every student. That bypassed the table-level lockdown via SECURITY DEFINER.
--
-- This migration splits active-session access into three role-scoped RPCs and
-- restricts the original full-data endpoint to authenticated (admin) only:
--
--   1. get_active_audit_session_minimal()
--      Anon-callable. Returns ONLY session metadata (id, mode, title,
--      classIds, startedAt). No snapshots, no entries, no GPS. Lets
--      supervisor/student clients detect that an audit is happening
--      without leaking participant data.
--
--   2. get_active_audit_for_student(p_student_id TEXT, p_device_token TEXT)
--      Anon-callable but token-validated. Returns session metadata plus
--      ONLY this student's own entry (with their own GPS data). No other
--      students, no notes for others.
--
--   3. get_active_audit_for_supervisor(p_supervisor_pin TEXT)
--      Anon-callable but PIN-validated. Returns session metadata plus
--      snapshots/entries/classState scoped to the supervisor's class
--      only. Admin PIN still gets the full session (covers the "admin
--      uses the supervisor view" case).
--
-- get_active_audit_session() is revoked from PUBLIC/anon — admin only,
-- via the authenticated role granted by supabase.auth.signInWithPassword.

BEGIN;

-- ─── 1. Minimal endpoint (anon) ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_active_audit_session_minimal()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_session audit_sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_session FROM audit_sessions WHERE status = 'ACTIVE' LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'id',                    v_session.id,
    'title',                 v_session.title,
    'mode',                  v_session.mode,
    'startedAt',             v_session.started_at,
    'classIds',              v_session.class_ids,
    'totalStudentsSnapshot', v_session.total_students_snapshot,
    'status',                v_session.status
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.get_active_audit_session_minimal() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_audit_session_minimal() TO anon, authenticated;

-- ─── 2. Student-scoped endpoint ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_active_audit_for_student(
  p_student_id   TEXT,
  p_device_token TEXT
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_student        students%ROWTYPE;
  v_session        audit_sessions%ROWTYPE;
  v_entry          audit_entries%ROWTYPE;
  v_is_in_session  BOOLEAN;
BEGIN
  SELECT * INTO v_student
  FROM students
  WHERE id = p_student_id AND "deviceToken" = p_device_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'AUTH'); END IF;

  SELECT * INTO v_session FROM audit_sessions WHERE status = 'ACTIVE' LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_is_in_session := v_student."classId" = ANY(v_session.class_ids);

  SELECT * INTO v_entry
  FROM audit_entries
  WHERE session_id = v_session.id AND student_id = p_student_id;

  RETURN jsonb_build_object(
    'session', jsonb_build_object(
      'id',         v_session.id,
      'title',      v_session.title,
      'mode',       v_session.mode,
      'startedAt',  v_session.started_at,
      'classIds',   v_session.class_ids,
      'status',     v_session.status
    ),
    'isInActiveSession', v_is_in_session,
    'myEntry', CASE WHEN v_entry.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id',                  v_entry.id,
      'status',              v_entry.status,
      'source',              v_entry.source,
      'submittedAt',         v_entry.submitted_at,
      'distanceFromCampusM', v_entry.distance_from_campus_m,
      'distanceBucket',      v_entry.distance_bucket
    ) END
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.get_active_audit_for_student(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_audit_for_student(TEXT, TEXT) TO anon, authenticated;

-- ─── 3. Supervisor-scoped endpoint ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_active_audit_for_supervisor(
  p_supervisor_pin TEXT
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_class_id       TEXT;
  v_is_admin       BOOLEAN := FALSE;
  v_session        audit_sessions%ROWTYPE;
  v_class_state    audit_class_states%ROWTYPE;
  v_class_snap     JSONB;
  v_student_snap   JSONB;
  v_active_deps    JSONB;
  v_entries        JSONB;
  v_class_total    INT;
BEGIN
  v_class_id := _resolve_supervisor_class(p_supervisor_pin);
  IF v_class_id IS NULL THEN
    IF verify_admin_pin(p_supervisor_pin) THEN
      v_is_admin := TRUE;
    ELSE
      RETURN jsonb_build_object('error', 'AUTH');
    END IF;
  END IF;

  SELECT * INTO v_session FROM audit_sessions WHERE status = 'ACTIVE' LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Admin gets full session (mirrors the previous admin behaviour).
  IF v_is_admin THEN
    RETURN get_audit_session(v_session.id);
  END IF;

  -- Supervisor: scope everything to their class.
  IF NOT (v_class_id = ANY(v_session.class_ids)) THEN
    RETURN jsonb_build_object(
      'session', jsonb_build_object(
        'id',         v_session.id,
        'title',      v_session.title,
        'mode',       v_session.mode,
        'startedAt',  v_session.started_at,
        'classIds',   v_session.class_ids,
        'status',     v_session.status
      ),
      'isInActiveSession', false
    );
  END IF;

  SELECT jsonb_agg(c) INTO v_class_snap
  FROM jsonb_array_elements(v_session.class_snapshot) c
  WHERE c->>'classId' = v_class_id;

  SELECT jsonb_agg(s ORDER BY s->>'fullName'), count(*)::INT
  INTO   v_student_snap, v_class_total
  FROM jsonb_array_elements(v_session.student_snapshot) s
  WHERE s->>'classId' = v_class_id;

  SELECT jsonb_agg(d) INTO v_active_deps
  FROM jsonb_array_elements(v_session.active_departures_snapshot) d
  WHERE EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_session.student_snapshot) s
    WHERE s->>'id' = d->>'studentId' AND s->>'classId' = v_class_id
  );

  SELECT jsonb_agg(to_jsonb(t)) INTO v_entries
  FROM (
    SELECT
      e.id,
      e.session_id          AS "sessionId",
      e.student_id          AS "studentId",
      e.student_snapshot_idx AS "studentSnapshotIdx",
      e.class_id            AS "classId",
      e.grade,
      e.status,
      e.note,
      e.source,
      e.had_active_departure_at_audit AS "hadActiveDepartureAtAudit",
      e.submitted_by        AS "submittedBy",
      e.submitted_at        AS "submittedAt",
      e.updated_at          AS "updatedAt",
      e.gps_lat             AS "gpsLat",
      e.gps_lng             AS "gpsLng",
      e.gps_accuracy_m      AS "gpsAccuracyM",
      e.distance_from_campus_m AS "distanceFromCampusM",
      e.distance_bucket     AS "distanceBucket",
      e.gps_status          AS "gpsStatus"
    FROM audit_entries e
    WHERE e.session_id = v_session.id AND e.class_id = v_class_id
    ORDER BY e.submitted_at
  ) t;

  SELECT * INTO v_class_state
  FROM audit_class_states
  WHERE session_id = v_session.id AND class_id = v_class_id;

  RETURN jsonb_build_object(
    'session', jsonb_build_object(
      'id',                     v_session.id,
      'title',                  v_session.title,
      'mode',                   v_session.mode,
      'startedAt',              v_session.started_at,
      'classIds',               ARRAY[v_class_id],
      'totalStudentsSnapshot',  COALESCE(v_class_total, 0),
      'classSnapshot',          COALESCE(v_class_snap, '[]'::jsonb),
      'studentSnapshot',        COALESCE(v_student_snap, '[]'::jsonb),
      'activeDeparturesSnapshot', COALESCE(v_active_deps, '[]'::jsonb),
      'status',                 v_session.status
    ),
    'isInActiveSession', true,
    'entries',           COALESCE(v_entries, '[]'::jsonb),
    'classState', CASE WHEN v_class_state.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id',         v_class_state.id,
      'sessionId',  v_class_state.session_id,
      'classId',    v_class_state.class_id,
      'status',     v_class_state.status,
      'startedAt',  v_class_state.started_at,
      'finishedAt', v_class_state.finished_at,
      'finishedBy', v_class_state.finished_by
    ) END
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.get_active_audit_for_supervisor(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_audit_for_supervisor(TEXT) TO anon, authenticated;

-- ─── 4. Lock down the original full-data endpoint ────────────────────────────

REVOKE EXECUTE ON FUNCTION public.get_active_audit_session() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_active_audit_session() TO authenticated, service_role;

COMMIT;
