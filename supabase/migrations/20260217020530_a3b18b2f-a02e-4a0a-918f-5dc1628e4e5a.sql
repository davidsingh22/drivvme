
-- Step 1: Drop the existing trigger
DROP TRIGGER IF EXISTS on_ride_status_change ON public.rides;

-- Step 2: Drop the old trigger function
DROP FUNCTION IF EXISTS public.notify_ride_status_change();

-- Step 3: Create a Database Webhook trigger using supabase_functions.http_request
-- This is the same mechanism Supabase Dashboard uses for Database Webhooks.
-- It fires AFTER UPDATE on rides and POSTs the payload to ride-status-push.
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
  -- Only fire when status actually changed
  IF OLD.status IS DISTINCT FROM NEW.status THEN

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

    -- Use net.http_post (pg_net) to POST to the edge function
    PERFORM net.http_post(
      url := _supabase_url || '/functions/v1/ride-status-push',
      body := _payload,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || _service_role_key
      )
    );

  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block the rides UPDATE if notification fails
  RAISE WARNING 'notify_ride_status_change webhook failed: %', SQLERRM;
  RETURN NEW;
END;
$function$;

-- Step 4: Attach as AFTER UPDATE trigger on rides
CREATE TRIGGER on_ride_status_change
  AFTER UPDATE ON public.rides
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_ride_status_change();
