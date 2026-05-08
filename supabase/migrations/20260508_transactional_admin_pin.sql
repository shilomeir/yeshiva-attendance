CREATE OR REPLACE FUNCTION public.change_admin_pin(p_old_pin text, p_new_pin text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  stored text;
BEGIN
  SELECT value INTO stored
  FROM public.app_settings
  WHERE key = 'admin_pin'
  FOR UPDATE;

  IF stored IS NULL OR stored <> p_old_pin THEN
    RETURN false;
  END IF;

  UPDATE public.app_settings
  SET value = p_new_pin
  WHERE key = 'admin_pin';

  UPDATE auth.users
  SET encrypted_password = extensions.crypt(p_new_pin, extensions.gen_salt('bf')),
      updated_at = now()
  WHERE email = 'admin@yeshiva.local';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Admin auth user not found';
  END IF;

  RETURN true;
END;
$$;