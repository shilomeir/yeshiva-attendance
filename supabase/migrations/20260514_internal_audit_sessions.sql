-- Migration: 20260514_internal_audit_sessions.sql
-- Three-status manual internal audit (ביקורת פנימית) with persisted sessions,
-- per-class workflow state, realtime aggregation, and long-term history.
--
-- Design notes (validated against live schema):
--   * students.id is TEXT (not UUID). All FKs use TEXT to match.
--   * Existing camelCase columns are quoted: "fullName", "classId", "idNumber", "currentStatus".
--   * RLS posture matches departures: read-all + service-only direct writes; mutations via
--     SECURITY DEFINER RPCs that verify PIN with verify_admin_pin / verify_supervisor_pin.
--   * Snapshots are frozen at session start so history survives student deletion.
--   * audit_entries.student_id is ON DELETE SET NULL (NOT CASCADE) — long-term audit data
--     stays readable from student_snapshot even if a student is later removed.
--   * Three statuses, NO present/absent legacy:
--       IN_YESHIVA              (בישיבה)
--       OUT_WITH_PERMISSION     (בחוץ עם אישור) — auto-default for students with ACTIVE departure at session start
--       OUT_WITHOUT_PERMISSION  (בחוץ ללא אישור) — first-class critical exception
--   * Idempotent: safe to re-run, wraps publication adds in EXCEPTION handler.

-- ============================================================================
-- audit_sessions
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_sessions (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title                       TEXT,
  started_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_by                  TEXT NOT NULL DEFAULT 'admin',
  class_ids                   TEXT[] NOT NULL CHECK (array_length(class_ids, 1) >= 1),
  status                      TEXT NOT NULL DEFAULT 'ACTIVE'
                              CHECK (status IN ('ACTIVE','CLOSED')),
  closed_at                   TIMESTAMPTZ,
  closed_by                   TEXT,
  total_students_snapshot     INT NOT NULL,
  class_snapshot              JSONB NOT NULL,
  student_snapshot            JSONB NOT NULL,
  active_departures_snapshot  JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS audit_sessions_status_idx     ON audit_sessions(status);
CREATE INDEX IF NOT EXISTS audit_sessions_started_at_idx ON audit_sessions(started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS audit_sessions_one_active
  ON audit_sessions(status) WHERE status='ACTIVE';

-- ============================================================================
-- audit_class_states (per-class workflow state)
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_class_states (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id                  UUID NOT NULL REFERENCES audit_sessions(id) ON DELETE CASCADE,
  class_id                    TEXT NOT NULL,
  status                      TEXT NOT NULL DEFAULT 'NOT_STARTED'
                              CHECK (status IN ('NOT_STARTED','IN_PROGRESS','FINISHED')),
  started_at                  TIMESTAMPTZ,
  finished_at                 TIMESTAMPTZ,
  finished_by                 TEXT,
  unmarked_at_finish          INT,
  in_yeshiva_at_finish        INT,
  out_with_perm_at_finish     INT,
  out_without_perm_at_finish  INT,
  supervisor_note             TEXT,
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS audit_class_states_session_class
  ON audit_class_states(session_id, class_id);
CREATE INDEX IF NOT EXISTS audit_class_states_session_idx
  ON audit_class_states(session_id);

CREATE OR REPLACE FUNCTION audit_class_states_bump_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_class_states_bump_updated_at_trg ON audit_class_states;
CREATE TRIGGER audit_class_states_bump_updated_at_trg
  BEFORE UPDATE ON audit_class_states
  FOR EACH ROW EXECUTE FUNCTION audit_class_states_bump_updated_at();

-- ============================================================================
-- audit_entries (one row per (session, student) — UPSERTed)
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_entries (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id                      UUID NOT NULL REFERENCES audit_sessions(id) ON DELETE CASCADE,
  -- student_id is TEXT (matches students.id) and ON DELETE SET NULL so history survives deletion.
  student_id                      TEXT REFERENCES students(id) ON DELETE SET NULL,
  -- Index into session.student_snapshot — survives student deletion, primary display path.
  student_snapshot_idx            INT NOT NULL,
  class_id                        TEXT NOT NULL,
  grade                           TEXT NOT NULL,
  status                          TEXT NOT NULL
                                  CHECK (status IN ('IN_YESHIVA','OUT_WITH_PERMISSION','OUT_WITHOUT_PERMISSION')),
  note                            TEXT CHECK (note IS NULL OR char_length(note) <= 500),
  source                          TEXT NOT NULL DEFAULT 'SUPERVISOR'
                                  CHECK (source IN ('SUPERVISOR','AUTO_DEFAULT')),
  had_active_departure_at_audit   BOOLEAN NOT NULL DEFAULT FALSE,
  submitted_by                    TEXT NOT NULL,
  submitted_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS audit_entries_session_student
  ON audit_entries(session_id, student_snapshot_idx);
CREATE INDEX IF NOT EXISTS audit_entries_session_idx
  ON audit_entries(session_id);
CREATE INDEX IF NOT EXISTS audit_entries_session_class_idx
  ON audit_entries(session_id, class_id);
CREATE INDEX IF NOT EXISTS audit_entries_session_status_idx
  ON audit_entries(session_id, status);
CREATE INDEX IF NOT EXISTS audit_entries_session_submitted_idx
  ON audit_entries(session_id, submitted_at DESC);
-- Specialised index for the urgent alert query — only OUT_WITHOUT_PERMISSION rows.
CREATE INDEX IF NOT EXISTS audit_entries_unauthorized_idx
  ON audit_entries(session_id, submitted_at DESC)
  WHERE status='OUT_WITHOUT_PERMISSION';

CREATE OR REPLACE FUNCTION audit_entries_bump_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Normalize note: trim and collapse empty → NULL.
  IF NEW.note IS NOT NULL THEN
    NEW.note := NULLIF(btrim(NEW.note), '');
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_entries_bump_updated_at_trg ON audit_entries;
CREATE TRIGGER audit_entries_bump_updated_at_trg
  BEFORE INSERT OR UPDATE ON audit_entries
  FOR EACH ROW EXECUTE FUNCTION audit_entries_bump_updated_at();

-- ============================================================================
-- View: v_audit_session_summary (for history list page)
-- ============================================================================
CREATE OR REPLACE VIEW v_audit_session_summary AS
SELECT
  s.id,
  s.title,
  s.started_at,
  s.closed_at,
  s.status,
  s.class_ids,
  s.total_students_snapshot,
  COUNT(e.*) FILTER (WHERE e.status='IN_YESHIVA')              AS in_yeshiva_count,
  COUNT(e.*) FILTER (WHERE e.status='OUT_WITH_PERMISSION')     AS out_with_perm_count,
  COUNT(e.*) FILTER (WHERE e.status='OUT_WITHOUT_PERMISSION')  AS out_without_perm_count,
  COUNT(e.*)                                                    AS marked_count,
  GREATEST(0, s.total_students_snapshot - COUNT(e.*)::INT)      AS unmarked_count,
  EXTRACT(EPOCH FROM (COALESCE(s.closed_at, now()) - s.started_at))::INT AS duration_sec
FROM audit_sessions s
LEFT JOIN audit_entries e ON e.session_id = s.id
GROUP BY s.id;

GRANT SELECT ON v_audit_session_summary TO authenticated, anon;

-- ============================================================================
-- RLS — read-all + service-only direct writes; mutations via SECURITY DEFINER RPCs
-- ============================================================================
ALTER TABLE audit_sessions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_class_states  ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_entries       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_sessions_read_all       ON audit_sessions;
DROP POLICY IF EXISTS audit_sessions_service_write  ON audit_sessions;
CREATE POLICY audit_sessions_read_all ON audit_sessions
  FOR SELECT USING (true);
CREATE POLICY audit_sessions_service_write ON audit_sessions
  FOR ALL USING (auth.role() = 'service_role')
            WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS audit_class_states_read_all      ON audit_class_states;
DROP POLICY IF EXISTS audit_class_states_service_write ON audit_class_states;
CREATE POLICY audit_class_states_read_all ON audit_class_states
  FOR SELECT USING (true);
CREATE POLICY audit_class_states_service_write ON audit_class_states
  FOR ALL USING (auth.role() = 'service_role')
            WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS audit_entries_read_all      ON audit_entries;
DROP POLICY IF EXISTS audit_entries_service_write ON audit_entries;
CREATE POLICY audit_entries_read_all ON audit_entries
  FOR SELECT USING (true);
CREATE POLICY audit_entries_service_write ON audit_entries
  FOR ALL USING (auth.role() = 'service_role')
            WITH CHECK (auth.role() = 'service_role');

-- ============================================================================
-- Realtime publication (idempotent)
-- ============================================================================
DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE audit_sessions;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE audit_class_states;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE audit_entries;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- ============================================================================
-- Helper: resolve supervisor PIN to class_id (or NULL if invalid)
-- ============================================================================
CREATE OR REPLACE FUNCTION _resolve_supervisor_class(p_pin TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF p_pin IS NULL OR length(p_pin) < 4 THEN
    RETURN NULL;
  END IF;
  v_result := verify_supervisor_pin(p_pin);
  IF v_result ? 'error' THEN
    RETURN NULL;
  END IF;
  RETURN v_result->>'classId';
END;
$$;

REVOKE ALL ON FUNCTION _resolve_supervisor_class FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- RPC: start_audit_session
-- ============================================================================
CREATE OR REPLACE FUNCTION start_audit_session(
  p_class_ids TEXT[],
  p_title     TEXT,
  p_admin_pin TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id      UUID;
  v_session_id       UUID;
  v_student_snap     JSONB;
  v_class_snap       JSONB;
  v_active_dep_snap  JSONB;
  v_total_students   INT;
  v_student_ids      TEXT[];
BEGIN
  -- 1. Verify admin pin
  IF NOT verify_admin_pin(p_admin_pin) THEN
    RETURN jsonb_build_object('error', 'AUTH');
  END IF;

  -- 2. Validate input
  IF p_class_ids IS NULL OR array_length(p_class_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('error', 'NO_CLASSES');
  END IF;

  -- 3. Serialise concurrent starts
  LOCK TABLE audit_sessions IN SHARE ROW EXCLUSIVE MODE;

  -- 4. Reject if there's already an active session
  SELECT id INTO v_existing_id FROM audit_sessions WHERE status='ACTIVE' LIMIT 1;
  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'ALREADY_ACTIVE', 'existingId', v_existing_id::TEXT);
  END IF;

  -- 5. Snapshot students (frozen at session start; survives sheet sync mid-audit)
  SELECT
    COUNT(*),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id',       s.id,
          'fullName', s."fullName",
          'idNumber', s."idNumber",
          'classId',  s."classId",
          'grade',    s.grade
        )
        ORDER BY s.grade, s."classId", s."fullName"
      ),
      '[]'::jsonb
    ),
    COALESCE(array_agg(s.id ORDER BY s.grade, s."classId", s."fullName"), ARRAY[]::TEXT[])
  INTO v_total_students, v_student_snap, v_student_ids
  FROM students s
  WHERE s."classId" = ANY(p_class_ids);

  IF v_total_students = 0 THEN
    RETURN jsonb_build_object('error', 'NO_STUDENTS_IN_CLASSES');
  END IF;

  -- 6. Snapshot classes (with student counts)
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'classId',      t."classId",
        'grade',        t.grade,
        'studentCount', t.cnt
      )
      ORDER BY t.grade, t."classId"
    ),
    '[]'::jsonb
  )
  INTO v_class_snap
  FROM (
    SELECT s."classId", MIN(s.grade) AS grade, COUNT(*)::INT AS cnt
    FROM students s
    WHERE s."classId" = ANY(p_class_ids)
    GROUP BY s."classId"
  ) t;

  -- 7. Snapshot ACTIVE departures (only — not APPROVED/PENDING/etc.)
  --    These drive the OUT_WITH_PERMISSION default.
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'studentId',   d.student_id,
        'departureId', d.id::TEXT,
        'endAt',       d.end_at,
        'reason',      d.reason
      )
    ),
    '[]'::jsonb
  )
  INTO v_active_dep_snap
  FROM departures d
  WHERE d.student_id = ANY(v_student_ids)
    AND d.status = 'ACTIVE';

  -- 8. Insert the session row
  INSERT INTO audit_sessions (
    title, started_by, class_ids, total_students_snapshot,
    class_snapshot, student_snapshot, active_departures_snapshot
  ) VALUES (
    NULLIF(btrim(p_title), ''), 'admin', p_class_ids, v_total_students,
    v_class_snap, v_student_snap, v_active_dep_snap
  )
  RETURNING id INTO v_session_id;

  -- 9. Initialise per-class state rows
  INSERT INTO audit_class_states (session_id, class_id, status)
  SELECT v_session_id, unnest(p_class_ids), 'NOT_STARTED';

  -- 10. Pre-seed AUTO_DEFAULT entries for students with ACTIVE departures at session start
  WITH active_students AS (
    SELECT
      idx - 1 AS snap_idx,
      (snap->>'id')::TEXT       AS student_id,
      (snap->>'classId')::TEXT  AS class_id,
      (snap->>'grade')::TEXT    AS grade
    FROM jsonb_array_elements(v_student_snap) WITH ORDINALITY AS arr(snap, idx)
    WHERE EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_active_dep_snap) AS dep
      WHERE dep->>'studentId' = snap->>'id'
    )
  )
  INSERT INTO audit_entries (
    session_id, student_id, student_snapshot_idx, class_id, grade,
    status, source, had_active_departure_at_audit, submitted_by
  )
  SELECT
    v_session_id, a.student_id, a.snap_idx, a.class_id, a.grade,
    'OUT_WITH_PERMISSION', 'AUTO_DEFAULT', TRUE, 'system'
  FROM active_students a;

  -- 11. Return camelCase row for the client
  --     (audit_sessions row itself is the audit trail — no admin_overrides
  --      log because that table requires a non-empty studentId FK.)
  RETURN (
    SELECT to_jsonb(t) FROM (
      SELECT
        s.id,
        s.title,
        s.started_at      AS "startedAt",
        s.started_by      AS "startedBy",
        s.class_ids       AS "classIds",
        s.status,
        s.closed_at       AS "closedAt",
        s.closed_by       AS "closedBy",
        s.total_students_snapshot     AS "totalStudentsSnapshot",
        s.class_snapshot              AS "classSnapshot",
        s.student_snapshot            AS "studentSnapshot",
        s.active_departures_snapshot  AS "activeDeparturesSnapshot"
      FROM audit_sessions s WHERE s.id = v_session_id
    ) t
  );
END;
$$;

-- ============================================================================
-- RPC: submit_audit_entry
-- ============================================================================
CREATE OR REPLACE FUNCTION submit_audit_entry(
  p_session_id      UUID,
  p_student_id      TEXT,
  p_status          TEXT,
  p_note            TEXT,
  p_supervisor_pin  TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
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
  -- 1. Validate status
  IF p_status IS NULL OR p_status NOT IN ('IN_YESHIVA','OUT_WITH_PERMISSION','OUT_WITHOUT_PERMISSION') THEN
    RETURN jsonb_build_object('error', 'INVALID_STATUS');
  END IF;

  -- 2. Resolve actor (supervisor or admin)
  v_actor_class_id := _resolve_supervisor_class(p_supervisor_pin);
  IF v_actor_class_id IS NULL THEN
    -- Try admin
    IF verify_admin_pin(p_supervisor_pin) THEN
      v_is_admin := TRUE;
      v_actor_label := 'admin';
    ELSE
      RETURN jsonb_build_object('error', 'AUTH');
    END IF;
  ELSE
    v_actor_label := v_actor_class_id;
  END IF;

  -- 3. Load session, must be ACTIVE
  SELECT * INTO v_session FROM audit_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'SESSION_NOT_FOUND');
  END IF;
  IF v_session.status <> 'ACTIVE' THEN
    RETURN jsonb_build_object('error', 'SESSION_CLOSED');
  END IF;

  -- 4. Locate the student in the session snapshot
  SELECT (idx - 1)::INT, snap
  INTO v_snap_idx, v_snap_record
  FROM jsonb_array_elements(v_session.student_snapshot) WITH ORDINALITY AS arr(snap, idx)
  WHERE snap->>'id' = p_student_id
  LIMIT 1;

  IF v_snap_idx IS NULL THEN
    RETURN jsonb_build_object('error', 'STUDENT_NOT_IN_SESSION');
  END IF;

  v_student_class_id := v_snap_record->>'classId';
  v_student_grade    := v_snap_record->>'grade';

  -- 5. Authorise: supervisor must own this class (admin can mark any)
  IF NOT v_is_admin AND v_actor_class_id <> v_student_class_id THEN
    RETURN jsonb_build_object('error', 'NOT_AUTHORIZED_FOR_CLASS');
  END IF;

  -- 6. Compute had_active_departure_at_audit from snapshot
  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_session.active_departures_snapshot) AS dep
    WHERE dep->>'studentId' = p_student_id
  ) INTO v_had_active_dep;

  -- 7. UPSERT the entry
  INSERT INTO audit_entries (
    session_id, student_id, student_snapshot_idx, class_id, grade,
    status, note, source, had_active_departure_at_audit, submitted_by
  ) VALUES (
    p_session_id, p_student_id, v_snap_idx, v_student_class_id, v_student_grade,
    p_status, p_note, 'SUPERVISOR', v_had_active_dep, v_actor_label
  )
  ON CONFLICT (session_id, student_snapshot_idx) DO UPDATE
    SET status       = EXCLUDED.status,
        note         = EXCLUDED.note,
        source       = 'SUPERVISOR',   -- promote from AUTO_DEFAULT once supervisor confirms
        submitted_by = EXCLUDED.submitted_by;

  -- 8. Transition class state NOT_STARTED → IN_PROGRESS on first supervisor mark
  UPDATE audit_class_states
  SET status = 'IN_PROGRESS',
      started_at = COALESCE(started_at, now())
  WHERE session_id = p_session_id
    AND class_id = v_student_class_id
    AND status = 'NOT_STARTED';

  -- 9. Return the resulting entry (camelCase)
  RETURN (
    SELECT to_jsonb(t) FROM (
      SELECT
        e.id,
        e.session_id   AS "sessionId",
        e.student_id   AS "studentId",
        e.student_snapshot_idx          AS "studentSnapshotIdx",
        e.class_id     AS "classId",
        e.grade,
        e.status,
        e.note,
        e.source,
        e.had_active_departure_at_audit AS "hadActiveDepartureAtAudit",
        e.submitted_by AS "submittedBy",
        e.submitted_at AS "submittedAt",
        e.updated_at   AS "updatedAt"
      FROM audit_entries e
      WHERE e.session_id = p_session_id
        AND e.student_snapshot_idx = v_snap_idx
    ) t
  );
END;
$$;

-- ============================================================================
-- RPC: finish_class_audit
-- ============================================================================
CREATE OR REPLACE FUNCTION finish_class_audit(
  p_session_id      UUID,
  p_class_id        TEXT,
  p_note            TEXT,
  p_supervisor_pin  TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
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
  -- 1. Auth
  v_actor_class_id := _resolve_supervisor_class(p_supervisor_pin);
  IF v_actor_class_id IS NULL THEN
    IF verify_admin_pin(p_supervisor_pin) THEN
      v_is_admin := TRUE;
      v_actor_label := 'admin';
    ELSE
      RETURN jsonb_build_object('error', 'AUTH');
    END IF;
  ELSE
    v_actor_label := v_actor_class_id;
  END IF;

  -- 2. Session must be ACTIVE
  SELECT * INTO v_session FROM audit_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'SESSION_NOT_FOUND');
  END IF;
  IF v_session.status <> 'ACTIVE' THEN
    RETURN jsonb_build_object('error', 'SESSION_CLOSED');
  END IF;

  -- 3. Authorisation
  IF NOT v_is_admin AND v_actor_class_id <> p_class_id THEN
    RETURN jsonb_build_object('error', 'NOT_AUTHORIZED_FOR_CLASS');
  END IF;

  -- 4. Validate class belongs to session
  IF NOT (p_class_id = ANY(v_session.class_ids)) THEN
    RETURN jsonb_build_object('error', 'CLASS_NOT_IN_SESSION');
  END IF;

  -- 5. Compute counts at finish time
  SELECT
    (SELECT COUNT(*) FROM jsonb_array_elements(v_session.student_snapshot) AS s
       WHERE s->>'classId' = p_class_id)::INT,
    COUNT(e.*)::INT,
    COUNT(e.*) FILTER (WHERE e.status='IN_YESHIVA')::INT,
    COUNT(e.*) FILTER (WHERE e.status='OUT_WITH_PERMISSION')::INT,
    COUNT(e.*) FILTER (WHERE e.status='OUT_WITHOUT_PERMISSION')::INT
  INTO v_total_in_class, v_marked, v_in_yeshiva, v_out_with_perm, v_out_without_perm
  FROM audit_entries e
  WHERE e.session_id = p_session_id AND e.class_id = p_class_id;

  -- 6. Update class state
  UPDATE audit_class_states
  SET status                      = 'FINISHED',
      finished_at                 = now(),
      finished_by                 = v_actor_label,
      unmarked_at_finish          = GREATEST(0, v_total_in_class - v_marked),
      in_yeshiva_at_finish        = v_in_yeshiva,
      out_with_perm_at_finish     = v_out_with_perm,
      out_without_perm_at_finish  = v_out_without_perm,
      supervisor_note             = NULLIF(btrim(p_note), '')
  WHERE session_id = p_session_id AND class_id = p_class_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'CLASS_STATE_NOT_FOUND');
  END IF;

  RETURN (
    SELECT to_jsonb(t) FROM (
      SELECT
        cs.id,
        cs.session_id              AS "sessionId",
        cs.class_id                AS "classId",
        cs.status,
        cs.started_at              AS "startedAt",
        cs.finished_at             AS "finishedAt",
        cs.finished_by             AS "finishedBy",
        cs.unmarked_at_finish      AS "unmarkedAtFinish",
        cs.in_yeshiva_at_finish    AS "inYeshivaAtFinish",
        cs.out_with_perm_at_finish AS "outWithPermAtFinish",
        cs.out_without_perm_at_finish AS "outWithoutPermAtFinish",
        cs.supervisor_note         AS "supervisorNote",
        cs.updated_at              AS "updatedAt"
      FROM audit_class_states cs
      WHERE cs.session_id = p_session_id AND cs.class_id = p_class_id
    ) t
  );
END;
$$;

-- ============================================================================
-- RPC: close_audit_session (admin only)
-- ============================================================================
CREATE OR REPLACE FUNCTION close_audit_session(
  p_session_id  UUID,
  p_admin_pin   TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated_id UUID;
BEGIN
  IF NOT verify_admin_pin(p_admin_pin) THEN
    RETURN jsonb_build_object('error', 'AUTH');
  END IF;

  UPDATE audit_sessions
  SET status     = 'CLOSED',
      closed_at  = now(),
      closed_by  = 'admin'
  WHERE id = p_session_id AND status = 'ACTIVE'
  RETURNING id INTO v_updated_id;

  IF v_updated_id IS NULL THEN
    RETURN jsonb_build_object('error', 'NOT_ACTIVE');
  END IF;

  RETURN (
    SELECT to_jsonb(t) FROM (
      SELECT
        s.id,
        s.title,
        s.started_at  AS "startedAt",
        s.started_by  AS "startedBy",
        s.class_ids   AS "classIds",
        s.status,
        s.closed_at   AS "closedAt",
        s.closed_by   AS "closedBy",
        s.total_students_snapshot     AS "totalStudentsSnapshot",
        s.class_snapshot              AS "classSnapshot",
        s.student_snapshot            AS "studentSnapshot",
        s.active_departures_snapshot  AS "activeDeparturesSnapshot"
      FROM audit_sessions s WHERE s.id = p_session_id
    ) t
  );
END;
$$;

-- ============================================================================
-- RPC: get_active_audit_session (open — used by supervisors for discovery)
-- ============================================================================
CREATE OR REPLACE FUNCTION get_active_audit_session()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM audit_sessions WHERE status='ACTIVE' LIMIT 1;
  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN get_audit_session(v_id);
END;
$$;

-- ============================================================================
-- RPC: get_audit_session(p_id) — returns session + entries + class states
-- ============================================================================
CREATE OR REPLACE FUNCTION get_audit_session(p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_json     JSONB;
  v_entries_json     JSONB;
  v_class_states_json JSONB;
BEGIN
  SELECT to_jsonb(t) INTO v_session_json
  FROM (
    SELECT
      s.id,
      s.title,
      s.started_at  AS "startedAt",
      s.started_by  AS "startedBy",
      s.class_ids   AS "classIds",
      s.status,
      s.closed_at   AS "closedAt",
      s.closed_by   AS "closedBy",
      s.total_students_snapshot     AS "totalStudentsSnapshot",
      s.class_snapshot              AS "classSnapshot",
      s.student_snapshot            AS "studentSnapshot",
      s.active_departures_snapshot  AS "activeDeparturesSnapshot"
    FROM audit_sessions s WHERE s.id = p_id
  ) t;

  IF v_session_json IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t."submittedAt"), '[]'::jsonb)
  INTO v_entries_json
  FROM (
    SELECT
      e.id,
      e.session_id   AS "sessionId",
      e.student_id   AS "studentId",
      e.student_snapshot_idx          AS "studentSnapshotIdx",
      e.class_id     AS "classId",
      e.grade,
      e.status,
      e.note,
      e.source,
      e.had_active_departure_at_audit AS "hadActiveDepartureAtAudit",
      e.submitted_by AS "submittedBy",
      e.submitted_at AS "submittedAt",
      e.updated_at   AS "updatedAt"
    FROM audit_entries e WHERE e.session_id = p_id
  ) t;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t."classId"), '[]'::jsonb)
  INTO v_class_states_json
  FROM (
    SELECT
      cs.id,
      cs.session_id              AS "sessionId",
      cs.class_id                AS "classId",
      cs.status,
      cs.started_at              AS "startedAt",
      cs.finished_at             AS "finishedAt",
      cs.finished_by             AS "finishedBy",
      cs.unmarked_at_finish      AS "unmarkedAtFinish",
      cs.in_yeshiva_at_finish    AS "inYeshivaAtFinish",
      cs.out_with_perm_at_finish AS "outWithPermAtFinish",
      cs.out_without_perm_at_finish AS "outWithoutPermAtFinish",
      cs.supervisor_note         AS "supervisorNote",
      cs.updated_at              AS "updatedAt"
    FROM audit_class_states cs WHERE cs.session_id = p_id
  ) t;

  RETURN jsonb_build_object(
    'session', v_session_json,
    'entries', v_entries_json,
    'classStates', v_class_states_json
  );
END;
$$;

-- ============================================================================
-- RPC: list_audit_sessions (paginated summary for history page)
-- ============================================================================
CREATE OR REPLACE FUNCTION list_audit_sessions(
  p_limit  INT DEFAULT 20,
  p_offset INT DEFAULT 0
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_rows JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t."startedAt" DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      v.id,
      v.title,
      v.started_at  AS "startedAt",
      v.closed_at   AS "closedAt",
      v.status,
      v.class_ids   AS "classIds",
      v.total_students_snapshot     AS "totalStudentsSnapshot",
      v.in_yeshiva_count            AS "inYeshivaCount",
      v.out_with_perm_count         AS "outWithPermCount",
      v.out_without_perm_count      AS "outWithoutPermCount",
      v.marked_count                AS "markedCount",
      v.unmarked_count              AS "unmarkedCount",
      v.duration_sec                AS "durationSec"
    FROM v_audit_session_summary v
    ORDER BY v.started_at DESC
    LIMIT GREATEST(1, LEAST(p_limit, 100))
    OFFSET GREATEST(0, p_offset)
  ) t;

  RETURN v_rows;
END;
$$;

-- ============================================================================
-- Grants
-- ============================================================================
GRANT EXECUTE ON FUNCTION start_audit_session(TEXT[], TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION submit_audit_entry(UUID, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION finish_class_audit(UUID, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION close_audit_session(UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_active_audit_session() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_audit_session(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION list_audit_sessions(INT, INT) TO anon, authenticated;
