-- Create is_admin helper function
CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'admin'::user_role)
$$;

-- Create RLS policies for admins to view all payments
CREATE POLICY "Admins can view all payments"
ON public.payments
FOR SELECT
USING (public.is_admin(auth.uid()));

-- Create RLS policies for admins to view all rides
CREATE POLICY "Admins can view all rides"
ON public.rides
FOR SELECT
USING (public.is_admin(auth.uid()));

-- Create RLS policies for admins to view all profiles
CREATE POLICY "Admins can view all profiles"
ON public.profiles
FOR SELECT
USING (public.is_admin(auth.uid()));