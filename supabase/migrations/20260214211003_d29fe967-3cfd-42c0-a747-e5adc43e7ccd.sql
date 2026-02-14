
CREATE OR REPLACE FUNCTION public.accept_ride(
  p_ride_id uuid,
  p_driver_id uuid,
  p_acceptance_time_seconds integer DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ride_id uuid;
BEGIN
  -- Atomically claim the ride only if still searching and unclaimed
  UPDATE rides
  SET driver_id = p_driver_id,
      status = 'driver_assigned',
      accepted_at = now(),
      acceptance_time_seconds = p_acceptance_time_seconds
  WHERE id = p_ride_id
    AND status = 'searching'
    AND driver_id IS NULL
  RETURNING id INTO v_ride_id;

  -- Return NULL if ride was already taken
  RETURN v_ride_id;
END;
$$;
