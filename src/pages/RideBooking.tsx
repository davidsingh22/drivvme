import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, Navigation, Clock, TrendingDown, Car, X, Star, Phone, MessageSquare, CreditCard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { calculateFare, formatCurrency, formatDistance, formatDuration, FareEstimate } from '@/lib/pricing';
import Navbar from '@/components/Navbar';
import MapComponent from '@/components/MapComponent';
import LocationInput from '@/components/LocationInput';
import PaymentForm from '@/components/PaymentForm';
import { useToast } from '@/hooks/use-toast';

type RideStep = 'input' | 'estimate' | 'payment' | 'searching' | 'matched' | 'arriving' | 'arrived' | 'inProgress' | 'completed';

interface Location {
  address: string;
  lat: number;
  lng: number;
}

const RideBooking = () => {
  const { t, language } = useLanguage();
  const { user, isRider, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [step, setStep] = useState<RideStep>('input');
  const [pickup, setPickup] = useState<Location | null>(null);
  const [dropoff, setDropoff] = useState<Location | null>(null);
  const [pickupAddress, setPickupAddress] = useState('');
  const [dropoffAddress, setDropoffAddress] = useState('');
  const [fareEstimate, setFareEstimate] = useState<FareEstimate | null>(null);
  const [directions, setDirections] = useState<google.maps.DirectionsResult | null>(null);
  const [distanceKm, setDistanceKm] = useState(0);
  const [durationMinutes, setDurationMinutes] = useState(0);
  const [currentRide, setCurrentRide] = useState<any>(null);
  const [driverInfo, setDriverInfo] = useState<any>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Redirect if not logged in as rider
  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/login');
    }
  }, [user, authLoading, navigate]);

  // Subscribe to ride updates
  useEffect(() => {
    if (!currentRide?.id) return;

    const channel = supabase
      .channel(`ride-${currentRide.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'rides',
          filter: `id=eq.${currentRide.id}`,
        },
        (payload) => {
          const updatedRide = payload.new;
          setCurrentRide(updatedRide);
          
          // Update step based on status
          switch (updatedRide.status) {
            case 'driver_assigned':
              setStep('matched');
              fetchDriverInfo(updatedRide.driver_id);
              break;
            case 'driver_en_route':
              setStep('arriving');
              break;
            case 'arrived':
              setStep('arrived');
              break;
            case 'in_progress':
              setStep('inProgress');
              break;
            case 'completed':
              setStep('completed');
              break;
            case 'cancelled':
              toast({
                title: t('booking.cancelled'),
                variant: 'destructive',
              });
              resetBooking();
              break;
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentRide?.id]);

  const fetchDriverInfo = async (driverId: string) => {
    const { data: profile } = await supabase
      .from('profiles')
      .select('first_name, last_name, phone_number, avatar_url')
      .eq('user_id', driverId)
      .single();

    const { data: driverProfile } = await supabase
      .from('driver_profiles')
      .select('vehicle_make, vehicle_model, vehicle_color, license_plate, average_rating')
      .eq('user_id', driverId)
      .single();

    if (profile && driverProfile) {
      setDriverInfo({ ...profile, ...driverProfile });
    }
  };

  const handlePickupChange = (address: string, location?: { lat: number; lng: number }) => {
    setPickupAddress(address);
    if (location) {
      setPickup({ address, ...location });
    }
  };

  const handleDropoffChange = (address: string, location?: { lat: number; lng: number }) => {
    setDropoffAddress(address);
    if (location) {
      setDropoff({ address, ...location });
    }
  };

  const useCurrentLocation = () => {
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;

        // NOTE: Reverse-geocoding requires the Google Geocoding API.
        // To keep the app usable even when that API isn't enabled, we fall back to
        // using coordinates as the address.
        const fallbackAddress = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        setPickupAddress(fallbackAddress);
        setPickup({ address: fallbackAddress, lat, lng });

        // Try reverse geocode opportunistically (best-effort).
        try {
          const geocoder = new google.maps.Geocoder();
          geocoder.geocode({ location: { lat, lng } }, (results, status) => {
            if (status === 'OK' && results?.[0]?.formatted_address) {
              const address = results[0].formatted_address;
              setPickupAddress(address);
              setPickup({ address, lat, lng });
            }
          });
        } catch {
          // ignore
        }
      },
      () => {
        toast({
          title: 'Location error',
          description: 'Unable to get your current location',
          variant: 'destructive',
        });
      }
    );
  };

  const geocodeAddress = useCallback(async (address: string) => {
    try {
      const geocoder = new google.maps.Geocoder();
      return await new Promise<{ lat: number; lng: number } | null>((resolve) => {
        geocoder.geocode({ address }, (results, status) => {
          const loc = results?.[0]?.geometry?.location;
          if (status === 'OK' && loc) {
            resolve({ lat: loc.lat(), lng: loc.lng() });
            return;
          }
          resolve(null);
        });
      });
    } catch {
      return null;
    }
  }, []);

  const calculateRoute = useCallback(async () => {
    if (!pickup || !dropoff) return;

    const directionsService = new google.maps.DirectionsService();

    try {
      const result = await directionsService.route({
        origin: { lat: pickup.lat, lng: pickup.lng },
        destination: { lat: dropoff.lat, lng: dropoff.lng },
        travelMode: google.maps.TravelMode.DRIVING,
      });

      setDirections(result);

      const route = result.routes[0];
      if (route?.legs?.[0]) {
        const leg = route.legs[0];
        const distanceInKm = (leg.distance?.value || 0) / 1000;
        const durationInMinutes = (leg.duration?.value || 0) / 60;

        setDistanceKm(distanceInKm);
        setDurationMinutes(durationInMinutes);

        const estimate = calculateFare(distanceInKm, durationInMinutes);
        setFareEstimate(estimate);
        setStep('estimate');
      }
    } catch (error) {
      toast({
        title: 'Route error',
        description: 'Unable to calculate route',
        variant: 'destructive',
      });
    }
  }, [pickup, dropoff, toast]);

  const handleGetEstimate = async () => {
    // Allow typing without selecting an autocomplete option by resolving coordinates here.
    let resolvedPickup = pickup;
    let resolvedDropoff = dropoff;

    if (!resolvedPickup && pickupAddress.trim()) {
      const loc = await geocodeAddress(pickupAddress.trim());
      if (loc) resolvedPickup = { address: pickupAddress.trim(), ...loc };
    }

    if (!resolvedDropoff && dropoffAddress.trim()) {
      const loc = await geocodeAddress(dropoffAddress.trim());
      if (loc) resolvedDropoff = { address: dropoffAddress.trim(), ...loc };
    }

    if (resolvedPickup && !pickup) setPickup(resolvedPickup);
    if (resolvedDropoff && !dropoff) setDropoff(resolvedDropoff);

    if (!resolvedPickup || !resolvedDropoff) {
      toast({
        title: 'Missing locations',
        description: 'Please select a suggestion from the dropdown (or enable Geocoding API for typed addresses).',
        variant: 'destructive',
      });
      return;
    }

    await calculateRoute();
  };

  const handleProceedToPayment = async () => {
    if (!user || !pickup || !dropoff || !fareEstimate) return;

    setIsSubmitting(true);
    try {
      // Create the ride first with 'searching' status but don't activate yet
      const { data: ride, error } = await supabase
        .from('rides')
        .insert({
          rider_id: user.id,
          pickup_address: pickup.address,
          pickup_lat: pickup.lat,
          pickup_lng: pickup.lng,
          dropoff_address: dropoff.address,
          dropoff_lat: dropoff.lat,
          dropoff_lng: dropoff.lng,
          distance_km: distanceKm,
          estimated_duration_minutes: Math.round(durationMinutes),
          estimated_fare: fareEstimate.total,
          status: 'searching',
        })
        .select()
        .single();

      if (error) throw error;

      setCurrentRide(ride);
      setStep('payment');
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePaymentSuccess = () => {
    setStep('searching');
    toast({
      title: t('booking.searching'),
      description: 'Payment confirmed! Looking for nearby drivers...',
    });
  };

  const handlePaymentCancel = async () => {
    // Cancel the ride if payment is cancelled
    if (currentRide) {
      await supabase
        .from('rides')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          cancelled_by: user?.id,
          cancellation_reason: 'Payment cancelled',
        })
        .eq('id', currentRide.id);
    }
    setCurrentRide(null);
    setStep('estimate');
  };

  const handleCancelRide = async () => {
    if (!currentRide) return;

    try {
      await supabase
        .from('rides')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          cancelled_by: user?.id,
          cancellation_reason: 'Cancelled by rider',
        })
        .eq('id', currentRide.id);

      resetBooking();
      toast({
        title: 'Ride cancelled',
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const resetBooking = () => {
    setStep('input');
    setPickup(null);
    setDropoff(null);
    setPickupAddress('');
    setDropoffAddress('');
    setFareEstimate(null);
    setDirections(null);
    setCurrentRide(null);
    setDriverInfo(null);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">{t('common.loading')}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      <div className="pt-16 h-screen flex flex-col lg:flex-row">
        {/* Map */}
        <div className="flex-1 relative">
          <MapComponent
            pickup={pickup}
            dropoff={dropoff}
            directions={directions}
          />
        </div>

        {/* Booking Panel */}
        <motion.div
          initial={{ x: 100, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          className="w-full lg:w-[420px] bg-card border-l border-border flex flex-col"
        >
          <div className="p-6 flex-1 overflow-y-auto">
            <AnimatePresence mode="wait">
              {/* Input Step */}
              {step === 'input' && (
                <motion.div
                  key="input"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="space-y-4"
                >
                  <h2 className="font-display text-2xl font-bold mb-6">
                    {t('nav.ride')}
                  </h2>
                  
                  <LocationInput
                    type="pickup"
                    value={pickupAddress}
                    onChange={handlePickupChange}
                    onUseCurrentLocation={useCurrentLocation}
                  />
                  
                  <LocationInput
                    type="dropoff"
                    value={dropoffAddress}
                    onChange={handleDropoffChange}
                  />

                  <Button
                    onClick={handleGetEstimate}
                    className="w-full gradient-primary shadow-button py-6 text-lg"
                    disabled={!pickupAddress || !dropoffAddress}
                  >
                    {t('booking.estimate')}
                  </Button>
                </motion.div>
              )}

              {/* Estimate Step */}
              {step === 'estimate' && fareEstimate && (
                <motion.div
                  key="estimate"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="space-y-6"
                >
                  <div className="flex items-center justify-between">
                    <h2 className="font-display text-2xl font-bold">
                      {t('pricing.estimated')}
                    </h2>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setStep('input')}
                    >
                      <X className="h-5 w-5" />
                    </Button>
                  </div>

                  {/* Route Summary */}
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <MapPin className="h-5 w-5 text-primary mt-0.5" />
                      <div>
                        <p className="text-sm text-muted-foreground">Pickup</p>
                        <p className="font-medium">{pickup?.address}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Navigation className="h-5 w-5 text-accent mt-0.5" />
                      <div>
                        <p className="text-sm text-muted-foreground">Destination</p>
                        <p className="font-medium">{dropoff?.address}</p>
                      </div>
                    </div>
                  </div>

                  {/* Distance & Duration */}
                  <div className="grid grid-cols-2 gap-4">
                    <Card className="p-4 bg-muted/50">
                      <p className="text-sm text-muted-foreground">{t('pricing.distance')}</p>
                      <p className="text-xl font-bold">{formatDistance(distanceKm, language)}</p>
                    </Card>
                    <Card className="p-4 bg-muted/50">
                      <p className="text-sm text-muted-foreground">{t('pricing.duration')}</p>
                      <p className="text-xl font-bold">{formatDuration(durationMinutes, language)}</p>
                    </Card>
                  </div>

                  {/* Price */}
                  <Card className="p-6 gradient-card border-primary/20">
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-lg">Total</span>
                      <span className="font-display text-3xl font-bold text-gradient">
                        {formatCurrency(fareEstimate.total, language)}
                      </span>
                    </div>
                    
                    {/* Savings highlight */}
                    <div className="flex items-center gap-2 text-accent">
                      <TrendingDown className="h-5 w-5" />
                      <span className="font-medium">
                        {t('pricing.savings')}: {formatCurrency(fareEstimate.savings, language)} ({fareEstimate.savingsPercent}%)
                      </span>
                    </div>

                    {fareEstimate.surgeMultiplier > 1 && (
                      <div className="mt-3 flex items-center gap-2 text-warning text-sm">
                        <Clock className="h-4 w-4" />
                        <span>Surge pricing: {fareEstimate.surgeMultiplier}x</span>
                      </div>
                    )}
                  </Card>

                  <Button
                    onClick={handleProceedToPayment}
                    className="w-full gradient-primary shadow-button py-6 text-lg"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? (
                      t('common.loading')
                    ) : (
                      <>
                        <CreditCard className="h-5 w-5 mr-2" />
                        {t('booking.confirm')} & Pay
                      </>
                    )}
                  </Button>
                </motion.div>
              )}

              {/* Payment Step */}
              {step === 'payment' && currentRide && fareEstimate && (
                <motion.div
                  key="payment"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="space-y-6"
                >
                  <div className="flex items-center justify-between">
                    <h2 className="font-display text-2xl font-bold">
                      Payment
                    </h2>
                  </div>

                  <Card className="p-4 bg-muted/50">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Total</span>
                      <span className="font-display text-2xl font-bold text-gradient">
                        {formatCurrency(fareEstimate.total, language)}
                      </span>
                    </div>
                  </Card>

                  <PaymentForm
                    rideId={currentRide.id}
                    amount={fareEstimate.total}
                    onSuccess={handlePaymentSuccess}
                    onCancel={handlePaymentCancel}
                  />
                </motion.div>
              )}

              {/* Searching Step */}
              {step === 'searching' && (
                <motion.div
                  key="searching"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="flex flex-col items-center justify-center h-full space-y-6"
                >
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                    className="w-20 h-20 rounded-full border-4 border-primary border-t-transparent"
                  />
                  <h2 className="font-display text-2xl font-bold text-center">
                    {t('booking.searching')}
                  </h2>
                  <p className="text-muted-foreground text-center">
                    Looking for nearby drivers...
                  </p>
                  <Button
                    variant="outline"
                    onClick={handleCancelRide}
                    className="mt-4"
                  >
                    {t('common.cancel')}
                  </Button>
                </motion.div>
              )}

              {/* Driver Matched / Arriving / Arrived / In Progress */}
              {(step === 'matched' || step === 'arriving' || step === 'arrived' || step === 'inProgress') && driverInfo && (
                <motion.div
                  key="driver"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="space-y-6"
                >
                  <div className="text-center">
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-success/10 text-success mb-4"
                    >
                      <Car className="h-5 w-5" />
                      <span className="font-medium">
                        {step === 'matched' && t('booking.found')}
                        {step === 'arriving' && t('booking.arriving')}
                        {step === 'arrived' && t('booking.arrived')}
                        {step === 'inProgress' && t('booking.inProgress')}
                      </span>
                    </motion.div>
                  </div>

                  {/* Driver Card */}
                  <Card className="p-6">
                    <div className="flex items-center gap-4 mb-4">
                      <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                        {driverInfo.avatar_url ? (
                          <img
                            src={driverInfo.avatar_url}
                            alt="Driver"
                            className="w-16 h-16 rounded-full object-cover"
                          />
                        ) : (
                          <span className="text-2xl font-bold text-primary">
                            {driverInfo.first_name?.[0] || 'D'}
                          </span>
                        )}
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-lg">
                          {driverInfo.first_name} {driverInfo.last_name?.[0]}.
                        </h3>
                        <div className="flex items-center gap-1 text-warning">
                          <Star className="h-4 w-4 fill-current" />
                          <span>{Number(driverInfo.average_rating).toFixed(1)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Vehicle Info */}
                    <div className="p-4 bg-muted/50 rounded-lg mb-4">
                      <p className="font-medium">
                        {driverInfo.vehicle_color} {driverInfo.vehicle_make} {driverInfo.vehicle_model}
                      </p>
                      <p className="text-lg font-bold tracking-wider">
                        {driverInfo.license_plate}
                      </p>
                    </div>

                    {/* Contact Buttons */}
                    <div className="grid grid-cols-2 gap-3">
                      <Button variant="outline" className="gap-2">
                        <Phone className="h-4 w-4" />
                        Call
                      </Button>
                      <Button variant="outline" className="gap-2">
                        <MessageSquare className="h-4 w-4" />
                        Message
                      </Button>
                    </div>
                  </Card>

                  {/* Trip Details */}
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <MapPin className="h-5 w-5 text-primary mt-0.5" />
                      <div>
                        <p className="text-sm text-muted-foreground">Pickup</p>
                        <p className="font-medium">{pickup?.address}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Navigation className="h-5 w-5 text-accent mt-0.5" />
                      <div>
                        <p className="text-sm text-muted-foreground">Destination</p>
                        <p className="font-medium">{dropoff?.address}</p>
                      </div>
                    </div>
                  </div>

                  {(step === 'matched' || step === 'arriving') && (
                    <Button
                      variant="outline"
                      onClick={handleCancelRide}
                      className="w-full text-destructive border-destructive/50 hover:bg-destructive/10"
                    >
                      {t('common.cancel')} Ride
                    </Button>
                  )}
                </motion.div>
              )}

              {/* Completed Step */}
              {step === 'completed' && (
                <motion.div
                  key="completed"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="flex flex-col items-center justify-center h-full space-y-6"
                >
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="w-20 h-20 rounded-full bg-success/10 flex items-center justify-center"
                  >
                    <Navigation className="h-10 w-10 text-success" />
                  </motion.div>
                  <h2 className="font-display text-2xl font-bold text-center">
                    {t('booking.completed')}
                  </h2>
                  <p className="text-muted-foreground text-center">
                    Thanks for riding with Drivveme!
                  </p>
                  <Card className="w-full p-6">
                    <div className="flex items-center justify-between mb-4">
                      <span>Total Fare</span>
                      <span className="font-display text-2xl font-bold">
                        {formatCurrency(currentRide?.actual_fare || fareEstimate?.total || 0, language)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-accent">
                      <TrendingDown className="h-5 w-5" />
                      <span>You saved {formatCurrency(fareEstimate?.savings || 0, language)}!</span>
                    </div>
                  </Card>
                  <Button
                    onClick={resetBooking}
                    className="w-full gradient-primary shadow-button py-6"
                  >
                    Book Another Ride
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default RideBooking;