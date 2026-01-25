-- Create ride_locations table to store driver location history keyed by ride_id
CREATE TABLE public.ride_locations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ride_id uuid NOT NULL,
  driver_id uuid NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  heading double precision,
  speed double precision,
  accuracy double precision,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create index for fast queries by ride_id
CREATE INDEX idx_ride_locations_ride_id ON public.ride_locations (ride_id);
CREATE INDEX idx_ride_locations_created_at ON public.ride_locations (ride_id, created_at DESC);

-- Enable Row Level Security
ALTER TABLE public.ride_locations ENABLE ROW LEVEL SECURITY;

-- Drivers can insert their own location updates
CREATE POLICY "Drivers can insert their own locations" 
ON public.ride_locations 
FOR INSERT 
WITH CHECK (auth.uid() = driver_id);

-- Riders can view location updates for their rides
CREATE POLICY "Riders can view locations for their rides" 
ON public.ride_locations 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM rides 
    WHERE rides.id = ride_locations.ride_id 
    AND rides.rider_id = auth.uid()
  )
);

-- Drivers can view their own location updates
CREATE POLICY "Drivers can view their own locations" 
ON public.ride_locations 
FOR SELECT 
USING (auth.uid() = driver_id);

-- Enable realtime for ride_locations
ALTER PUBLICATION supabase_realtime ADD TABLE public.ride_locations;