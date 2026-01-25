-- Allow riders to send messages (notifications) to drivers on their active rides
CREATE POLICY "riders_can_notify_driver_for_their_rides"
ON public.notifications
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM rides r
    WHERE r.id = notifications.ride_id
      AND r.rider_id = auth.uid()
      AND notifications.user_id = r.driver_id
      AND r.status IN ('driver_assigned', 'driver_en_route', 'arrived', 'in_progress')
  )
);