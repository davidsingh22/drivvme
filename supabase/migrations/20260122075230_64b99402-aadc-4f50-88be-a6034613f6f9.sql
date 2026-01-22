-- Add a pre-payment status to prevent drivers seeing unpaid rides
DO $$
BEGIN
  ALTER TYPE public.ride_status ADD VALUE IF NOT EXISTS 'pending_payment' BEFORE 'searching';
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;