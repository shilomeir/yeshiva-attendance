-- auto_return_students()
-- When a student's expected return time has passed, automatically set them back to ON_CAMPUS.
-- This replaces the old mark_overdue_students behaviour — instead of marking students as OVERDUE
-- the system now considers them returned once their scheduled time arrives.
-- Run this on a cron (e.g. every 5 minutes) or from the client-side polling interval.
--
-- NOTE: "expectedReturn" is stored as TEXT (ISO-8601 string) in the events table.
-- The explicit ::timestamptz cast is required to compare it against NOW().

CREATE OR REPLACE FUNCTION auto_return_students()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  affected integer;
BEGIN
  WITH latest_checkouts AS (
    SELECT DISTINCT ON ("studentId")
      "studentId",
      "expectedReturn"
    FROM events
    WHERE type = 'CHECK_OUT'
      AND "expectedReturn" IS NOT NULL
    ORDER BY "studentId", timestamp DESC
  )
  UPDATE students s
  SET "currentStatus" = 'ON_CAMPUS',
      "lastSeen"      = NOW()
  FROM latest_checkouts lc
  WHERE s.id = lc."studentId"
    AND s."currentStatus" IN ('OFF_CAMPUS', 'OVERDUE')
    -- Cast text → timestamptz because expectedReturn is stored as an ISO-8601 text column
    AND lc."expectedReturn"::timestamptz < NOW();

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

-- Also auto-return any students currently stuck in OVERDUE immediately
SELECT auto_return_students();
