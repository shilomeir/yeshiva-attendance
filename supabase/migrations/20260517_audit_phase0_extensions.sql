-- Internal Audit Phase 0 — Schema extensions for LOCATION mode, alerts, cron, and fixes.
-- This migration is ADDITIVE — it extends the existing audit_* tables without dropping anything.

BEGIN;

-- ─── 1. Fix audit_sessions.status CHECK (add TIMED_OUT, ABORTED) ─────────────
-- Current: CHECK (status = ANY (ARRAY['ACTIVE','CLOSED']))
ALTER TABLE public.audit_sessions
  DROP CONSTRAINT IF EXISTS audit_sessions_status_check;

ALTER TABLE public.audit_sessions
  ADD CONSTRAINT audit_sessions_status_check
  CHECK (status = ANY (ARRAY['ACTIVE','CLOSED','TIMED_OUT','ABORTED']));

-- ─── 2. Add mode column to audit_sessions ────────────────────────────────────
ALTER TABLE public.audit_sessions
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'MANUAL'
    CHECK (mode IN ('MANUAL','LOCATION'));

-- ─── 3. Add settings column to audit_sessions ────────────────────────────────
ALTER TABLE public.audit_sessions
  ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}';

-- ─── 4. Fix audit_entries.source CHECK (add AUTO_GPS) ────────────────────────
-- Current: CHECK (source = ANY (ARRAY['SUPERVISOR','AUTO_DEFAULT']))
ALTER TABLE public.audit_entries
  DROP CONSTRAINT IF EXISTS audit_entries_source_check;

ALTER TABLE public.audit_entries
  ADD CONSTRAINT audit_entries_source_check
  CHECK (source = ANY (ARRAY['SUPERVISOR','AUTO_DEFAULT','AUTO_GPS']));

-- ─── 5. Add GPS columns to audit_entries ─────────────────────────────────────
ALTER TABLE public.audit_entries
  ADD COLUMN IF NOT EXISTS gps_lat              DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS gps_lng              DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS gps_accuracy_m       DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS distance_from_campus_m DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS distance_bucket      TEXT
    CHECK (distance_bucket IS NULL OR distance_bucket IN ('GREEN','BLUE','ORANGE','RED')),
  ADD COLUMN IF NOT EXISTS gps_status           TEXT
    CHECK (gps_status IS NULL OR gps_status IN ('OK','DENIED','TIMEOUT','OFFLINE','UNAVAILABLE','LOW_ACCURACY'));

-- ─── 6. Rebuild get_audit_session / get_active_audit_session to include new fields ─
CREATE OR REPLACE FUNCTION public.get_audit_session(p_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_session_json JSONB; v_entries_json JSONB; v_class_states_json JSONB;
BEGIN
  SELECT to_jsonb(t) INTO v_session_json FROM (
    SELECT s.id, s.title, s.mode,
      s.started_at AS "startedAt", s.started_by AS "startedBy", s.class_ids AS "classIds",
      s.status, s.closed_at AS "closedAt", s.closed_by AS "closedBy",
      s.total_students_snapshot AS "totalStudentsSnapshot", s.class_snapshot AS "classSnapshot",
      s.student_snapshot AS "studentSnapshot", s.active_departures_snapshot AS "activeDeparturesSnapshot",
      s.settings
    FROM audit_sessions s WHERE s.id = p_id) t;
  IF v_session_json IS NULL THEN RETURN NULL; END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t."submittedAt"), '[]'::jsonb) INTO v_entries_json FROM (
    SELECT e.id, e.session_id AS "sessionId", e.student_id AS "studentId",
      e.student_snapshot_idx AS "studentSnapshotIdx", e.class_id AS "classId", e.grade, e.status, e.note, e.source,
      e.had_active_departure_at_audit AS "hadActiveDepartureAtAudit",
      e.submitted_by AS "submittedBy", e.submitted_at AS "submittedAt", e.updated_at AS "updatedAt",
      e.gps_lat AS "gpsLat", e.gps_lng AS "gpsLng", e.gps_accuracy_m AS "gpsAccuracyM",
      e.distance_from_campus_m AS "distanceFromCampusM", e.distance_bucket AS "distanceBucket",
      e.gps_status AS "gpsStatus"
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

-- ─── 7. Update start_audit_session to accept mode parameter ──────────────────
CREATE OR REPLACE FUNCTION public.start_audit_session(
  p_class_ids  TEXT[],
  p_title      TEXT,
  p_admin_pin  TEXT,
  p_mode       TEXT DEFAULT 'MANUAL'
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
  IF p_mode IS NULL OR p_mode NOT IN ('MANUAL','LOCATION') THEN
    RETURN jsonb_build_object('error', 'INVALID_MODE');
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

  INSERT INTO audit_sessions (title, started_by, class_ids, mode, total_students_snapshot, class_snapshot, student_snapshot, active_departures_snapshot)
  VALUES (NULLIF(btrim(p_title), ''), 'admin', p_class_ids, p_mode, v_total_students, v_class_snap, v_student_snap, v_active_dep_snap)
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
    SELECT s.id, s.title, s.mode, s.started_at AS "startedAt", s.started_by AS "startedBy", s.class_ids AS "classIds",
      s.status, s.closed_at AS "closedAt", s.closed_by AS "closedBy",
      s.total_students_snapshot AS "totalStudentsSnapshot", s.class_snapshot AS "classSnapshot",
      s.student_snapshot AS "studentSnapshot", s.active_departures_snapshot AS "activeDeparturesSnapshot",
      s.settings
    FROM audit_sessions s WHERE s.id = v_session_id) t);
END; $$;

-- ─── 8. audit_alerts table ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL REFERENCES public.audit_sessions(id) ON DELETE CASCADE,
  entry_id        UUID NOT NULL REFERENCES public.audit_entries(id) ON DELETE CASCADE,
  student_id      TEXT,
  student_name    TEXT,
  class_id        TEXT NOT NULL,
  distance_bucket TEXT NOT NULL CHECK (distance_bucket IN ('ORANGE','RED')),
  distance_m      DOUBLE PRECISION,
  gps_lat         DOUBLE PRECISION,
  gps_lng         DOUBLE PRECISION,
  acknowledged    BOOLEAN NOT NULL DEFAULT false,
  acknowledged_by TEXT,
  acknowledged_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_alerts_session_idx
  ON public.audit_alerts (session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_alerts_unacked_idx
  ON public.audit_alerts (session_id)
  WHERE acknowledged = false;

ALTER TABLE public.audit_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_alerts_read_all ON public.audit_alerts FOR SELECT USING (true);
CREATE POLICY audit_alerts_service_write ON public.audit_alerts FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

ALTER PUBLICATION supabase_realtime ADD TABLE public.audit_alerts;

-- ─── 9. audit_push_log table ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_push_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL REFERENCES public.audit_sessions(id) ON DELETE CASCADE,
  student_id      TEXT,
  success         BOOLEAN NOT NULL,
  error_message   TEXT,
  payload_summary TEXT,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_push_log_session_idx
  ON public.audit_push_log (session_id, sent_at DESC);

ALTER TABLE public.audit_push_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_push_log_read_authenticated ON public.audit_push_log
  FOR SELECT USING (auth.role() IN ('authenticated','service_role'));
CREATE POLICY audit_push_log_service_write ON public.audit_push_log FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- ─── 10. Helper: Haversine distance in meters ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_haversine_m(
  lat1 DOUBLE PRECISION, lng1 DOUBLE PRECISION,
  lat2 DOUBLE PRECISION, lng2 DOUBLE PRECISION
) RETURNS DOUBLE PRECISION LANGUAGE sql IMMUTABLE AS $$
SELECT 2 * 6371000 * asin(sqrt(
  sin(radians((lat2 - lat1) / 2))^2 +
  cos(radians(lat1)) * cos(radians(lat2)) *
  sin(radians((lng2 - lng1) / 2))^2
));
$$;

-- ─── 11. Helper: distance → bucket ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_distance_bucket(meters DOUBLE PRECISION)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
SELECT CASE
  WHEN meters <= 300    THEN 'GREEN'
  WHEN meters <= 1000   THEN 'BLUE'
  WHEN meters <= 5000   THEN 'ORANGE'
  ELSE 'RED'
END;
$$;

-- ─── 12. acknowledge_audit_alert RPC ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.acknowledge_audit_alert(
  p_alert_id   UUID,
  p_admin_pin  TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_updated_id UUID;
BEGIN
  IF NOT verify_admin_pin(p_admin_pin) THEN RETURN jsonb_build_object('error', 'AUTH'); END IF;
  UPDATE audit_alerts
    SET acknowledged = true, acknowledged_by = 'admin', acknowledged_at = now()
  WHERE id = p_alert_id AND acknowledged = false
  RETURNING id INTO v_updated_id;
  IF v_updated_id IS NULL THEN RETURN jsonb_build_object('error', 'NOT_FOUND_OR_ALREADY_ACKED'); END IF;
  RETURN jsonb_build_object('ok', true);
END; $$;

GRANT EXECUTE ON FUNCTION public.acknowledge_audit_alert(UUID, TEXT) TO authenticated;

-- ─── 13. Alert trigger on audit_entries ──────────────────────────────────────
-- Fires when distance_bucket transitions to ORANGE or RED
-- Must capture student name from session's student_snapshot
CREATE OR REPLACE FUNCTION public.tg_audit_entries_alert_fn()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_session   audit_sessions%ROWTYPE;
  v_snap_rec  JSONB;
  v_should_alert BOOLEAN := FALSE;
BEGIN
  -- Determine if we should create an alert
  IF TG_OP = 'INSERT' THEN
    v_should_alert := NEW.distance_bucket IN ('ORANGE','RED');
  ELSIF TG_OP = 'UPDATE' THEN
    v_should_alert := (OLD.distance_bucket IS DISTINCT FROM NEW.distance_bucket)
                   AND (NEW.distance_bucket IN ('ORANGE','RED'));
  END IF;

  IF NOT v_should_alert THEN RETURN NEW; END IF;

  -- Fetch session to get student_snapshot
  SELECT * INTO v_session FROM audit_sessions WHERE id = NEW.session_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  -- Find student name from snapshot
  SELECT snap INTO v_snap_rec
  FROM jsonb_array_elements(v_session.student_snapshot) WITH ORDINALITY AS arr(snap, idx)
  WHERE (idx - 1)::INT = NEW.student_snapshot_idx LIMIT 1;

  INSERT INTO audit_alerts (
    session_id, entry_id, student_id, student_name, class_id,
    distance_bucket, distance_m, gps_lat, gps_lng
  ) VALUES (
    NEW.session_id, NEW.id, NEW.student_id,
    COALESCE(v_snap_rec->>'fullName', ''),
    NEW.class_id, NEW.distance_bucket,
    NEW.distance_from_campus_m, NEW.gps_lat, NEW.gps_lng
  );

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS tg_audit_entries_alert ON public.audit_entries;
CREATE TRIGGER tg_audit_entries_alert
  AFTER INSERT OR UPDATE OF distance_bucket ON public.audit_entries
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_entries_alert_fn();

-- ─── 14. tick_audit_timeout cron (every 5 minutes) ───────────────────────────
-- Sessions active for more than 24 hours are auto-closed as TIMED_OUT.
-- This prevents forgotten sessions from blocking all future audits.
SELECT cron.schedule(
  'tick_audit_timeout',
  '*/5 * * * *',
  $$
    UPDATE public.audit_sessions
       SET status = 'TIMED_OUT',
           closed_at = NOW(),
           closed_by = 'AUTO_TIMEOUT'
     WHERE status = 'ACTIVE'
       AND started_at < NOW() - INTERVAL '24 hours';
  $$
);

-- ─── 15. GPS retention cron (daily at 03:15) ─────────────────────────────────
-- Nulls precise GPS coordinates after 90 days to honor the privacy policy.
-- Distance bucket and category are retained indefinitely.
SELECT cron.schedule(
  'audit_gps_retention',
  '15 3 * * *',
  $$
    UPDATE public.audit_entries
       SET gps_lat = NULL,
           gps_lng = NULL,
           gps_accuracy_m = NULL
     WHERE submitted_at < NOW() - INTERVAL '90 days'
       AND (gps_lat IS NOT NULL OR gps_lng IS NOT NULL);
  $$
);

-- ─── 16. Push log retention cron (daily at 03:20) ────────────────────────────
SELECT cron.schedule(
  'audit_push_log_retention',
  '20 3 * * *',
  $$
    DELETE FROM public.audit_push_log WHERE sent_at < NOW() - INTERVAL '30 days';
  $$
);

COMMIT;
