
-- Enable the pg_net extension for HTTP calls from triggers
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Function that sends ride status change to the edge function
CREATE OR REPLACE FUNCTION public.notify_ride_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _supabase_url text;
  _service_role_key text;
  _payload jsonb;
  _target_statuses text[] := ARRAY[
    'driver_assigned', 'driver_en_route', 'arrived',
    'in_progress', 'completed', 'cancelled'
  ];
BEGIN
  -- Only fire when status actually changed to a relevant status
  IF OLD.status IS DISTINCT FROM NEW.status
     AND NEW.status::text = ANY(_target_statuses) THEN

    _supabase_url := current_setting('app.settings.supabase_url', true);
    _service_role_key := current_setting('app.settings.service_role_key', true);

    -- If app settings are not available, use vault secrets
    IF _supabase_url IS NULL OR _supabase_url = '' THEN
      SELECT decrypted_secret INTO _supabase_url
      FROM vault.decrypted_secrets
      WHERE name = 'SUPABASE_URL'
      LIMIT 1;
    END IF;

    IF _service_role_key IS NULL OR _service_role_key = '' THEN
      SELECT decrypted_secret INTO _service_role_key
      FROM vault.decrypted_secrets
      WHERE name = 'SUPABASE_SERVICE_ROLE_KEY'
      LIMIT 1;
    END IF;

    _payload := jsonb_build_object(
      'ride_id', NEW.id,
      'new_status', NEW.status,
      'old_status', OLD.status,
      'rider_id', NEW.rider_id,
      'driver_id', NEW.driver_id
    );

    -- Fire-and-forget HTTP POST to the edge function
    PERFORM extensions.http_post(
      url := _supabase_url || '/functions/v1/ride-status-push',
      body := _payload::text,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || _service_role_key
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Attach trigger to rides table
DROP TRIGGER IF EXISTS on_ride_status_change ON public.rides;
CREATE TRIGGER on_ride_status_change
  AFTER UPDATE ON public.rides
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_ride_status_change();
