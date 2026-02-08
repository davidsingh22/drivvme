
-- Drop restrictive UPDATE policies and recreate as PERMISSIVE
DROP POLICY "Riders can update their own rides" ON public.rides;
DROP POLICY "Drivers can update rides they accepted" ON public.rides;
DROP POLICY "drivers_can_accept_searching_rides" ON public.rides;

CREATE POLICY "Riders can update their own rides"
  ON public.rides FOR UPDATE TO authenticated
  USING (auth.uid() = rider_id);

CREATE POLICY "Drivers can update rides they accepted"
  ON public.rides FOR UPDATE TO authenticated
  USING (auth.uid() = driver_id);

CREATE POLICY "drivers_can_accept_searching_rides"
  ON public.rides FOR UPDATE TO authenticated
  USING (is_driver(auth.uid()) AND status = 'searching' AND driver_id IS NULL)
  WITH CHECK (driver_id = auth.uid());
