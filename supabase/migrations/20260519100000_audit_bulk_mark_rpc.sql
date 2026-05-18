-- Audit Phase 3 — bulk mark RPC for the supervisor "סמן את כל הלא-מסומנים כבישיבה" action.
--
-- The supervisor's most common path is: "כולם בישיבה חוץ מ-3 שיצאו". Marking
-- 22 students one-by-one is repetitive friction. This RPC seeds a status for
-- every student in the class who doesn't yet have an entry, in a single
-- round-trip and atomically with respect to concurrent marks.
--
-- ON CONFLICT DO NOTHING preserves existing entries — AUTO_DEFAULT seeds
-- (for students with an ACTIVE departure at session start) and any manual
-- supervisor marks already made are untouched. The supervisor can mark the
-- exceptions first, then press the bulk button to fill in the rest.

BEGIN;

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

  -- Bump class state to IN_PROGRESS if this was the first activity
  UPDATE audit_class_states
  SET status = 'IN_PROGRESS', started_at = COALESCE(started_at, now())
  WHERE session_id = p_session_id AND class_id = p_class_id AND status = 'NOT_STARTED';

  RETURN jsonb_build_object('markedCount', v_marked_count);
END; $$;

REVOKE ALL ON FUNCTION public.bulk_mark_unmarked_audit_entries(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bulk_mark_unmarked_audit_entries(UUID, TEXT, TEXT, TEXT) TO anon, authenticated;

COMMIT;
