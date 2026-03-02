CREATE POLICY "Riders can update their own ride requests"
ON public.ride_requests FOR UPDATE
USING (auth.uid() = rider_id);