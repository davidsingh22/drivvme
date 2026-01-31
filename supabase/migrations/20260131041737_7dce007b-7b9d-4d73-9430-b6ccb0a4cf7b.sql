-- Fix: Restrict user_roles INSERT policy to only allow 'rider' or 'driver' roles
-- This prevents privilege escalation where users could grant themselves 'admin' role

-- Drop the existing vulnerable policy
DROP POLICY IF EXISTS "Users can insert their own role" ON public.user_roles;

-- Create new restricted policy that only allows rider or driver roles
-- Also prevents multiple role insertions by the same user
CREATE POLICY "Users can insert rider or driver role only"
  ON public.user_roles FOR INSERT
  WITH CHECK (
    auth.uid() = user_id 
    AND role IN ('rider'::user_role, 'driver'::user_role)
    AND NOT EXISTS (
      SELECT 1 FROM public.user_roles 
      WHERE user_id = auth.uid()
    )
  );
