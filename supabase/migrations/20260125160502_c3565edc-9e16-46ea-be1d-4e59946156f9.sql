-- Add DELETE policy for admins on profiles table
CREATE POLICY "Admins can delete profiles"
ON public.profiles
FOR DELETE
USING (is_admin(auth.uid()));

-- Add DELETE policy for admins on user_roles table  
CREATE POLICY "Admins can delete user roles"
ON public.user_roles
FOR DELETE
USING (is_admin(auth.uid()));

-- Add DELETE policy for admins on rider_locations table
CREATE POLICY "Admins can delete rider locations"
ON public.rider_locations
FOR DELETE
USING (is_admin(auth.uid()));

-- Add DELETE policy for admins on push_subscriptions table
CREATE POLICY "Admins can delete push subscriptions"
ON public.push_subscriptions
FOR DELETE
USING (is_admin(auth.uid()));