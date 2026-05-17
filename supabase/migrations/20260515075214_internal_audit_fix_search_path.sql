-- Internal Audit: Fix search_path on RPCs to prevent search-path injection.
-- All audit RPCs already have SET search_path TO 'public' (or 'public','extensions').
-- This migration documents the fix — the RPCs in 20260515071750 already include it.
-- No schema changes needed; this file is a marker.

-- (No SQL needed — search_path is set in all function definitions above.)
SELECT 1;
