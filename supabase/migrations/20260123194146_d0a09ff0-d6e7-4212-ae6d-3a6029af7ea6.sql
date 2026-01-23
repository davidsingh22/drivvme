-- Allow admins to read all user roles (required for AdminDashboard user/driver listing)
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public'
      AND tablename = 'user_roles'
      AND policyname = 'Admins can view all user roles'
  ) THEN
    CREATE POLICY "Admins can view all user roles"
    ON public.user_roles
    FOR SELECT
    USING (public.is_admin(auth.uid()));
  END IF;
END $$;