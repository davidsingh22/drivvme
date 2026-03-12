ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS notification_tier integer DEFAULT 0;
ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS last_notification_at timestamptz;
ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS notified_driver_ids text[] DEFAULT '{}';