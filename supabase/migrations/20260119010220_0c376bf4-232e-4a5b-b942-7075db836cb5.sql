-- Create enums for the app
CREATE TYPE public.user_role AS ENUM ('rider', 'driver');
CREATE TYPE public.language_preference AS ENUM ('en', 'fr');
CREATE TYPE public.ride_status AS ENUM ('searching', 'driver_assigned', 'driver_en_route', 'arrived', 'in_progress', 'completed', 'cancelled');
CREATE TYPE public.payment_status AS ENUM ('pending', 'succeeded', 'failed', 'refunded');
CREATE TYPE public.document_type AS ENUM ('license', 'insurance', 'registration');

-- User roles table (following security best practices - roles in separate table)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role user_role NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

-- Profiles table for all users
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  first_name TEXT,
  last_name TEXT,
  phone_number TEXT,
  email TEXT,
  language language_preference NOT NULL DEFAULT 'en',
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Driver profiles (additional info for drivers)
CREATE TABLE public.driver_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  license_number TEXT,
  vehicle_make TEXT,
  vehicle_model TEXT,
  vehicle_year INTEGER,
  vehicle_color TEXT,
  license_plate TEXT,
  is_online BOOLEAN NOT NULL DEFAULT false,
  is_verified BOOLEAN NOT NULL DEFAULT false,
  current_lat DOUBLE PRECISION,
  current_lng DOUBLE PRECISION,
  average_rating DECIMAL(3,2) DEFAULT 5.00,
  total_rides INTEGER DEFAULT 0,
  total_earnings DECIMAL(10,2) DEFAULT 0.00,
  stripe_account_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Rides table
CREATE TABLE public.rides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  driver_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  
  -- Pickup details
  pickup_address TEXT NOT NULL,
  pickup_lat DOUBLE PRECISION NOT NULL,
  pickup_lng DOUBLE PRECISION NOT NULL,
  
  -- Dropoff details
  dropoff_address TEXT NOT NULL,
  dropoff_lat DOUBLE PRECISION NOT NULL,
  dropoff_lng DOUBLE PRECISION NOT NULL,
  
  -- Distance and duration
  distance_km DECIMAL(8,2),
  estimated_duration_minutes INTEGER,
  
  -- Pricing (15% cheaper than Uber, driver pays $5 to platform)
  estimated_fare DECIMAL(10,2) NOT NULL,
  actual_fare DECIMAL(10,2),
  platform_fee DECIMAL(10,2) DEFAULT 5.00,
  driver_earnings DECIMAL(10,2),
  
  -- Status tracking
  status ride_status NOT NULL DEFAULT 'searching',
  
  -- Timestamps
  requested_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  accepted_at TIMESTAMP WITH TIME ZONE,
  pickup_at TIMESTAMP WITH TIME ZONE,
  dropoff_at TIMESTAMP WITH TIME ZONE,
  cancelled_at TIMESTAMP WITH TIME ZONE,
  
  -- Cancellation details
  cancelled_by UUID REFERENCES auth.users(id),
  cancellation_reason TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Payments table
CREATE TABLE public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID REFERENCES public.rides(id) ON DELETE CASCADE NOT NULL,
  payer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  amount DECIMAL(10,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CAD',
  payment_type TEXT NOT NULL, -- 'rider_payment', 'platform_fee', 'driver_payout'
  status payment_status NOT NULL DEFAULT 'pending',
  stripe_payment_intent_id TEXT,
  stripe_transfer_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Driver documents table
CREATE TABLE public.driver_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  document_type document_type NOT NULL,
  file_url TEXT NOT NULL,
  is_verified BOOLEAN NOT NULL DEFAULT false,
  verified_at TIMESTAMP WITH TIME ZONE,
  expires_at DATE,
  uploaded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Ratings table
CREATE TABLE public.ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID REFERENCES public.rides(id) ON DELETE CASCADE NOT NULL UNIQUE,
  rider_id UUID REFERENCES auth.users(id) ON DELETE SET NULL NOT NULL,
  driver_id UUID REFERENCES auth.users(id) ON DELETE SET NULL NOT NULL,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Translations table for bilingual support
CREATE TABLE public.translations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  en TEXT NOT NULL,
  fr TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.translations ENABLE ROW LEVEL SECURITY;

-- Helper function: Check if user has a specific role
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role user_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Helper function: Check if user is a rider
CREATE OR REPLACE FUNCTION public.is_rider(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'rider'::user_role)
$$;

-- Helper function: Check if user is a driver
CREATE OR REPLACE FUNCTION public.is_driver(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'driver'::user_role)
$$;

-- RLS Policies for user_roles
CREATE POLICY "Users can view their own roles"
  ON public.user_roles FOR SELECT
  USING (auth.uid() = user_id);

-- RLS Policies for profiles
CREATE POLICY "Users can view their own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = user_id);

-- Drivers can view rider profiles for their active rides
CREATE POLICY "Drivers can view rider profiles for their rides"
  ON public.profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.rides
      WHERE rides.driver_id = auth.uid()
      AND rides.rider_id = profiles.user_id
      AND rides.status IN ('driver_assigned', 'driver_en_route', 'arrived', 'in_progress')
    )
  );

-- Riders can view driver profiles for their active rides
CREATE POLICY "Riders can view driver profiles for their rides"
  ON public.profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.rides
      WHERE rides.rider_id = auth.uid()
      AND rides.driver_id = profiles.user_id
      AND rides.status IN ('driver_assigned', 'driver_en_route', 'arrived', 'in_progress', 'completed')
    )
  );

-- RLS Policies for driver_profiles
CREATE POLICY "Drivers can view their own driver profile"
  ON public.driver_profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Drivers can insert their own driver profile"
  ON public.driver_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id AND public.is_driver(auth.uid()));

CREATE POLICY "Drivers can update their own driver profile"
  ON public.driver_profiles FOR UPDATE
  USING (auth.uid() = user_id);

-- Riders can view basic driver info for their rides
CREATE POLICY "Riders can view driver profiles for their rides"
  ON public.driver_profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.rides
      WHERE rides.rider_id = auth.uid()
      AND rides.driver_id = driver_profiles.user_id
    )
  );

-- RLS Policies for rides
CREATE POLICY "Riders can view their own rides"
  ON public.rides FOR SELECT
  USING (auth.uid() = rider_id);

CREATE POLICY "Drivers can view their own rides"
  ON public.rides FOR SELECT
  USING (auth.uid() = driver_id);

CREATE POLICY "Drivers can view searching rides"
  ON public.rides FOR SELECT
  USING (public.is_driver(auth.uid()) AND status = 'searching');

CREATE POLICY "Riders can create rides"
  ON public.rides FOR INSERT
  WITH CHECK (auth.uid() = rider_id AND public.is_rider(auth.uid()));

CREATE POLICY "Riders can update their own rides"
  ON public.rides FOR UPDATE
  USING (auth.uid() = rider_id);

CREATE POLICY "Drivers can update rides they accepted"
  ON public.rides FOR UPDATE
  USING (auth.uid() = driver_id);

-- RLS Policies for payments
CREATE POLICY "Users can view their own payments"
  ON public.payments FOR SELECT
  USING (auth.uid() = payer_id);

CREATE POLICY "Users can view payments for their rides"
  ON public.payments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.rides
      WHERE rides.id = payments.ride_id
      AND (rides.rider_id = auth.uid() OR rides.driver_id = auth.uid())
    )
  );

-- RLS Policies for driver_documents
CREATE POLICY "Drivers can view their own documents"
  ON public.driver_documents FOR SELECT
  USING (auth.uid() = driver_id);

CREATE POLICY "Drivers can upload their own documents"
  ON public.driver_documents FOR INSERT
  WITH CHECK (auth.uid() = driver_id AND public.is_driver(auth.uid()));

CREATE POLICY "Drivers can update their own documents"
  ON public.driver_documents FOR UPDATE
  USING (auth.uid() = driver_id);

-- RLS Policies for ratings
CREATE POLICY "Users can view ratings for their rides"
  ON public.ratings FOR SELECT
  USING (auth.uid() = rider_id OR auth.uid() = driver_id);

CREATE POLICY "Riders can create ratings for completed rides"
  ON public.ratings FOR INSERT
  WITH CHECK (
    auth.uid() = rider_id 
    AND public.is_rider(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.rides
      WHERE rides.id = ratings.ride_id
      AND rides.rider_id = auth.uid()
      AND rides.status = 'completed'
    )
  );

-- RLS Policies for translations (public read)
CREATE POLICY "Anyone can read translations"
  ON public.translations FOR SELECT
  USING (true);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Apply updated_at triggers
CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_driver_profiles_updated_at
  BEFORE UPDATE ON public.driver_profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_rides_updated_at
  BEFORE UPDATE ON public.rides
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_payments_updated_at
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Function to create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Trigger for auto-creating profile on signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Function to update driver average rating
CREATE OR REPLACE FUNCTION public.update_driver_rating()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.driver_profiles
  SET average_rating = (
    SELECT COALESCE(AVG(rating), 5.00)
    FROM public.ratings
    WHERE driver_id = NEW.driver_id
  )
  WHERE user_id = NEW.driver_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_rating_created
  AFTER INSERT ON public.ratings
  FOR EACH ROW EXECUTE FUNCTION public.update_driver_rating();

-- Function to update driver stats when ride completes
CREATE OR REPLACE FUNCTION public.update_driver_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    UPDATE public.driver_profiles
    SET 
      total_rides = total_rides + 1,
      total_earnings = total_earnings + COALESCE(NEW.driver_earnings, 0)
    WHERE user_id = NEW.driver_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_ride_completed
  AFTER UPDATE ON public.rides
  FOR EACH ROW EXECUTE FUNCTION public.update_driver_stats();

-- Enable realtime for rides table
ALTER PUBLICATION supabase_realtime ADD TABLE public.rides;

-- Create indexes for performance
CREATE INDEX idx_rides_rider_id ON public.rides(rider_id);
CREATE INDEX idx_rides_driver_id ON public.rides(driver_id);
CREATE INDEX idx_rides_status ON public.rides(status);
CREATE INDEX idx_driver_profiles_is_online ON public.driver_profiles(is_online);
CREATE INDEX idx_driver_profiles_location ON public.driver_profiles(current_lat, current_lng);
CREATE INDEX idx_payments_ride_id ON public.payments(ride_id);
CREATE INDEX idx_ratings_driver_id ON public.ratings(driver_id);