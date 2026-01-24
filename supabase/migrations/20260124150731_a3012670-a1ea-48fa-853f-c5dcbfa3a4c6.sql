-- Create custom_locations table for admin-added locations
CREATE TABLE public.custom_locations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  category TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- Enable RLS
ALTER TABLE public.custom_locations ENABLE ROW LEVEL SECURITY;

-- Everyone can read active custom locations (for search)
CREATE POLICY "Anyone can view active custom locations"
ON public.custom_locations
FOR SELECT
USING (is_active = true);

-- Only admins can insert custom locations
CREATE POLICY "Admins can insert custom locations"
ON public.custom_locations
FOR INSERT
WITH CHECK (is_admin(auth.uid()));

-- Only admins can update custom locations
CREATE POLICY "Admins can update custom locations"
ON public.custom_locations
FOR UPDATE
USING (is_admin(auth.uid()));

-- Only admins can delete custom locations
CREATE POLICY "Admins can delete custom locations"
ON public.custom_locations
FOR DELETE
USING (is_admin(auth.uid()));