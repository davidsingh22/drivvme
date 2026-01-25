-- Create table for rider destination history
CREATE TABLE public.rider_destinations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  visit_count INTEGER NOT NULL DEFAULT 1,
  last_visited_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create unique constraint on user + location to allow upserts
CREATE UNIQUE INDEX idx_rider_destinations_user_location ON public.rider_destinations (user_id, lat, lng);

-- Create index for faster lookups by user
CREATE INDEX idx_rider_destinations_user_id ON public.rider_destinations (user_id);

-- Enable Row Level Security
ALTER TABLE public.rider_destinations ENABLE ROW LEVEL SECURITY;

-- Users can view their own destinations
CREATE POLICY "Users can view their own destinations"
ON public.rider_destinations
FOR SELECT
USING (auth.uid() = user_id);

-- Users can insert their own destinations
CREATE POLICY "Users can insert their own destinations"
ON public.rider_destinations
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can update their own destinations
CREATE POLICY "Users can update their own destinations"
ON public.rider_destinations
FOR UPDATE
USING (auth.uid() = user_id);

-- Users can delete their own destinations
CREATE POLICY "Users can delete their own destinations"
ON public.rider_destinations
FOR DELETE
USING (auth.uid() = user_id);