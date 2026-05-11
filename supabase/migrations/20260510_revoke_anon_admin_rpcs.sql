-- Migration: 20260510_revoke_anon_admin_rpcs.sql
-- Revoke anon/public access from admin-only RPCs.
-- Student-facing RPCs (submit_departure, cancel_departure, return_departure,
-- verify_admin_pin, verify_supervisor_pin) remain accessible to anon because
-- students have no Supabase Auth accounts and use the anon key.

REVOKE EXECUTE ON FUNCTION approve_departure   FROM anon;
REVOKE EXECUTE ON FUNCTION approve_departure   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION reject_departure    FROM anon;
REVOKE EXECUTE ON FUNCTION reject_departure    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION change_admin_pin    FROM anon;
REVOKE EXECUTE ON FUNCTION change_admin_pin    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION sync_student_from_sheet  FROM anon;
REVOKE EXECUTE ON FUNCTION sync_student_from_sheet  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION correct_student_id_number FROM anon;
REVOKE EXECUTE ON FUNCTION correct_student_id_number FROM PUBLIC;

GRANT EXECUTE ON FUNCTION approve_departure       TO service_role;
GRANT EXECUTE ON FUNCTION reject_departure        TO service_role;
GRANT EXECUTE ON FUNCTION change_admin_pin        TO service_role;
GRANT EXECUTE ON FUNCTION sync_student_from_sheet TO service_role;
GRANT EXECUTE ON FUNCTION correct_student_id_number TO service_role;

-- Admin logs in via supabase.auth.signInWithPassword → authenticated role
GRANT EXECUTE ON FUNCTION change_admin_pin        TO authenticated;
GRANT EXECUTE ON FUNCTION approve_departure       TO authenticated;
GRANT EXECUTE ON FUNCTION reject_departure        TO authenticated;
