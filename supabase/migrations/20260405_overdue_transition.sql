-- ─────────────────────────────────────────────────────────────────────────────
-- mark_overdue_students
-- Scans every OFF_CAMPUS student and promotes them to OVERDUE when their most
-- recent CHECK_OUT's expectedReturn timestamp has passed.
-- Returns the number of students whose status was changed.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION mark_overdue_students()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  updated_count integer;
BEGIN
  UPDATE students
  SET    "currentStatus" = 'OVERDUE'
  WHERE  "currentStatus" = 'OFF_CAMPUS'
    AND  id IN (
           SELECT DISTINCT ON ("studentId") "studentId"
           FROM   events
           WHERE  type             = 'CHECK_OUT'
             AND  "expectedReturn" IS NOT NULL
             AND  "expectedReturn" < NOW()
           ORDER  BY "studentId", timestamp DESC
         );

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

-- Allow both authenticated users and the anon key to call this function
GRANT EXECUTE ON FUNCTION mark_overdue_students() TO authenticated;
GRANT EXECUTE ON FUNCTION mark_overdue_students() TO anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- pg_cron schedule (runs every 5 minutes)
-- Only installed when the pg_cron extension is enabled on this project.
-- If pg_cron is not available the client-side 60-second interval in
-- DashboardPage serves as the fallback.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'mark-overdue-students',
      '*/5 * * * *',
      $$SELECT mark_overdue_students()$$
    );
  END IF;
END;
$$;
