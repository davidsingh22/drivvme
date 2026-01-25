-- Create dedicated ride_messages table for secure in-app messaging
CREATE TABLE public.ride_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ride_id UUID NOT NULL,
  sender_id UUID NOT NULL,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('driver', 'rider')),
  message TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.ride_messages ENABLE ROW LEVEL SECURITY;

-- Create index for efficient querying
CREATE INDEX idx_ride_messages_ride_id ON public.ride_messages(ride_id);
CREATE INDEX idx_ride_messages_created_at ON public.ride_messages(created_at);

-- Security function to check if user can access messages for a ride
CREATE OR REPLACE FUNCTION public.can_access_ride_messages(p_ride_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.rides
    WHERE id = p_ride_id
      AND (rider_id = p_user_id OR driver_id = p_user_id)
  )
$$;

-- Security function to check if messaging is allowed (ride is in active status)
CREATE OR REPLACE FUNCTION public.can_send_ride_message(p_ride_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.rides
    WHERE id = p_ride_id
      AND (rider_id = p_user_id OR driver_id = p_user_id)
      AND status IN ('driver_assigned', 'driver_en_route', 'arrived', 'in_progress')
  )
$$;

-- Policy: Users can view messages for rides they are part of (driver or rider)
CREATE POLICY "Users can view messages for their rides"
ON public.ride_messages
FOR SELECT
USING (
  public.can_access_ride_messages(ride_id, auth.uid())
);

-- Policy: Users can only insert messages when ride is active and they are part of it
CREATE POLICY "Users can send messages during active rides"
ON public.ride_messages
FOR INSERT
WITH CHECK (
  auth.uid() = sender_id
  AND public.can_send_ride_message(ride_id, auth.uid())
  AND (
    (sender_role = 'rider' AND EXISTS (
      SELECT 1 FROM public.rides WHERE id = ride_id AND rider_id = auth.uid()
    ))
    OR
    (sender_role = 'driver' AND EXISTS (
      SELECT 1 FROM public.rides WHERE id = ride_id AND driver_id = auth.uid()
    ))
  )
);

-- Enable realtime for ride_messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.ride_messages;