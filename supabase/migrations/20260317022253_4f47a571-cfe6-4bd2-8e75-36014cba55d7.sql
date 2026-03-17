
-- Create driver_presence table
CREATE TABLE public.driver_presence (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  driver_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'offline',
  current_screen text NOT NULL DEFAULT 'dashboard',
  last_seen timestamp with time zone NOT NULL DEFAULT now(),
  lat double precision,
  lng double precision,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  display_name text,
  UNIQUE (driver_id)
);

-- Enable RLS
ALTER TABLE public.driver_presence ENABLE ROW LEVEL SECURITY;

-- Drivers can upsert their own presence
CREATE POLICY "Drivers can insert their own presence"
ON public.driver_presence FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = driver_id);

CREATE POLICY "Drivers can update their own presence"
ON public.driver_presence FOR UPDATE
TO authenticated
USING (auth.uid() = driver_id);

CREATE POLICY "Drivers can view their own presence"
ON public.driver_presence FOR SELECT
TO authenticated
USING (auth.uid() = driver_id);

-- Admins can view all
CREATE POLICY "Admins can view all driver presence"
ON public.driver_presence FOR SELECT
TO authenticated
USING (public.is_admin(auth.uid()));

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_presence;
