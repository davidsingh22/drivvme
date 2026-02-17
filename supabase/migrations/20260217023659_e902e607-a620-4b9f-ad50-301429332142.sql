
-- Trigger function for new ride INSERT → calls notify-drivers-new-ride edge function
CREATE OR REPLACE FUNCTION public.notify_new_ride_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _url text := 'https://siadshsaiuecesydqzqo.supabase.co/functions/v1/notify-drivers-new-ride';
  _anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNpYWRzaHNhaXVlY2VzeWRxenFvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg3NjgwMjUsImV4cCI6MjA4NDM0NDAyNX0.PyFOoLVPzKG-6VV2YrinJPuK6Kbqeh-WNcJw2cNV4FY';
  _payload jsonb;
BEGIN
  RAISE LOG 'notify_new_ride_insert FIRED: ride=% status=%', NEW.id, NEW.status;

  _payload := jsonb_build_object(
    'ride_id', NEW.id,
    'pickup_address', NEW.pickup_address,
    'dropoff_address', NEW.dropoff_address,
    'estimated_fare', NEW.estimated_fare,
    'pickup_lat', NEW.pickup_lat,
    'pickup_lng', NEW.pickup_lng,
    'rider_id', NEW.rider_id,
    'source', 'trigger'
  );

  PERFORM net.http_post(
    url := _url,
    body := _payload,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || _anon_key
    )
  );

  RAISE LOG 'notify_new_ride_insert POST dispatched for ride %', NEW.id;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_new_ride_insert failed: % (SQLSTATE: %)', SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$$;

-- Create the trigger
CREATE TRIGGER on_new_ride_insert
AFTER INSERT ON public.rides
FOR EACH ROW
EXECUTE FUNCTION public.notify_new_ride_insert();
