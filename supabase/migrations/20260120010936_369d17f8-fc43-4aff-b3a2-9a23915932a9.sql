-- Enable realtime for driver_profiles table to allow riders to track driver location
ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_profiles;