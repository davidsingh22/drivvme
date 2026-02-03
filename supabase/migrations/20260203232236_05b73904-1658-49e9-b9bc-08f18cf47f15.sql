-- Create support_messages table for help requests
CREATE TABLE public.support_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  user_role TEXT NOT NULL,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  admin_reply TEXT,
  replied_at TIMESTAMP WITH TIME ZONE,
  replied_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

-- Users can insert their own support messages
CREATE POLICY "Users can create their own support messages"
ON public.support_messages
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can view their own support messages
CREATE POLICY "Users can view their own support messages"
ON public.support_messages
FOR SELECT
USING (auth.uid() = user_id);

-- Admins can view all support messages
CREATE POLICY "Admins can view all support messages"
ON public.support_messages
FOR SELECT
USING (is_admin(auth.uid()));

-- Admins can update support messages (to reply)
CREATE POLICY "Admins can update support messages"
ON public.support_messages
FOR UPDATE
USING (is_admin(auth.uid()));

-- Enable realtime for instant messaging
ALTER PUBLICATION supabase_realtime ADD TABLE public.support_messages;

-- Create trigger for updated_at using existing function
CREATE TRIGGER update_support_messages_updated_at
BEFORE UPDATE ON public.support_messages
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();