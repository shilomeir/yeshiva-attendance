-- Migration: 20260510_sync_student_rpc.sql
-- Safe student upsert from sheet sync: never overwrites currentStatus, push_token,
-- fcm_token, deviceToken, or lastSeen on conflict (students currently off-campus
-- were being silently reset to ON_CAMPUS on every sync).

CREATE OR REPLACE FUNCTION sync_student_from_sheet(
  p_id_number TEXT,
  p_full_name TEXT,
  p_phone     TEXT,
  p_grade     TEXT,
  p_class_id  TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO students (
    "idNumber", "fullName", phone, grade, "classId",
    "currentStatus", "lastSeen", "createdAt"
  )
  VALUES (
    p_id_number, p_full_name, p_phone, p_grade, p_class_id,
    'ON_CAMPUS', now(), now()
  )
  ON CONFLICT ("idNumber") DO UPDATE SET
    "fullName" = EXCLUDED."fullName",
    grade      = EXCLUDED.grade,
    "classId"  = EXCLUDED."classId",
    phone      = EXCLUDED.phone;
    -- NEVER updated on conflict:
    -- "currentStatus" — could be OFF_CAMPUS right now (active departure)
    -- push_token      — registered on the student's device, not in the sheet
    -- fcm_token       — same
    -- "deviceToken"   — same
    -- "lastSeen"      — reflects actual last activity
END;
$$;
