-- Drop the trigger and function that use pg_net since it's not available
DROP TRIGGER IF EXISTS trigger_notify_drivers_new_ride ON public.rides;
DROP FUNCTION IF EXISTS public.notify_drivers_on_new_ride();