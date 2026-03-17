
-- Create rider_presence table for real-time screen tracking
CREATE TABLE public.rider_presence (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'rider',
  last_seen timestamp with time zone NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'online',
  current_screen text NOT NULL DEFAULT 'home',
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  display_name text,
  UNIQUE (user_id)
);

-- Enable RLS
ALTER TABLE public.rider_presence ENABLE ROW LEVEL SECURITY;

-- Users can upsert their own presence
CREATE POLICY "Users can insert their own rider presence"
ON public.rider_presence FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own rider presence"
ON public.rider_presence FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own rider presence"
ON public.rider_presence FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Admins can view all
CREATE POLICY "Admins can view all rider presence"
ON public.rider_presence FOR SELECT
TO authenticated
USING (public.is_admin(auth.uid()));

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.rider_presence;
