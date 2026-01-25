-- Create withdraw_requests table for driver payout requests
CREATE TABLE public.withdraw_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  driver_id UUID NOT NULL,
  amount NUMERIC NOT NULL,
  contact_method TEXT NOT NULL CHECK (contact_method IN ('email', 'phone')),
  contact_value TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'rejected')),
  admin_notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  processed_at TIMESTAMP WITH TIME ZONE,
  processed_by UUID
);

-- Enable RLS
ALTER TABLE public.withdraw_requests ENABLE ROW LEVEL SECURITY;

-- Drivers can view their own requests
CREATE POLICY "Drivers can view their own withdraw requests"
ON public.withdraw_requests
FOR SELECT
USING (auth.uid() = driver_id);

-- Drivers can create withdraw requests
CREATE POLICY "Drivers can create withdraw requests"
ON public.withdraw_requests
FOR INSERT
WITH CHECK (auth.uid() = driver_id);

-- Admins can view all withdraw requests
CREATE POLICY "Admins can view all withdraw requests"
ON public.withdraw_requests
FOR SELECT
USING (is_admin(auth.uid()));

-- Admins can update withdraw requests
CREATE POLICY "Admins can update withdraw requests"
ON public.withdraw_requests
FOR UPDATE
USING (is_admin(auth.uid()));

-- Enable realtime for withdraw_requests
ALTER PUBLICATION supabase_realtime ADD TABLE public.withdraw_requests;