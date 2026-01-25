-- Create rider_locations table for tracking rider online status and location
CREATE TABLE public.rider_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  accuracy double precision,
  is_online boolean NOT NULL DEFAULT true,
  last_seen_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.rider_locations ENABLE ROW LEVEL SECURITY;

-- Riders can insert/update their own location
CREATE POLICY "Riders can insert their own location"
ON public.rider_locations FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Riders can update their own location"
ON public.rider_locations FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Riders can view their own location"
ON public.rider_locations FOR SELECT
USING (auth.uid() = user_id);

-- Admins can view all rider locations
CREATE POLICY "Admins can view all rider locations"
ON public.rider_locations FOR SELECT
USING (is_admin(auth.uid()));

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.rider_locations;