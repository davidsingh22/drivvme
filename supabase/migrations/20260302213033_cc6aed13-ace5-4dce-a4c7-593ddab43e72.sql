
-- Create ride_requests table for tracking full ride lifecycle from the moment rider clicks "Book a Ride"
CREATE TABLE public.ride_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id uuid NOT NULL,
  rider_name text,
  ride_id uuid REFERENCES public.rides(id),
  pickup_text text NOT NULL,
  pickup_lat double precision NOT NULL,
  pickup_lng double precision NOT NULL,
  dropoff_text text NOT NULL,
  dropoff_lat double precision NOT NULL,
  dropoff_lng double precision NOT NULL,
  estimated_fare numeric,
  estimated_minutes integer,
  status text NOT NULL DEFAULT 'REQUESTED',
  driver_id uuid,
  driver_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.ride_requests ENABLE ROW LEVEL SECURITY;

-- Admin-only access
CREATE POLICY "Admins can view all ride requests"
  ON public.ride_requests FOR SELECT
  USING (is_admin(auth.uid()));

CREATE POLICY "Admins can update ride requests"
  ON public.ride_requests FOR UPDATE
  USING (is_admin(auth.uid()));

-- Riders can insert their own requests
CREATE POLICY "Riders can insert their own ride requests"
  ON public.ride_requests FOR INSERT
  WITH CHECK (auth.uid() = rider_id);

-- Riders can view their own requests
CREATE POLICY "Riders can view their own ride requests"
  ON public.ride_requests FOR SELECT
  USING (auth.uid() = rider_id);

-- updated_at trigger
CREATE TRIGGER update_ride_requests_updated_at
  BEFORE UPDATE ON public.ride_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.ride_requests;
