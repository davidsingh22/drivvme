-- Add priority_driver_until column to track Priority Driver status
ALTER TABLE public.driver_profiles 
ADD COLUMN IF NOT EXISTS priority_driver_until timestamp with time zone DEFAULT NULL;

-- Add acceptance_time_seconds to rides table for tracking fast acceptance
ALTER TABLE public.rides 
ADD COLUMN IF NOT EXISTS acceptance_time_seconds integer DEFAULT NULL;

-- Add notification_tier to rides table to track escalation
ALTER TABLE public.rides 
ADD COLUMN IF NOT EXISTS notification_tier integer DEFAULT 1;

-- Add notified_driver_ids to track which drivers have been notified (for escalation)
ALTER TABLE public.rides 
ADD COLUMN IF NOT EXISTS notified_driver_ids uuid[] DEFAULT '{}';

-- Add last_notification_at for timing the escalation tiers
ALTER TABLE public.rides 
ADD COLUMN IF NOT EXISTS last_notification_at timestamp with time zone DEFAULT NULL;