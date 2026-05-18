-- Audit Phase 1 — Foundation fixes flagged by Supabase database linter
-- (a) drop dead 3-arg overload of start_audit_session left behind by Phase 0
-- (b) lock down search_path on the two trigger functions for audit_* tables
-- (c) force security_invoker on v_audit_session_summary so it respects caller RLS

BEGIN;

-- (a) Remove the 3-arg overload — Phase 0 added a 4-arg version with default
-- mode but didn't drop the original. Both compile, and PostgREST resolves the
-- 4-arg form via named parameters, but the duplicate trips the security linter
-- and confuses anyone reading the schema. The 4-arg version subsumes it.
DROP FUNCTION IF EXISTS public.start_audit_session(text[], text, text);

-- (b) Lock down search_path on the BEFORE-trigger functions. Without this they
-- inherit the caller's search_path, which the linter flags as a privilege
-- escalation vector when the table's RLS would otherwise have caught it.
ALTER FUNCTION public.audit_class_states_bump_updated_at() SET search_path = public;
ALTER FUNCTION public.audit_entries_bump_updated_at()      SET search_path = public;

-- (c) View is owned by postgres so without security_invoker it effectively runs
-- with superuser privileges from the caller's POV. The underlying tables already
-- have permissive read-all RLS so this is just hygiene — no behavioural change
-- for anon/authenticated callers.
ALTER VIEW public.v_audit_session_summary SET (security_invoker = true);

COMMIT;
