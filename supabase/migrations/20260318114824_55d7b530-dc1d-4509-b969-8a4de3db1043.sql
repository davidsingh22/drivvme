CREATE OR REPLACE FUNCTION public.set_presence_timestamps()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.last_seen_at := now();
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_presence_set_timestamps
BEFORE INSERT OR UPDATE ON public.presence
FOR EACH ROW
EXECUTE FUNCTION public.set_presence_timestamps();