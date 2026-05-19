-- Migration: 20260510_verify_actor_pin.sql
-- Adds server-side PIN verification for ADMIN_OVERRIDE departures.
-- Any caller could previously pass p_source='ADMIN_OVERRIDE', p_actor_role='ADMIN'
-- and bypass quota enforcement. Now the admin PIN is verified server-side.

CREATE OR REPLACE FUNCTION _verify_admin_pin_internal(p_pin TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_stored TEXT;
BEGIN
  SELECT value INTO v_stored FROM app_settings WHERE key = 'admin_pin';
  RETURN p_pin IS NOT NULL AND p_pin = v_stored;
END;
$$;

REVOKE ALL ON FUNCTION _verify_admin_pin_internal FROM PUBLIC;
REVOKE ALL ON FUNCTION _verify_admin_pin_internal FROM anon;
REVOKE ALL ON FUNCTION _verify_admin_pin_internal FROM authenticated;
