-- Create notifications table for in-app alerts
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  ride_id uuid NULL,
  type text NOT NULL DEFAULT 'info',
  title text NOT NULL,
  message text NOT NULL,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create index for efficient user notification queries
CREATE INDEX IF NOT EXISTS notifications_user_id_created_at_idx
  ON public.notifications (user_id, created_at DESC);

-- Enable Row Level Security
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Allow users to read their own notifications
CREATE POLICY "read_own_notifications"
ON public.notifications FOR SELECT
USING (auth.uid() = user_id);

-- Allow users to insert notifications for themselves
CREATE POLICY "insert_own_notifications"
ON public.notifications FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Allow users to update their own notifications (for marking as read)
CREATE POLICY "update_own_notifications"
ON public.notifications FOR UPDATE
USING (auth.uid() = user_id);