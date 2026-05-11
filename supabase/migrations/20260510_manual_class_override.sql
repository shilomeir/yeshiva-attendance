-- Migration: 20260510_manual_class_override.sql
-- Protects admin-assigned class placements from being overwritten by annual sync.

ALTER TABLE students ADD COLUMN IF NOT EXISTS manual_class_override BOOLEAN DEFAULT FALSE;

-- Final version of sync_student_from_sheet (supersedes 20260510_sync_student_rpc.sql)
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
    "currentStatus", "lastSeen", "createdAt", manual_class_override
  )
  VALUES (
    p_id_number, p_full_name, p_phone, p_grade, p_class_id,
    'ON_CAMPUS', now(), now(), FALSE
  )
  ON CONFLICT ("idNumber") DO UPDATE SET
    "fullName" = EXCLUDED."fullName",
    phone      = EXCLUDED.phone,
    -- Respect manual override: if admin set the class, don't overwrite it
    grade    = CASE WHEN students.manual_class_override
                    THEN students.grade    ELSE EXCLUDED.grade    END,
    "classId" = CASE WHEN students.manual_class_override
                    THEN students."classId" ELSE EXCLUDED."classId" END;
    -- NEVER touched on conflict:
    -- "currentStatus", push_token, fcm_token, "deviceToken", "lastSeen"
END;
$$;
