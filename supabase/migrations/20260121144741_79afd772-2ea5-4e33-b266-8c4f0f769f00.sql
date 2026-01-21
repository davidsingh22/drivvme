-- Allow drivers to create notifications for the rider of a ride they are assigned to
-- This enables an in-app notification/toast even when push notifications are disabled.
DROP POLICY IF EXISTS "drivers_can_notify_rider_for_assigned_rides" ON public.notifications;

CREATE POLICY "drivers_can_notify_rider_for_assigned_rides"
ON public.notifications
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.rides r
    WHERE r.id = notifications.ride_id
      AND r.driver_id = auth.uid()
      AND notifications.user_id = r.rider_id
  )
);