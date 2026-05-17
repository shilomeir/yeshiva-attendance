-- Internal Audit Subsystem — RPCs
-- Reconstructed from production DB (migration was applied but .sql was missing from repo).

BEGIN;

-- ─── start_audit_session ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.start_audit_session(
  p_class_ids  TEXT[],
  p_title      TEXT,
  p_admin_pin  TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_existing_id      UUID;
  v_session_id       UUID;
  v_student_snap     JSONB;
  v_class_snap       JSONB;
  v_active_dep_snap  JSONB;
  v_total_students   INT;
  v_student_ids      TEXT[];
BEGIN
  IF NOT verify_admin_pin(p_admin_pin) THEN RETURN jsonb_build_object('error', 'AUTH'); END IF;
  IF p_class_ids IS NULL OR array_length(p_class_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('error', 'NO_CLASSES');
  END IF;

  LOCK TABLE audit_sessions IN SHARE ROW EXCLUSIVE MODE;

  SELECT id INTO v_existing_id FROM audit_sessions WHERE status='ACTIVE' LIMIT 1;
  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'ALREADY_ACTIVE', 'existingId', v_existing_id::TEXT);
  END IF;

  SELECT
    COUNT(*)::INT,
    COALESCE(jsonb_agg(jsonb_build_object('id', s.id, 'fullName', s."fullName", 'idNumber', s."idNumber", 'classId', s."classId", 'grade', s.grade) ORDER BY s.grade, s."classId", s."fullName"), '[]'::jsonb),
    COALESCE(array_agg(s.id ORDER BY s.grade, s."classId", s."fullName"), ARRAY[]::TEXT[])
  INTO v_total_students, v_student_snap, v_student_ids
  FROM students s WHERE s."classId" = ANY(p_class_ids);

  IF v_total_students = 0 THEN RETURN jsonb_build_object('error', 'NO_STUDENTS_IN_CLASSES'); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('classId', t."classId", 'grade', t.grade, 'studentCount', t.cnt) ORDER BY t.grade, t."classId"), '[]'::jsonb)
  INTO v_class_snap
  FROM (SELECT s."classId", MIN(s.grade) AS grade, COUNT(*)::INT AS cnt FROM students s WHERE s."classId" = ANY(p_class_ids) GROUP BY s."classId") t;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('studentId', d.student_id, 'departureId', d.id::TEXT, 'endAt', d.end_at, 'reason', d.reason)), '[]'::jsonb)
  INTO v_active_dep_snap
  FROM departures d WHERE d.student_id = ANY(v_student_ids) AND d.status = 'ACTIVE';

  INSERT INTO audit_sessions (title, started_by, class_ids, total_students_snapshot, class_snapshot, student_snapshot, active_departures_snapshot)
  VALUES (NULLIF(btrim(p_title), ''), 'admin', p_class_ids, v_total_students, v_class_snap, v_student_snap, v_active_dep_snap)
  RETURNING id INTO v_session_id;

  INSERT INTO audit_class_states (session_id, class_id, status)
  SELECT v_session_id, unnest(p_class_ids), 'NOT_STARTED';

  WITH active_students AS (
    SELECT (idx - 1)::INT AS snap_idx, (snap->>'id')::TEXT AS student_id, (snap->>'classId')::TEXT AS class_id, (snap->>'grade')::TEXT AS grade
    FROM jsonb_array_elements(v_student_snap) WITH ORDINALITY AS arr(snap, idx)
    WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(v_active_dep_snap) AS dep WHERE dep->>'studentId' = snap->>'id')
  )
  INSERT INTO audit_entries (session_id, student_id, student_snapshot_idx, class_id, grade, status, source, had_active_departure_at_audit, submitted_by)
  SELECT v_session_id, a.student_id, a.snap_idx, a.class_id, a.grade, 'OUT_WITH_PERMISSION', 'AUTO_DEFAULT', TRUE, 'system'
  FROM active_students a;

  RETURN (SELECT to_jsonb(t) FROM (
    SELECT s.id, s.title, s.started_at AS "startedAt", s.started_by AS "startedBy", s.class_ids AS "classIds",
      s.status, s.closed_at AS "closedAt", s.closed_by AS "closedBy",
      s.total_students_snapshot AS "totalStudentsSnapshot", s.class_snapshot AS "classSnapshot",
      s.student_snapshot AS "studentSnapshot", s.active_departures_snapshot AS "activeDeparturesSnapshot"
    FROM audit_sessions s WHERE s.id = v_session_id) t);
END; $$;

-- ─── submit_audit_entry ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.submit_audit_entry(
  p_session_id     UUID,
  p_student_id     TEXT,
  p_status         TEXT,
  p_note           TEXT,
  p_supervisor_pin TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $$
DECLARE
  v_session              audit_sessions%ROWTYPE;
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
END; $$;

-- ─── finish_class_audit ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finish_class_audit(
  p_session_id     UUID,
  p_class_id       TEXT,
  p_note           TEXT,
  p_supervisor_pin TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $$
DECLARE
  v_session              audit_sessions%ROWTYPE;
  v_actor_class_id       TEXT;
  v_is_admin             BOOLEAN := FALSE;
  v_actor_label          TEXT;
  v_total_in_class       INT;
  v_marked               INT;
  v_in_yeshiva           INT;
  v_out_with_perm        INT;
  v_out_without_perm     INT;
BEGIN
  v_actor_class_id := _resolve_supervisor_class(p_supervisor_pin);
  IF v_actor_class_id IS NULL THEN
    IF verify_admin_pin(p_supervisor_pin) THEN v_is_admin := TRUE; v_actor_label := 'admin';
    ELSE RETURN jsonb_build_object('error', 'AUTH'); END IF;
  ELSE v_actor_label := v_actor_class_id;
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

  SELECT
    (SELECT COUNT(*)::INT FROM jsonb_array_elements(v_session.student_snapshot) AS s WHERE s->>'classId' = p_class_id),
    COUNT(e.*)::INT,
    COUNT(e.*) FILTER (WHERE e.status='IN_YESHIVA')::INT,
    COUNT(e.*) FILTER (WHERE e.status='OUT_WITH_PERMISSION')::INT,
    COUNT(e.*) FILTER (WHERE e.status='OUT_WITHOUT_PERMISSION')::INT
  INTO v_total_in_class, v_marked, v_in_yeshiva, v_out_with_perm, v_out_without_perm
  FROM audit_entries e WHERE e.session_id = p_session_id AND e.class_id = p_class_id;

  UPDATE audit_class_states
  SET status = 'FINISHED', finished_at = now(), finished_by = v_actor_label,
      unmarked_at_finish = GREATEST(0, v_total_in_class - v_marked),
      in_yeshiva_at_finish = v_in_yeshiva,
      out_with_perm_at_finish = v_out_with_perm,
      out_without_perm_at_finish = v_out_without_perm,
      supervisor_note = NULLIF(btrim(p_note), '')
  WHERE session_id = p_session_id AND class_id = p_class_id;

  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'CLASS_STATE_NOT_FOUND'); END IF;

  RETURN (SELECT to_jsonb(t) FROM (
    SELECT cs.id, cs.session_id AS "sessionId", cs.class_id AS "classId", cs.status,
      cs.started_at AS "startedAt", cs.finished_at AS "finishedAt", cs.finished_by AS "finishedBy",
      cs.unmarked_at_finish AS "unmarkedAtFinish",
      cs.in_yeshiva_at_finish AS "inYeshivaAtFinish",
      cs.out_with_perm_at_finish AS "outWithPermAtFinish",
      cs.out_without_perm_at_finish AS "outWithoutPermAtFinish",
      cs.supervisor_note AS "supervisorNote", cs.updated_at AS "updatedAt"
    FROM audit_class_states cs WHERE cs.session_id = p_session_id AND cs.class_id = p_class_id) t);
END; $$;

-- ─── close_audit_session ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.close_audit_session(
  p_session_id  UUID,
  p_admin_pin   TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_updated_id UUID;
BEGIN
  IF NOT verify_admin_pin(p_admin_pin) THEN RETURN jsonb_build_object('error', 'AUTH'); END IF;
  UPDATE audit_sessions SET status = 'CLOSED', closed_at = now(), closed_by = 'admin'
  WHERE id = p_session_id AND status = 'ACTIVE' RETURNING id INTO v_updated_id;
  IF v_updated_id IS NULL THEN RETURN jsonb_build_object('error', 'NOT_ACTIVE'); END IF;
  RETURN (SELECT to_jsonb(t) FROM (
    SELECT s.id, s.title, s.started_at AS "startedAt", s.started_by AS "startedBy", s.class_ids AS "classIds",
      s.status, s.closed_at AS "closedAt", s.closed_by AS "closedBy",
      s.total_students_snapshot AS "totalStudentsSnapshot", s.class_snapshot AS "classSnapshot",
      s.student_snapshot AS "studentSnapshot", s.active_departures_snapshot AS "activeDeparturesSnapshot"
    FROM audit_sessions s WHERE s.id = p_session_id) t);
END; $$;

-- ─── get_active_audit_session ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_active_audit_session()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM audit_sessions WHERE status='ACTIVE' LIMIT 1;
  IF v_id IS NULL THEN RETURN NULL; END IF;
  RETURN get_audit_session(v_id);
END; $$;

-- ─── get_audit_session ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_audit_session(p_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_session_json JSONB; v_entries_json JSONB; v_class_states_json JSONB;
BEGIN
  SELECT to_jsonb(t) INTO v_session_json FROM (
    SELECT s.id, s.title, s.started_at AS "startedAt", s.started_by AS "startedBy", s.class_ids AS "classIds",
      s.status, s.closed_at AS "closedAt", s.closed_by AS "closedBy",
      s.total_students_snapshot AS "totalStudentsSnapshot", s.class_snapshot AS "classSnapshot",
      s.student_snapshot AS "studentSnapshot", s.active_departures_snapshot AS "activeDeparturesSnapshot"
    FROM audit_sessions s WHERE s.id = p_id) t;
  IF v_session_json IS NULL THEN RETURN NULL; END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t."submittedAt"), '[]'::jsonb) INTO v_entries_json FROM (
    SELECT e.id, e.session_id AS "sessionId", e.student_id AS "studentId",
      e.student_snapshot_idx AS "studentSnapshotIdx", e.class_id AS "classId", e.grade, e.status, e.note, e.source,
      e.had_active_departure_at_audit AS "hadActiveDepartureAtAudit",
      e.submitted_by AS "submittedBy", e.submitted_at AS "submittedAt", e.updated_at AS "updatedAt"
    FROM audit_entries e WHERE e.session_id = p_id) t;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t."classId"), '[]'::jsonb) INTO v_class_states_json FROM (
    SELECT cs.id, cs.session_id AS "sessionId", cs.class_id AS "classId", cs.status,
      cs.started_at AS "startedAt", cs.finished_at AS "finishedAt", cs.finished_by AS "finishedBy",
      cs.unmarked_at_finish AS "unmarkedAtFinish",
      cs.in_yeshiva_at_finish AS "inYeshivaAtFinish",
      cs.out_with_perm_at_finish AS "outWithPermAtFinish",
      cs.out_without_perm_at_finish AS "outWithoutPermAtFinish",
      cs.supervisor_note AS "supervisorNote", cs.updated_at AS "updatedAt"
    FROM audit_class_states cs WHERE cs.session_id = p_id) t;

  RETURN jsonb_build_object('session', v_session_json, 'entries', v_entries_json, 'classStates', v_class_states_json);
END; $$;

-- ─── list_audit_sessions ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_audit_sessions(
  p_limit   INT DEFAULT 20,
  p_offset  INT DEFAULT 0
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_rows JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t."startedAt" DESC), '[]'::jsonb) INTO v_rows FROM (
    SELECT v.id, v.title, v.started_at AS "startedAt", v.closed_at AS "closedAt", v.status, v.class_ids AS "classIds",
      v.total_students_snapshot AS "totalStudentsSnapshot",
      v.in_yeshiva_count AS "inYeshivaCount", v.out_with_perm_count AS "outWithPermCount",
      v.out_without_perm_count AS "outWithoutPermCount", v.marked_count AS "markedCount",
      v.unmarked_count AS "unmarkedCount", v.duration_sec AS "durationSec"
    FROM v_audit_session_summary v ORDER BY v.started_at DESC
    LIMIT GREATEST(1, LEAST(p_limit, 100)) OFFSET GREATEST(0, p_offset)) t;
  RETURN v_rows;
END; $$;

-- ─── Grants (anon can read; mutations are SECURITY DEFINER) ──────────────────
GRANT EXECUTE ON FUNCTION public.get_active_audit_session()              TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_audit_session(UUID)                 TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_audit_sessions(INT, INT)           TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_audit_session(TEXT[], TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_audit_entry(UUID, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_class_audit(UUID, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_audit_session(UUID, TEXT)         TO authenticated;

COMMIT;
