-- Fix foreign key on admin_overrides.studentId to CASCADE on student delete.
-- Without this, deleting a student via Sheets sync fails with a FK violation.
ALTER TABLE admin_overrides
  DROP CONSTRAINT IF EXISTS "admin_overrides_studentId_fkey",
  ADD CONSTRAINT "admin_overrides_studentId_fkey"
    FOREIGN KEY ("studentId")
    REFERENCES students (id)
    ON DELETE CASCADE;
