-- Enable realtime for rides and driver_profiles so rider/driver status updates propagate instantly
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'rides'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.rides';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'driver_profiles'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_profiles';
  END IF;
END $$;

-- Ensure UPDATE payloads include full row data
ALTER TABLE public.rides REPLICA IDENTITY FULL;
ALTER TABLE public.driver_profiles REPLICA IDENTITY FULL;