-- Drop existing RLS policies on ride_messages
DROP POLICY IF EXISTS "Users can send messages during active rides" ON public.ride_messages;
DROP POLICY IF EXISTS "Users can view messages for their rides" ON public.ride_messages;

-- Create simplified and reliable RLS policies for ride_messages
-- These use the rides table to check if the user is the rider or driver

-- SELECT: Allow if user is rider_id or driver_id on the ride (any status for read)
CREATE POLICY "ride_messages_select_policy" 
ON public.ride_messages 
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.rides r
    WHERE r.id = ride_messages.ride_id
      AND (r.rider_id = auth.uid() OR r.driver_id = auth.uid())
  )
);

-- INSERT: Allow only during active ride statuses
CREATE POLICY "ride_messages_insert_policy"
ON public.ride_messages
FOR INSERT
WITH CHECK (
  -- Sender must match the authenticated user
  (sender_id = auth.uid() OR sender_user_id = auth.uid())
  -- The ride must exist and be active
  AND EXISTS (
    SELECT 1 FROM public.rides r
    WHERE r.id = ride_messages.ride_id
      AND r.status IN ('driver_assigned', 'driver_en_route', 'arrived', 'in_progress')
      AND (
        -- Rider sending as 'rider'
        (r.rider_id = auth.uid() AND sender_role = 'rider')
        OR
        -- Driver sending as 'driver'
        (r.driver_id = auth.uid() AND sender_role = 'driver')
      )
  )
);

-- Ensure ride_messages is in the realtime publication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND tablename = 'ride_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ride_messages;
  END IF;
END $$;