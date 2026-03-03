
-- Create presence table
CREATE TABLE public.presence (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE,
  role text NOT NULL DEFAULT 'RIDER',
  display_name text,
  source text NOT NULL DEFAULT 'web',
  last_seen_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.presence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can upsert their own presence"
ON public.presence FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own presence"
ON public.presence FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own presence"
ON public.presence FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all presence"
ON public.presence FOR SELECT
TO authenticated
USING (public.is_admin(auth.uid()));

-- Create activity_events table
CREATE TABLE public.activity_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'RIDER',
  event_type text NOT NULL,
  message text NOT NULL,
  source text NOT NULL DEFAULT 'web',
  meta jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own events"
ON public.activity_events FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can view all events"
ON public.activity_events FOR SELECT
TO authenticated
USING (public.is_admin(auth.uid()));

-- Enable realtime for both tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.presence;
ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_events;

-- Index for fast admin queries
CREATE INDEX idx_presence_role_last_seen ON public.presence (role, last_seen_at DESC);
CREATE INDEX idx_activity_events_created ON public.activity_events (created_at DESC);
CREATE INDEX idx_activity_events_type_created ON public.activity_events (event_type, created_at DESC);
