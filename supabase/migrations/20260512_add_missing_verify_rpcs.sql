-- Add missing verify_admin_pin and verify_supervisor_pin RPCs
SET search_path = public;

CREATE OR REPLACE FUNCTION verify_admin_pin(p_pin TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_stored TEXT;
BEGIN
  SELECT value INTO v_stored FROM app_settings WHERE key = 'admin_pin';
  RETURN p_pin IS NOT NULL AND p_pin = v_stored;
END;
$$;

GRANT EXECUTE ON FUNCTION verify_admin_pin TO anon;
GRANT EXECUTE ON FUNCTION verify_admin_pin TO authenticated;
GRANT EXECUTE ON FUNCTION verify_admin_pin TO service_role;

CREATE OR REPLACE FUNCTION verify_supervisor_pin(p_pin TEXT)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_admin_pin TEXT;
  v_admin_part TEXT;
  v_class_code TEXT;
  v_classId TEXT;
  v_gradeName TEXT;
BEGIN
  -- Extract admin PIN and class code from the supervisor PIN
  -- Format: {adminPin}{classCode} where classCode is 3 digits
  IF length(p_pin) < 4 THEN
    RETURN jsonb_build_object('error', 'invalid_pin');
  END IF;

  v_admin_part := substring(p_pin, 1, length(p_pin) - 3);
  v_class_code := substring(p_pin, length(p_pin) - 2, 3);

  -- Verify admin PIN matches
  SELECT value INTO v_admin_pin FROM app_settings WHERE key = 'admin_pin';
  IF v_admin_pin IS NULL OR v_admin_pin != v_admin_part THEN
    RETURN jsonb_build_object('error', 'invalid_admin_pin');
  END IF;

  -- Look up the class from the code
  SELECT
    key,
    substring(key, 'class_code_(.*)') AS extracted_classId,
    value
  INTO v_classId, v_class_code
  FROM app_settings
  WHERE key LIKE 'class_code_%' AND value = v_class_code
  LIMIT 1;

  IF v_classId IS NULL THEN
    RETURN jsonb_build_object('error', 'invalid_class_code');
  END IF;

  -- Extract the classId from the key (remove 'class_code_' prefix)
  v_classId := substring(v_classId, 'class_code_(.*)');

  -- Get the grade name for this class
  SELECT grade INTO v_gradeName
  FROM students
  WHERE "classId" = v_classId
  LIMIT 1;

  IF v_gradeName IS NULL THEN
    RETURN jsonb_build_object('error', 'class_not_found');
  END IF;

  RETURN jsonb_build_object(
    'classId', v_classId,
    'gradeName', v_gradeName
  );
END;
$$;

GRANT EXECUTE ON FUNCTION verify_supervisor_pin TO anon;
GRANT EXECUTE ON FUNCTION verify_supervisor_pin TO authenticated;
GRANT EXECUTE ON FUNCTION verify_supervisor_pin TO service_role;
