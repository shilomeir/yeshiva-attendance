-- Add indexes on foreign key columns for better query performance
-- These are on tables referenced in WHERE clauses and JOINs

-- admin_overrides: queries by studentId and adminId
CREATE INDEX IF NOT EXISTS idx_admin_overrides_student_id
  ON admin_overrides ("studentId");

CREATE INDEX IF NOT EXISTS idx_admin_overrides_admin_id
  ON admin_overrides ("adminId");

-- admin_overrides: filters by action type
CREATE INDEX IF NOT EXISTS idx_admin_overrides_action
  ON admin_overrides (action);

-- departures: FK and status filtering (critical for active queries)
CREATE INDEX IF NOT EXISTS idx_departures_student_id_status
  ON departures (student_id, status);

-- departures: queries by class_id
CREATE INDEX IF NOT EXISTS idx_departures_class_id
  ON departures (class_id);

-- departures: time-based queries
CREATE INDEX IF NOT EXISTS idx_departures_start_at
  ON departures (start_at);

CREATE INDEX IF NOT EXISTS idx_departures_end_at
  ON departures (end_at);
