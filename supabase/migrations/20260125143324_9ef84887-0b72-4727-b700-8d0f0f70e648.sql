-- Fix INSERT policy to accept either sender_id or sender_user_id matching auth.uid()
DROP POLICY IF EXISTS "Users can send messages during active rides" ON public.ride_messages;
CREATE POLICY "Users can send messages during active rides"
ON public.ride_messages
FOR INSERT
WITH CHECK (
  (auth.uid() = sender_id OR auth.uid() = sender_user_id)
  AND can_send_ride_message(ride_id, auth.uid())
  AND (
    (sender_role = 'rider' AND EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.id = ride_messages.ride_id AND r.rider_id = auth.uid()
    ))
    OR
    (sender_role = 'driver' AND EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.id = ride_messages.ride_id AND r.driver_id = auth.uid()
    ))
  )
);