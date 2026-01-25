-- Ensure driver_locations stays in sync with driver_profiles GPS + online status

-- Trigger function: upsert into driver_locations whenever driver_profiles changes.
CREATE OR REPLACE FUNCTION public.sync_driver_locations_from_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- If we have coordinates, upsert/update the driver_locations row.
  IF NEW.current_lat IS NOT NULL AND NEW.current_lng IS NOT NULL THEN
    INSERT INTO public.driver_locations (
      driver_id,
      user_id,
      lat,
      lng,
      heading,
      speed_kph,
      is_online,
      updated_at
    ) VALUES (
      NEW.user_id,
      NEW.user_id,
      NEW.current_lat,
      NEW.current_lng,
      NULL,
      NULL,
      NEW.is_online,
      now()
    )
    ON CONFLICT (driver_id)
    DO UPDATE SET
      lat = EXCLUDED.lat,
      lng = EXCLUDED.lng,
      is_online = EXCLUDED.is_online,
      updated_at = now();
  ELSE
    -- If no coords, still reflect offline state if row already exists.
    IF NEW.is_online = false THEN
      UPDATE public.driver_locations
      SET is_online = false,
          updated_at = now()
      WHERE driver_id = NEW.user_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Recreate trigger (idempotent)
DROP TRIGGER IF EXISTS trg_sync_driver_locations_from_profile ON public.driver_profiles;
CREATE TRIGGER trg_sync_driver_locations_from_profile
AFTER INSERT OR UPDATE OF current_lat, current_lng, is_online
ON public.driver_profiles
FOR EACH ROW
EXECUTE FUNCTION public.sync_driver_locations_from_profile();