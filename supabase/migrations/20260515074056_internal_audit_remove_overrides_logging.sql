-- Internal Audit: Remove admin_overrides logging from audit RPCs.
-- Audit actions are tracked in audit_entries itself; they must not appear in admin_overrides.
-- This migration documents that decision — the RPCs in the previous migration already
-- do not write to admin_overrides. No schema changes needed; this file is a marker.

-- (No SQL needed — the RPCs were already written without admin_overrides integration.)
SELECT 1;
