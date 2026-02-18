
-- Drop and recreate trigger function to use hardcoded URL + anon key
-- Since verify_jwt = false for ride-status-push, anon key works fine
DROP TRIGGER IF EXISTS on_ride_status_change ON public.rides;
DROP FUNCTION IF EXISTS public.notify_ride_status_change();

CREATE OR REPLACE FUNCTION public.notify_ride_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _url text := 'https://siadshsaiuecesydqzqo.supabase.co/functions/v1/ride-status-push';
  _anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNpYWRzaHNhaXVlY2VzeWRxenFvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg3NjgwMjUsImV4cCI6MjA4NDM0NDAyNX0.PyFOoLVPzKG-6VV2YrinJPuK6Kbqeh-WNcJw2cNV4FY';
  _payload jsonb;
BEGIN
  RAISE LOG 'notify_ride_status_change FIRED: ride=% old=% new=%', NEW.id, OLD.status, NEW.status;

  _payload := jsonb_build_object(
    'ride_id', NEW.id,
    'new_status', NEW.status,
    'old_status', OLD.status,
    'rider_id', NEW.rider_id,
    'driver_id', NEW.driver_id
  );

  PERFORM net.http_post(
    url := _url,
    body := _payload,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || _anon_key
    )
  );

  RAISE LOG 'notify_ride_status_change POST dispatched for ride %', NEW.id;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_ride_status_change failed: % (SQLSTATE: %)', SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER on_ride_status_change
  AFTER UPDATE OF status ON public.rides
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.notify_ride_status_change();
