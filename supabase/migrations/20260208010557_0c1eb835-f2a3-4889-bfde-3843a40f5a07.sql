
-- Add tip_status column to rides table to track pending vs charged tips
ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS tip_status text DEFAULT NULL;

-- Add comment for clarity
COMMENT ON COLUMN public.rides.tip_status IS 'Tracks tip lifecycle: pending (rider submitted), charged (admin charged card)';
