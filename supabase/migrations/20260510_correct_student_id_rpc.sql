-- Migration: 20260510_correct_student_id_rpc.sql
-- Safe idNumber correction. Updating idNumber in Google Sheets without running
-- this first causes sync to hard-delete the old row (CASCADE) and create a fresh
-- one with zero history. This RPC preserves the UUID and all FK relationships.
--
-- USAGE (before fixing the sheet):
--   SELECT correct_student_id_number('OLD_ID', 'NEW_ID');
-- Then run the sync. If you sync first, all history is destroyed.

CREATE OR REPLACE FUNCTION correct_student_id_number(
  p_old_id TEXT,
  p_new_id TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Updates only the idNumber field. The student's UUID (primary key) stays the same.
  -- All FK relationships (departures.student_id, events.studentId) are unaffected
  -- because they reference the UUID, not idNumber.
  UPDATE students SET "idNumber" = p_new_id WHERE "idNumber" = p_old_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student with idNumber % not found', p_old_id;
  END IF;
END;
$$;
