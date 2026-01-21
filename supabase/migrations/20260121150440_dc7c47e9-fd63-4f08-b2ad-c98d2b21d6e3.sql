-- Allow drivers to accept (claim) a searching ride atomically
-- Without this, drivers cannot UPDATE a ride where driver_id is NULL due to RLS.
DROP POLICY IF EXISTS "drivers_can_accept_searching_rides" ON public.rides;

CREATE POLICY "drivers_can_accept_searching_rides"
ON public.rides
FOR UPDATE
USING (
  public.is_driver(auth.uid())
  AND status = 'searching'::ride_status
  AND driver_id IS NULL
)
WITH CHECK (
  driver_id = auth.uid()
);