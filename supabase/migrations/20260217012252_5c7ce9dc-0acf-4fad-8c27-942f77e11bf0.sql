
-- Ensure pg_net extension is available
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Recreate the trigger function using net.http_post (pg_net)
CREATE OR REPLACE FUNCTION public.notify_ride_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _supabase_url text;
  _service_role_key text;
  _payload jsonb;
  _target_statuses text[] := ARRAY[
    'driver_assigned', 'driver_en_route', 'arrived',
    'in_progress', 'completed', 'cancelled'
  ];
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status
     AND NEW.status::text = ANY(_target_statuses) THEN

    BEGIN
      SELECT decrypted_secret INTO _supabase_url
      FROM vault.decrypted_secrets
      WHERE name = 'SUPABASE_URL'
      LIMIT 1;

      SELECT decrypted_secret INTO _service_role_key
      FROM vault.decrypted_secrets
      WHERE name = 'SUPABASE_SERVICE_ROLE_KEY'
      LIMIT 1;

      _payload := jsonb_build_object(
        'ride_id', NEW.id,
        'new_status', NEW.status,
        'old_status', OLD.status,
        'rider_id', NEW.rider_id,
        'driver_id', NEW.driver_id
      );

      PERFORM net.http_post(
        url := _supabase_url || '/functions/v1/ride-status-push',
        body := _payload::jsonb,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || _service_role_key
        )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'notify_ride_status_change failed: %', SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$function$;

-- Drop old trigger if exists, then create fresh
DROP TRIGGER IF EXISTS on_ride_status_change ON public.rides;

CREATE TRIGGER on_ride_status_change
  AFTER UPDATE ON public.rides
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_ride_status_change();
