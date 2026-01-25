-- Create a trigger to automatically create rider_locations for every new user
CREATE OR REPLACE FUNCTION public.create_rider_location_on_signup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Create a rider_locations entry for every new profile
  -- Default to Montreal coordinates, marked as online initially
  INSERT INTO public.rider_locations (
    user_id,
    lat,
    lng,
    accuracy,
    is_online,
    last_seen_at,
    updated_at
  ) VALUES (
    NEW.user_id,
    45.5017,
    -73.5673,
    10000,
    true,
    now(),
    now()
  )
  ON CONFLICT (user_id) DO NOTHING;
  
  RETURN NEW;
END;
$$;

-- Create trigger on profiles table
DROP TRIGGER IF EXISTS create_rider_location_on_profile_insert ON public.profiles;
CREATE TRIGGER create_rider_location_on_profile_insert
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.create_rider_location_on_signup();

-- Also backfill existing users who don't have rider_locations records
INSERT INTO public.rider_locations (user_id, lat, lng, accuracy, is_online, last_seen_at, updated_at)
SELECT 
  p.user_id,
  45.5017,
  -73.5673,
  10000,
  false,
  now(),
  now()
FROM public.profiles p
LEFT JOIN public.rider_locations rl ON p.user_id = rl.user_id
WHERE rl.id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.driver_profiles dp WHERE dp.user_id = p.user_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.user_id AND ur.role = 'admin'
  )
ON CONFLICT (user_id) DO NOTHING;