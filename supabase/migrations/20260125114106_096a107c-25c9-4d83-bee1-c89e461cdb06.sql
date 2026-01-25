-- Create driver_locations table for real-time tracking
CREATE TABLE public.driver_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  heading double precision,
  speed_kph double precision,
  is_online boolean NOT NULL DEFAULT false,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.driver_locations ENABLE ROW LEVEL SECURITY;

-- Admins can view all driver locations
CREATE POLICY "Admins can view all driver locations"
ON public.driver_locations
FOR SELECT
USING (is_admin(auth.uid()));

-- Drivers can view their own location
CREATE POLICY "Drivers can view their own location"
ON public.driver_locations
FOR SELECT
USING (auth.uid() = user_id);

-- Drivers can insert their own location
CREATE POLICY "Drivers can insert their own location"
ON public.driver_locations
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Drivers can update their own location
CREATE POLICY "Drivers can update their own location"
ON public.driver_locations
FOR UPDATE
USING (auth.uid() = user_id);

-- Enable realtime for driver_locations
ALTER TABLE public.driver_locations REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_locations;

-- Create index for fast online driver queries
CREATE INDEX idx_driver_locations_online ON public.driver_locations(is_online) WHERE is_online = true;