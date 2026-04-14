-- Performance indexes for dashboard and attendance queries
-- Run in Supabase Dashboard → SQL Editor

-- students: dashboard stats, class stats, and quota checks all filter/group by currentStatus
CREATE INDEX IF NOT EXISTS idx_students_current_status
  ON students ("currentStatus");

-- students: class supervisor and quota checks filter by classId
CREATE INDEX IF NOT EXISTS idx_students_class_id
  ON students ("classId");

-- students: grade filter used in StudentsPage and class stats
CREATE INDEX IF NOT EXISTS idx_students_grade
  ON students ("grade");

-- students: long-absent query filters OFF_CAMPUS + lastSeen < cutoff
CREATE INDEX IF NOT EXISTS idx_students_last_seen
  ON students ("lastSeen");

-- absence_requests: dashboard and request pages filter heavily by status
CREATE INDEX IF NOT EXISTS idx_absence_requests_status
  ON absence_requests (status);

-- absence_requests: per-student request lookups
CREATE INDEX IF NOT EXISTS idx_absence_requests_student_id
  ON absence_requests ("studentId");

-- absence_requests: urgent quota-exempt check filters by date + isUrgent + status
CREATE INDEX IF NOT EXISTS idx_absence_requests_urgent
  ON absence_requests ("studentId", "isUrgent", status, date)
  WHERE "isUrgent" = true;

-- events: getEvents fetches by studentId ordered by timestamp
CREATE INDEX IF NOT EXISTS idx_events_student_timestamp
  ON events ("studentId", timestamp DESC);

-- events: getDailyPresence and getHourlyDepartures filter by type + timestamp range
CREATE INDEX IF NOT EXISTS idx_events_type_timestamp
  ON events (type, timestamp);
