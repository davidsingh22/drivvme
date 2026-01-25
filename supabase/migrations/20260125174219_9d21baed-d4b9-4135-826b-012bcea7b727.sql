-- Create rider_agreements table to store rider disclosure agreements
CREATE TABLE public.rider_agreements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  rider_id UUID NOT NULL,
  agrees_to_terms BOOLEAN NOT NULL DEFAULT false,
  agrees_to_disclosure BOOLEAN NOT NULL DEFAULT false,
  signed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  ip_address TEXT,
  user_agent TEXT
);

-- Enable Row Level Security
ALTER TABLE public.rider_agreements ENABLE ROW LEVEL SECURITY;

-- Create policies for rider_agreements
CREATE POLICY "Riders can insert their own agreement"
ON public.rider_agreements
FOR INSERT
WITH CHECK (auth.uid() = rider_id);

CREATE POLICY "Riders can view their own agreement"
ON public.rider_agreements
FOR SELECT
USING (auth.uid() = rider_id);

CREATE POLICY "Admins can view all rider agreements"
ON public.rider_agreements
FOR SELECT
USING (is_admin(auth.uid()));

-- Add index for faster lookups
CREATE INDEX idx_rider_agreements_rider_id ON public.rider_agreements(rider_id);