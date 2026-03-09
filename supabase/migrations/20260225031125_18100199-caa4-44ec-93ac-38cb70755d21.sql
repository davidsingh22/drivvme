-- Allow riders to delete new_ride notifications for their own rides
-- This enables cleanup when a rider cancels a ride
CREATE POLICY "riders_can_delete_notifications_for_their_rides"
ON public.notifications
FOR DELETE
USING (
  type = 'new_ride' AND
  EXISTS (
    SELECT 1 FROM rides r
    WHERE r.id = notifications.ride_id
    AND r.rider_id = auth.uid()
  )
);