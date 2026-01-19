-- Drop and recreate the "Drivers can view searching rides" policy as PERMISSIVE
DROP POLICY IF EXISTS "Drivers can view searching rides" ON public.rides;

CREATE POLICY "Drivers can view searching rides"
  ON public.rides
  FOR SELECT
  USING (is_driver(auth.uid()) AND status = 'searching'::ride_status);