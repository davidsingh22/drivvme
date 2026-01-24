-- Create saved_cards table to store Stripe payment method references with nicknames
CREATE TABLE public.saved_cards (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  stripe_payment_method_id TEXT NOT NULL,
  nickname TEXT NOT NULL,
  card_brand TEXT NOT NULL,
  card_last_four TEXT NOT NULL,
  card_exp_month INTEGER NOT NULL,
  card_exp_year INTEGER NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.saved_cards ENABLE ROW LEVEL SECURITY;

-- Users can view their own saved cards
CREATE POLICY "Users can view their own saved cards"
ON public.saved_cards
FOR SELECT
USING (auth.uid() = user_id);

-- Users can insert their own saved cards
CREATE POLICY "Users can insert their own saved cards"
ON public.saved_cards
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can update their own saved cards
CREATE POLICY "Users can update their own saved cards"
ON public.saved_cards
FOR UPDATE
USING (auth.uid() = user_id);

-- Users can delete their own saved cards
CREATE POLICY "Users can delete their own saved cards"
ON public.saved_cards
FOR DELETE
USING (auth.uid() = user_id);

-- Create trigger for updated_at using the existing function
CREATE TRIGGER update_saved_cards_updated_at
BEFORE UPDATE ON public.saved_cards
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();