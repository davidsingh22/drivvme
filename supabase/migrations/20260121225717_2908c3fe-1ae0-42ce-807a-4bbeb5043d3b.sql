-- Fix: allow users to store their own web-push subscriptions
-- (Without these policies, subscribe() succeeds locally but the DB upsert is blocked, so background push can't work.)

-- Ensure RLS is enabled
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- SELECT
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'push_subscriptions'
      AND policyname = 'Users can read own push subscriptions'
  ) THEN
    EXECUTE 'DROP POLICY "Users can read own push subscriptions" ON public.push_subscriptions';
  END IF;

  -- INSERT
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'push_subscriptions'
      AND policyname = 'Users can create own push subscriptions'
  ) THEN
    EXECUTE 'DROP POLICY "Users can create own push subscriptions" ON public.push_subscriptions';
  END IF;

  -- UPDATE
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'push_subscriptions'
      AND policyname = 'Users can update own push subscriptions'
  ) THEN
    EXECUTE 'DROP POLICY "Users can update own push subscriptions" ON public.push_subscriptions';
  END IF;

  -- DELETE
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'push_subscriptions'
      AND policyname = 'Users can delete own push subscriptions'
  ) THEN
    EXECUTE 'DROP POLICY "Users can delete own push subscriptions" ON public.push_subscriptions';
  END IF;
END $$;

CREATE POLICY "Users can read own push subscriptions"
ON public.push_subscriptions
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create own push subscriptions"
ON public.push_subscriptions
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own push subscriptions"
ON public.push_subscriptions
FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own push subscriptions"
ON public.push_subscriptions
FOR DELETE
USING (auth.uid() = user_id);
