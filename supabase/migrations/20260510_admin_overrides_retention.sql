-- Hard-delete admin audit log rows after a short 48-hour retention window.
-- This keeps admin_overrides from growing indefinitely; rows are deleted from
-- storage, not merely filtered out of the dashboard UI.

CREATE OR REPLACE FUNCTION purge_admin_overrides_retention()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INT := 0;
BEGIN
  DELETE FROM admin_overrides
  WHERE CASE
      WHEN timestamp IS NULL OR btrim(timestamp::TEXT) = '' THEN NULL
      ELSE timestamp::TIMESTAMPTZ
    END < NOW() - INTERVAL '48 hours';

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION purge_admin_overrides_retention() TO authenticated;
GRANT EXECUTE ON FUNCTION purge_admin_overrides_retention() TO anon;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('purge-admin-overrides-retention');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    PERFORM cron.schedule(
      'purge-admin-overrides-retention',
      '0 2 */2 * *',
      'SELECT public.purge_admin_overrides_retention()'
    );
  END IF;
END;
$$;
