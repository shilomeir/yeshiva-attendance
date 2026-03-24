-- Add FCM token column to students table
-- This allows the server to send push notifications to each student's device
-- so GPS can be requested even when the app is closed (Android APK)

ALTER TABLE students ADD COLUMN IF NOT EXISTS fcm_token TEXT;

-- Partial index: only index rows that actually have a token (saves space)
CREATE INDEX IF NOT EXISTS students_fcm_token_idx
  ON students (fcm_token)
  WHERE fcm_token IS NOT NULL;
