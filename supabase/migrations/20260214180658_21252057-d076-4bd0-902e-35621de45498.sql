-- Allow admins to update any ride (e.g. assign a driver)
CREATE POLICY "Admins can update any ride"
ON public.rides
FOR UPDATE
USING (is_admin(auth.uid()));