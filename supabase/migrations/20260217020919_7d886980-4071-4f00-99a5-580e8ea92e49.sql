
-- Drop existing trigger and function
DROP TRIGGER IF EXISTS on_ride_status_change ON public.rides;
DROP FUNCTION IF EXISTS public.notify_ride_status_change();

-- Recreate with AFTER UPDATE OF status and WHEN clause for precision
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
BEGIN
  RAISE LOG 'notify_ride_status_change fired: ride=% old=% new=%', NEW.id, OLD.status, NEW.status;

  BEGIN
    SELECT decrypted_secret INTO _supabase_url
    FROM vault.decrypted_secrets
    WHERE name = 'SUPABASE_URL'
    LIMIT 1;

    SELECT decrypted_secret INTO _service_role_key
    FROM vault.decrypted_secrets
    WHERE name = 'SUPABASE_SERVICE_ROLE_KEY'
    LIMIT 1;

    IF _supabase_url IS NULL OR _service_role_key IS NULL THEN
      RAISE WARNING 'notify_ride_status_change: missing vault secrets (url=%, key=%)',
        _supabase_url IS NOT NULL, _service_role_key IS NOT NULL;
      RETURN NEW;
    END IF;

    _payload := jsonb_build_object(
      'ride_id', NEW.id,
      'new_status', NEW.status,
      'old_status', OLD.status,
      'rider_id', NEW.rider_id,
      'driver_id', NEW.driver_id
    );

    RAISE LOG 'notify_ride_status_change: posting to % with payload %',
      _supabase_url || '/functions/v1/ride-status-push', _payload;

    PERFORM net.http_post(
      url := _supabase_url || '/functions/v1/ride-status-push',
      body := _payload,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || _service_role_key
      )
    );

    RAISE LOG 'notify_ride_status_change: POST dispatched for ride %', NEW.id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_ride_status_change failed: % %', SQLERRM, SQLSTATE;
  END;

  RETURN NEW;
END;
$function$;

-- Attach trigger: fires only when status column actually changes
CREATE TRIGGER on_ride_status_change
  AFTER UPDATE OF status ON public.rides
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.notify_ride_status_change();
