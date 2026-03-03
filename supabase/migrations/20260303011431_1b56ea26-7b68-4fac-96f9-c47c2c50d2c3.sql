-- Hard-override admin read access for rider location monitoring
ALTER TABLE public.rider_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view all rider locations" ON public.rider_locations;

CREATE POLICY "Admins can view all rider locations"
ON public.rider_locations
FOR SELECT
TO authenticated
USING (public.is_admin(auth.uid()));