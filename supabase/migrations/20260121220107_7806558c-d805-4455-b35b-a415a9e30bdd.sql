-- Create a function that calls the notify-drivers edge function via HTTP
CREATE OR REPLACE FUNCTION public.notify_drivers_on_new_ride()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  supabase_url text;
  service_key text;
  response_status int;
BEGIN
  -- Only notify for new rides with 'searching' status
  IF NEW.status = 'searching' THEN
    -- Get the Supabase URL from environment (set via vault)
    SELECT decrypted_secret INTO supabase_url 
    FROM vault.decrypted_secrets 
    WHERE name = 'SUPABASE_URL' LIMIT 1;
    
    SELECT decrypted_secret INTO service_key 
    FROM vault.decrypted_secrets 
    WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1;

    -- Call the edge function asynchronously using pg_net
    PERFORM net.http_post(
      url := supabase_url || '/functions/v1/notify-drivers-new-ride',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || service_key
      ),
      body := jsonb_build_object(
        'rideId', NEW.id,
        'pickupAddress', NEW.pickup_address,
        'dropoffAddress', NEW.dropoff_address,
        'estimatedFare', NEW.estimated_fare
      )
    );
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create the trigger on rides table
DROP TRIGGER IF EXISTS trigger_notify_drivers_new_ride ON public.rides;

CREATE TRIGGER trigger_notify_drivers_new_ride
  AFTER INSERT ON public.rides
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_drivers_on_new_ride();