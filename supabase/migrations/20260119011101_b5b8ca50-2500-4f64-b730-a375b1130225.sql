-- Allow authenticated users to insert their own roles during signup
CREATE POLICY "Users can insert their own role"
  ON public.user_roles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Fix driver_profiles INSERT policy - remove the is_driver check since they're creating the role at the same time
DROP POLICY IF EXISTS "Drivers can insert their own driver profile" ON public.driver_profiles;

CREATE POLICY "Users can insert their own driver profile"
  ON public.driver_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);