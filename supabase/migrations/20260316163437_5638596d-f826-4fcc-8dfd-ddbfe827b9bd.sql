
CREATE TABLE public.admin_notifications_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  message text NOT NULL,
  audience text NOT NULL DEFAULT 'all',
  sent_at timestamptz NOT NULL DEFAULT now(),
  sent_by_admin uuid NOT NULL
);

ALTER TABLE public.admin_notifications_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view all admin notification logs"
  ON public.admin_notifications_log FOR SELECT
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins can insert admin notification logs"
  ON public.admin_notifications_log FOR INSERT
  WITH CHECK (public.is_admin(auth.uid()));
