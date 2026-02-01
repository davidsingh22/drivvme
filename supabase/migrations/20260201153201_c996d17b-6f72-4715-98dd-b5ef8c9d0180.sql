-- Add detailed billing columns to rides table for itemized receipts
-- These store the fare breakdown: promo discount, subtotal (before tax), and Quebec taxes

ALTER TABLE public.rides 
ADD COLUMN IF NOT EXISTS promo_discount numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS subtotal_before_tax numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS gst_amount numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS qst_amount numeric DEFAULT 0;

-- Add comments for documentation
COMMENT ON COLUMN public.rides.promo_discount IS 'The 7.5% promotional discount amount applied to base fare';
COMMENT ON COLUMN public.rides.subtotal_before_tax IS 'Fare after promo discount, before Quebec taxes (used for platform fee calculation)';
COMMENT ON COLUMN public.rides.gst_amount IS 'Federal GST (5%) applied to subtotal';
COMMENT ON COLUMN public.rides.qst_amount IS 'Quebec QST (9.975%) applied to subtotal';