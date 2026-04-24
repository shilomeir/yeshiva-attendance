-- Root-cause fix for sync-from-sheets FK violation:
--
-- When sync-from-sheets upserts students WITHOUT supplying `id`, PostgREST generates a
-- fresh gen_random_uuid() for EXCLUDED.id and includes it in the ON CONFLICT DO UPDATE
-- SET clause, effectively replacing each existing student's UUID with a new one.
-- All child FK references (events, admin_overrides, absence_requests, …) are
-- ON UPDATE NO ACTION, so any PK change raises:
--   "update or delete on table students violates foreign key constraint … on table admin_overrides"
--
-- Fix: BEFORE UPDATE trigger that reverts any attempt to change students.id.
-- Transparent to all callers — no Edge Function or client code change needed.

CREATE OR REPLACE FUNCTION students_preserve_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    NEW.id := OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS students_preserve_id_trigger ON students;

CREATE TRIGGER students_preserve_id_trigger
  BEFORE UPDATE ON students
  FOR EACH ROW
  EXECUTE FUNCTION students_preserve_id();
