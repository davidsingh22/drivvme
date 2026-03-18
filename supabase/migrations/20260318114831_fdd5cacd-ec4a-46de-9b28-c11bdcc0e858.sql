CREATE OR REPLACE FUNCTION public.set_presence_timestamps()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = 'public'
AS $function$
BEGIN
  NEW.last_seen_at := now();
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;