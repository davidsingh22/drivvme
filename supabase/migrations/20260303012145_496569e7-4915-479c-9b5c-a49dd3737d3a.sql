-- TEMP DEBUG BYPASS: allow public rider_locations writes until 2026-03-03T01:51:25Z
CREATE OR REPLACE FUNCTION public.debug_rider_locations_public_writes_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT now() < TIMESTAMPTZ '2026-03-03T01:51:25Z'
$$;

DROP POLICY IF EXISTS "DEBUG public rider location inserts (30m)" ON public.rider_locations;
DROP POLICY IF EXISTS "DEBUG public rider location updates (30m)" ON public.rider_locations;

CREATE POLICY "DEBUG public rider location inserts (30m)"
ON public.rider_locations
FOR INSERT
TO anon, authenticated
WITH CHECK (public.debug_rider_locations_public_writes_enabled());

CREATE POLICY "DEBUG public rider location updates (30m)"
ON public.rider_locations
FOR UPDATE
TO anon, authenticated
USING (public.debug_rider_locations_public_writes_enabled())
WITH CHECK (public.debug_rider_locations_public_writes_enabled());