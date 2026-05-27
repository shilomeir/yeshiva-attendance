-- Internal Audit: missing RLS SELECT policies.
--
-- The six audit_* tables were created with RLS enabled (project default) but
-- with zero policies, which silently blocked the anon client from reading
-- them. Direct frontend queries in src/features/internal-audit/api/auditApi.ts
-- (getSession, getSessionClasses, getParticipants, getLocationResponses,
-- getManualMarks, getAlerts) all returned empty results in production.
--
-- Writes are unaffected — every write path goes through SECURITY DEFINER
-- RPCs (create/activate/complete/cancel_audit_session, record_audit_*,
-- record_manual_audit_mark, resolve_audit_alert) which bypass RLS.
--
-- This mirrors the read-all pattern used by departures_read_all and
-- students_read_all.

CREATE POLICY audit_sessions_read_all
  ON public.audit_sessions
  FOR SELECT
  USING (true);

CREATE POLICY audit_session_classes_read_all
  ON public.audit_session_classes
  FOR SELECT
  USING (true);

CREATE POLICY audit_participants_read_all
  ON public.audit_participants
  FOR SELECT
  USING (true);

CREATE POLICY audit_location_responses_read_all
  ON public.audit_location_responses
  FOR SELECT
  USING (true);

CREATE POLICY audit_manual_marks_read_all
  ON public.audit_manual_marks
  FOR SELECT
  USING (true);

CREATE POLICY audit_alerts_read_all
  ON public.audit_alerts
  FOR SELECT
  USING (true);
