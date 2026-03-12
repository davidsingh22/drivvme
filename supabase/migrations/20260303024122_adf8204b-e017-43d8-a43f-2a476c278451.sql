CREATE POLICY "Admins can view all notifications"
ON public.notifications
FOR SELECT
USING (is_admin(auth.uid()));