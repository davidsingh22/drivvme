-- Add driver application fields to driver_profiles table
ALTER TABLE public.driver_profiles 
ADD COLUMN IF NOT EXISTS driver_license_url text,
ADD COLUMN IF NOT EXISTS profile_picture_url text,
ADD COLUMN IF NOT EXISTS has_criminal_record boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS agreement_accepted boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS agreement_accepted_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS application_status text DEFAULT 'pending' CHECK (application_status IN ('pending', 'approved', 'rejected'));

-- Create storage bucket for driver licenses (separate from avatars for admin access)
INSERT INTO storage.buckets (id, name, public)
VALUES ('driver-licenses', 'driver-licenses', false)
ON CONFLICT (id) DO NOTHING;

-- Create RLS policies for driver-licenses bucket

-- Drivers can upload their own license
CREATE POLICY "Drivers can upload their own license"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'driver-licenses' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Drivers can view their own license
CREATE POLICY "Drivers can view their own license"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'driver-licenses' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Drivers can update their own license
CREATE POLICY "Drivers can update their own license"
ON storage.objects
FOR UPDATE
USING (
  bucket_id = 'driver-licenses' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Admins can view all driver licenses
CREATE POLICY "Admins can view all driver licenses"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'driver-licenses' 
  AND public.is_admin(auth.uid())
);

-- Create a table to store driver agreement records for admin viewing
CREATE TABLE IF NOT EXISTS public.driver_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_independent_contractor boolean NOT NULL DEFAULT false,
  is_responsible_for_taxes boolean NOT NULL DEFAULT false,
  agrees_to_terms boolean NOT NULL DEFAULT false,
  signed_at timestamp with time zone NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS on driver_agreements
ALTER TABLE public.driver_agreements ENABLE ROW LEVEL SECURITY;

-- Drivers can insert their own agreement
CREATE POLICY "Drivers can insert their own agreement"
ON public.driver_agreements
FOR INSERT
WITH CHECK (auth.uid() = driver_id);

-- Drivers can view their own agreement
CREATE POLICY "Drivers can view their own agreement"
ON public.driver_agreements
FOR SELECT
USING (auth.uid() = driver_id);

-- Admins can view all agreements
CREATE POLICY "Admins can view all driver agreements"
ON public.driver_agreements
FOR SELECT
USING (public.is_admin(auth.uid()));