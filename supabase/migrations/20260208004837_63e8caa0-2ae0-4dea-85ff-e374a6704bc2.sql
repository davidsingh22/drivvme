
-- Add tip_amount column to rides table
ALTER TABLE public.rides ADD COLUMN tip_amount numeric DEFAULT 0;
