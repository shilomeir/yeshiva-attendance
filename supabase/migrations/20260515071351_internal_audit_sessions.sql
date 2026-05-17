-- Internal Audit Subsystem — Tables, Indexes, RLS, Realtime
-- Reconstructed from production DB (migration was applied but .sql was missing from repo).

BEGIN;

-- ─── audit_sessions ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_sessions (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title                     TEXT,
  started_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_by                TEXT NOT NULL DEFAULT 'admin',
  class_ids                 TEXT[] NOT NULL,
  status                    TEXT NOT NULL DEFAULT 'ACTIVE'
                              CHECK (status = ANY (ARRAY['ACTIVE','CLOSED'])),
  closed_at                 TIMESTAMPTZ,
  closed_by                 TEXT,
  total_students_snapshot   INT NOT NULL,
  class_snapshot            JSONB NOT NULL,
  student_snapshot          JSONB NOT NULL,
  active_departures_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT audit_sessions_class_ids_check CHECK (array_length(class_ids, 1) >= 1)
);

-- Enforce one active session at most
CREATE UNIQUE INDEX IF NOT EXISTS audit_sessions_one_active
  ON public.audit_sessions (status)
  WHERE (status = 'ACTIVE');

CREATE INDEX IF NOT EXISTS audit_sessions_started_at_idx
  ON public.audit_sessions (started_at DESC);

CREATE INDEX IF NOT EXISTS audit_sessions_status_idx
  ON public.audit_sessions (status);

-- ─── audit_class_states ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_class_states (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id                UUID NOT NULL REFERENCES public.audit_sessions(id) ON DELETE CASCADE,
  class_id                  TEXT NOT NULL,
  status                    TEXT NOT NULL DEFAULT 'NOT_STARTED'
                              CHECK (status = ANY (ARRAY['NOT_STARTED','IN_PROGRESS','FINISHED'])),
  started_at                TIMESTAMPTZ,
  finished_at               TIMESTAMPTZ,
  finished_by               TEXT,
  unmarked_at_finish        INT,
  in_yeshiva_at_finish      INT,
  out_with_perm_at_finish   INT,
  out_without_perm_at_finish INT,
  supervisor_note           TEXT,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS audit_class_states_session_class
  ON public.audit_class_states (session_id, class_id);

CREATE INDEX IF NOT EXISTS audit_class_states_session_idx
  ON public.audit_class_states (session_id);

-- ─── audit_entries ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_entries (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id                UUID NOT NULL REFERENCES public.audit_sessions(id) ON DELETE CASCADE,
  student_id                TEXT REFERENCES public.students(id) ON DELETE SET NULL,
  student_snapshot_idx      INT NOT NULL,
  class_id                  TEXT NOT NULL,
  grade                     TEXT NOT NULL,
  status                    TEXT NOT NULL
                              CHECK (status = ANY (ARRAY['IN_YESHIVA','OUT_WITH_PERMISSION','OUT_WITHOUT_PERMISSION'])),
  note                      TEXT CHECK (note IS NULL OR char_length(note) <= 500),
  source                    TEXT NOT NULL DEFAULT 'SUPERVISOR'
                              CHECK (source = ANY (ARRAY['SUPERVISOR','AUTO_DEFAULT'])),
  had_active_departure_at_audit BOOLEAN NOT NULL DEFAULT false,
  submitted_by              TEXT NOT NULL,
  submitted_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One entry per student per session
CREATE UNIQUE INDEX IF NOT EXISTS audit_entries_session_student
  ON public.audit_entries (session_id, student_snapshot_idx);

CREATE INDEX IF NOT EXISTS audit_entries_session_idx
  ON public.audit_entries (session_id);

CREATE INDEX IF NOT EXISTS audit_entries_session_class_idx
  ON public.audit_entries (session_id, class_id);

CREATE INDEX IF NOT EXISTS audit_entries_session_status_idx
  ON public.audit_entries (session_id, status);

CREATE INDEX IF NOT EXISTS audit_entries_session_submitted_idx
  ON public.audit_entries (session_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS audit_entries_unauthorized_idx
  ON public.audit_entries (session_id, submitted_at DESC)
  WHERE (status = 'OUT_WITHOUT_PERMISSION');

-- ─── updated_at triggers ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.audit_class_states_bump_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION public.audit_entries_bump_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS tg_audit_class_states_updated_at ON public.audit_class_states;
CREATE TRIGGER tg_audit_class_states_updated_at
  BEFORE UPDATE ON public.audit_class_states
  FOR EACH ROW EXECUTE FUNCTION public.audit_class_states_bump_updated_at();

DROP TRIGGER IF EXISTS tg_audit_entries_updated_at ON public.audit_entries;
CREATE TRIGGER tg_audit_entries_updated_at
  BEFORE UPDATE ON public.audit_entries
  FOR EACH ROW EXECUTE FUNCTION public.audit_entries_bump_updated_at();

-- ─── v_audit_session_summary (no SECURITY DEFINER) ──────────────────────────
CREATE OR REPLACE VIEW public.v_audit_session_summary AS
SELECT
  s.id,
  s.title,
  s.started_at,
  s.closed_at,
  s.status,
  s.class_ids,
  s.total_students_snapshot,
  COUNT(e.*) FILTER (WHERE e.status = 'IN_YESHIVA')              AS in_yeshiva_count,
  COUNT(e.*) FILTER (WHERE e.status = 'OUT_WITH_PERMISSION')     AS out_with_perm_count,
  COUNT(e.*) FILTER (WHERE e.status = 'OUT_WITHOUT_PERMISSION')  AS out_without_perm_count,
  COUNT(e.*)                                                      AS marked_count,
  GREATEST(0, s.total_students_snapshot - COUNT(e.*)::INT)       AS unmarked_count,
  EXTRACT(epoch FROM COALESCE(s.closed_at, now()) - s.started_at)::INT AS duration_sec
FROM public.audit_sessions s
LEFT JOIN public.audit_entries e ON e.session_id = s.id
GROUP BY s.id;

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.audit_sessions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_class_states  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_entries       ENABLE ROW LEVEL SECURITY;

-- Anyone can read (RPCs are SECURITY DEFINER and enforce auth internally)
DROP POLICY IF EXISTS audit_sessions_read_all     ON public.audit_sessions;
DROP POLICY IF EXISTS audit_class_states_read_all ON public.audit_class_states;
DROP POLICY IF EXISTS audit_entries_read_all      ON public.audit_entries;

CREATE POLICY audit_sessions_read_all
  ON public.audit_sessions FOR SELECT USING (true);
CREATE POLICY audit_class_states_read_all
  ON public.audit_class_states FOR SELECT USING (true);
CREATE POLICY audit_entries_read_all
  ON public.audit_entries FOR SELECT USING (true);

-- Only service_role can write (all mutations go through SECURITY DEFINER RPCs)
DROP POLICY IF EXISTS audit_sessions_service_write     ON public.audit_sessions;
DROP POLICY IF EXISTS audit_class_states_service_write ON public.audit_class_states;
DROP POLICY IF EXISTS audit_entries_service_write      ON public.audit_entries;

CREATE POLICY audit_sessions_service_write
  ON public.audit_sessions FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY audit_class_states_service_write
  ON public.audit_class_states FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY audit_entries_service_write
  ON public.audit_entries FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ─── Realtime ─────────────────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE public.audit_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.audit_class_states;
ALTER PUBLICATION supabase_realtime ADD TABLE public.audit_entries;

COMMIT;
