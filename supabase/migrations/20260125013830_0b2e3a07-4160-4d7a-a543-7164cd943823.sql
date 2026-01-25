-- Ensure ride_locations supports UPSERT (one latest row per ride) + updated_at + realtime UPDATE payload

-- 1) Add updated_at column (needed for debugging + freshness checks)
ALTER TABLE public.ride_locations
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- 2) Guarantee at most one "latest" row per ride_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'i'
      AND c.relname = 'ride_locations_ride_id_unique'
      AND n.nspname = 'public'
  ) THEN
    CREATE UNIQUE INDEX ride_locations_ride_id_unique
    ON public.ride_locations (ride_id);
  END IF;
END $$;

-- 3) Keep updated_at fresh on UPDATE
DROP TRIGGER IF EXISTS set_ride_locations_updated_at ON public.ride_locations;
CREATE TRIGGER set_ride_locations_updated_at
BEFORE UPDATE ON public.ride_locations
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();

-- 4) Ensure realtime UPDATE payload contains full row
ALTER TABLE public.ride_locations REPLICA IDENTITY FULL;

-- 5) Ensure the table is in the realtime publication (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'ride_locations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ride_locations;
  END IF;
END $$;

-- 6) Allow drivers to UPDATE their own row (required for UPSERT)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ride_locations'
      AND policyname = 'Drivers can update their own locations'
  ) THEN
    CREATE POLICY "Drivers can update their own locations"
    ON public.ride_locations
    FOR UPDATE
    USING (auth.uid() = driver_id)
    WITH CHECK (auth.uid() = driver_id);
  END IF;
END $$;