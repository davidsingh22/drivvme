-- Allow admins to read all push subscriptions (needed for Admin Notifications diagnostics)
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public'
      AND tablename = 'push_subscriptions'
      AND policyname = 'Admins can view all push subscriptions'
  ) THEN
    CREATE POLICY "Admins can view all push subscriptions"
    ON public.push_subscriptions
    FOR SELECT
    USING (public.is_admin(auth.uid()));
  END IF;
END $$;