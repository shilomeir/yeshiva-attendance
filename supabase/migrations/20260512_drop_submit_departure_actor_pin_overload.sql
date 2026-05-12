-- Drop the 11-param overload of submit_departure that included p_actor_pin.
-- That parameter was never part of the intended RPC signature and caused PostgREST
-- to fail with "not found in schema cache" when both overloads existed simultaneously.
DROP FUNCTION IF EXISTS public.submit_departure(
  text, timestamptz, timestamptz, text, boolean, text, text, boolean, text, text, text
);

NOTIFY pgrst, 'reload schema';
