-- Add CANCELLED to v_calendar_departures for audit history visibility
CREATE OR REPLACE VIEW v_calendar_departures AS
SELECT
  d.id,
  d.student_id,
  d.class_id,
  d.start_at,
  d.end_at,
  d.status,
  d.source,
  d.is_urgent,
  d.reason,
  d.admin_note,
  d.approved_by,
  d.created_at,
  d.approved_at,
  d.activated_at,
  d.completed_at,
  d.cancelled_at,
  d.rejected_at,
  d.gps_lat,
  d.gps_lng,
  s."fullName"  AS student_name,
  s."grade"     AS grade,
  -- Overstay flag: ACTIVE for more than 24 h past end_at (admin alert only)
  (d.status = 'ACTIVE' AND d.end_at < NOW() - INTERVAL '24 hours') AS is_overdue_alert
FROM departures d
JOIN students s ON s.id = d.student_id
WHERE d.status IN ('PENDING','APPROVED','ACTIVE','COMPLETED','CANCELLED');

GRANT SELECT ON v_calendar_departures TO authenticated;
GRANT SELECT ON v_calendar_departures TO anon;
