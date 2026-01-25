-- 1) Append-only history table for debugging + guaranteed inserts
CREATE TABLE IF NOT EXISTS public.ride_location_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ride_id UUID NOT NULL,
  driver_id UUID NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  heading DOUBLE PRECISION NULL,
  speed DOUBLE PRECISION NULL,
  accuracy DOUBLE PRECISION NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ride_location_history_ride_created_at
  ON public.ride_location_history (ride_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ride_location_history_driver_created_at
  ON public.ride_location_history (driver_id, created_at DESC);

-- Enable RLS
ALTER TABLE public.ride_location_history ENABLE ROW LEVEL SECURITY;

-- Drivers can insert their own history rows
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ride_location_history'
      AND policyname = 'Drivers can insert their own location history'
  ) THEN
    CREATE POLICY "Drivers can insert their own location history"
    ON public.ride_location_history
    FOR INSERT
    WITH CHECK (auth.uid() = driver_id);
  END IF;
END $$;

-- Drivers can view their own history rows
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ride_location_history'
      AND policyname = 'Drivers can view their own location history'
  ) THEN
    CREATE POLICY "Drivers can view their own location history"
    ON public.ride_location_history
    FOR SELECT
    USING (auth.uid() = driver_id);
  END IF;
END $$;

-- Riders can view history rows for their rides
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ride_location_history'
      AND policyname = 'Riders can view location history for their rides'
  ) THEN
    CREATE POLICY "Riders can view location history for their rides"
    ON public.ride_location_history
    FOR SELECT
    USING (
      EXISTS (
        SELECT 1
        FROM public.rides
        WHERE rides.id = ride_location_history.ride_id
          AND rides.rider_id = auth.uid()
      )
    );
  END IF;
END $$;

-- Admins can view all history rows
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ride_location_history'
      AND policyname = 'Admins can view all location history'
  ) THEN
    CREATE POLICY "Admins can view all location history"
    ON public.ride_location_history
    FOR SELECT
    USING (public.is_admin(auth.uid()));
  END IF;
END $$;

-- Realtime: add history table so inserts can be observed
ALTER PUBLICATION supabase_realtime ADD TABLE public.ride_location_history;