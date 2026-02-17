
-- Insert the Supabase URL into vault with the known project URL
SELECT vault.create_secret(
  'https://siadshsaiuecesydqzqo.supabase.co',
  'SUPABASE_URL',
  'Supabase project URL for trigger webhooks'
);
