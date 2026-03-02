
-- Table to track riders actively on the booking page
CREATE TABLE public.active_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  is_booking boolean NOT NULL DEFAULT false,
  rider_name text,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.active_sessions ENABLE ROW LEVEL SECURITY;

-- Riders can manage their own session
CREATE POLICY "Users can insert their own session"
ON public.active_sessions FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own session"
ON public.active_sessions FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own session"
ON public.active_sessions FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own session"
ON public.active_sessions FOR DELETE
USING (auth.uid() = user_id);

-- Admins can view all sessions
CREATE POLICY "Admins can view all sessions"
ON public.active_sessions FOR SELECT
USING (is_admin(auth.uid()));

-- Enable realtime for instant admin alerts
ALTER PUBLICATION supabase_realtime ADD TABLE public.active_sessions;
