-- Ensure ride_messages has the requested v1 columns while keeping backward compatibility
ALTER TABLE public.ride_messages
  ADD COLUMN IF NOT EXISTS sender_user_id uuid,
  ADD COLUMN IF NOT EXISTS body text;

-- Backfill new columns from legacy columns when present
UPDATE public.ride_messages
SET sender_user_id = COALESCE(sender_user_id, sender_id),
    body = COALESCE(body, message)
WHERE sender_user_id IS NULL OR body IS NULL;

-- Keep new columns in sync on future inserts
CREATE OR REPLACE FUNCTION public.sync_ride_messages_v1_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  NEW.sender_user_id := COALESCE(NEW.sender_user_id, NEW.sender_id);
  NEW.body := COALESCE(NEW.body, NEW.message);
  NEW.sender_id := COALESCE(NEW.sender_id, NEW.sender_user_id);
  NEW.message := COALESCE(NEW.message, NEW.body);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_ride_messages_v1_columns ON public.ride_messages;
CREATE TRIGGER trg_sync_ride_messages_v1_columns
BEFORE INSERT OR UPDATE ON public.ride_messages
FOR EACH ROW
EXECUTE FUNCTION public.sync_ride_messages_v1_columns();

-- Realtime: ensure ride_messages is part of the realtime publication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_rel pr
    JOIN pg_class c ON c.oid = pr.prrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_publication p ON p.oid = pr.prpubid
    WHERE p.pubname = 'supabase_realtime'
      AND n.nspname = 'public'
      AND c.relname = 'ride_messages'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.ride_messages';
  END IF;
END;
$$;

-- RLS: align policies with v1 columns (auth uid + ride linkage + active ride statuses)
DROP POLICY IF EXISTS "Users can view messages for their rides" ON public.ride_messages;
CREATE POLICY "Users can view messages for their rides"
ON public.ride_messages
FOR SELECT
USING (can_access_ride_messages(ride_id, auth.uid()));

DROP POLICY IF EXISTS "Users can send messages during active rides" ON public.ride_messages;
CREATE POLICY "Users can send messages during active rides"
ON public.ride_messages
FOR INSERT
WITH CHECK (
  auth.uid() = sender_user_id
  AND can_send_ride_message(ride_id, auth.uid())
  AND (
    (sender_role = 'rider' AND EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.id = ride_messages.ride_id AND r.rider_id = auth.uid()
    ))
    OR
    (sender_role = 'driver' AND EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.id = ride_messages.ride_id AND r.driver_id = auth.uid()
    ))
  )
);