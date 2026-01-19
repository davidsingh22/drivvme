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

// Test accounts that can bypass payment
const TEST_ACCOUNTS = ['alsenesa@hotmail.com', 'davidsingh22@hotmail.com'];

const RideBooking = () => {
  const { t, language } = useLanguage();
  const { user, profile, roles, isRider, isDriver, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [step, setStep] = useState<RideStep>('input');
  const [pickup, setPickup] = useState<Location | null>(null);
  const [dropoff, setDropoff] = useState<Location | null>(null);
  const [pickupAddress, setPickupAddress] = useState('');
  const [dropoffAddress, setDropoffAddress] = useState('');
  const [fareEstimate, setFareEstimate] = useState<FareEstimate | null>(null);
  const [distanceKm, setDistanceKm] = useState(0);
  const [durationMinutes, setDurationMinutes] = useState(0);
  const [currentRide, setCurrentRide] = useState<any>(null);
  const [driverInfo, setDriverInfo] = useState<any>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Check if current user is a test account
  const isTestAccount = profile?.email && TEST_ACCOUNTS.includes(profile.email.toLowerCase());

  // Route guard
  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      navigate('/login', { replace: true });
      return;
    }

    // Wait for roles to be loaded
    if (roles.length === 0) return;

    // Drivers should not use the rider booking page
    if (isDriver && !isRider) {
      navigate('/driver', { replace: true });
    }
  }, [user, authLoading, roles.length, isDriver, isRider, navigate]);

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
        const fallbackAddress = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        setPickupAddress(fallbackAddress);
        setPickup({ address: fallbackAddress, lat, lng });
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

  const calculateRoute = useCallback(async () => {
    if (!pickup || !dropoff) return;

    try {
      // Use Mapbox Directions API directly via the token hook in MapComponent
      // For estimation, calculate rough distance using Haversine formula
      const R = 6371; // Earth's radius in km
      const dLat = ((dropoff.lat - pickup.lat) * Math.PI) / 180;
      const dLon = ((dropoff.lng - pickup.lng) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((pickup.lat * Math.PI) / 180) *
          Math.cos((dropoff.lat * Math.PI) / 180) *
          Math.sin(dLon / 2) *
          Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const straightLineDistance = R * c;
      
      // Adjust for road distance (typically 1.3-1.5x straight line)
      const estimatedDistance = straightLineDistance * 1.4;
      // Estimate duration: average urban speed ~30km/h
      const estimatedDuration = (estimatedDistance / 30) * 60;

      setDistanceKm(estimatedDistance);
      setDurationMinutes(estimatedDuration);

      const estimate = calculateFare(estimatedDistance, estimatedDuration);
      setFareEstimate(estimate);
      setStep('estimate');
    } catch (error) {
      toast({
        title: 'Route error',
        description: 'Unable to calculate route',
        variant: 'destructive',
      });
    }
  }, [pickup, dropoff, toast]);

  const handleGetEstimate = async () => {
    if (!pickup || !dropoff) {
      toast({
        title: 'Missing locations',
        description: 'Please select both pickup and destination from the suggestions.',
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
      // Refresh the session to ensure we have a valid token
      const { data: { session }, error: sessionError } = await supabase.auth.refreshSession();
      
      if (sessionError) {
        console.error('Session refresh error:', sessionError);
        // Try getSession as fallback
        const { data: { session: existingSession } } = await supabase.auth.getSession();
        if (!existingSession) {
          toast({
            title: 'Session expired',
            description: 'Please sign in again to continue.',
            variant: 'destructive',
          });
          navigate('/login');
          return;
        }
      }

      const userId = session?.user?.id || user.id;
      console.log('Creating ride with rider_id:', userId);

      // Create the ride first with 'searching' status but don't activate yet
      const { data: ride, error } = await supabase
        .from('rides')
        .insert({
          rider_id: userId,
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

      if (error) {
        console.error('Ride insert error:', error);
        throw error;
      }

      setCurrentRide(ride);
      setStep('payment');
    } catch (error: any) {
      console.error('Error creating ride:', error);
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

                  {/* Test Mode Payment Bypass */}
                  {isTestAccount ? (
                    <div className="space-y-4">
                      <Card className="p-4 bg-success/10 border-success/30">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-success/20 flex items-center justify-center">
                            <CreditCard className="h-5 w-5 text-success" />
                          </div>
                          <div>
                            <p className="font-semibold text-success">Test Mode Active</p>
                            <p className="text-sm text-muted-foreground">
                              Payment will be simulated for testing
                            </p>
                          </div>
                        </div>
                      </Card>
                      <div className="flex gap-3">
                        <Button
                          variant="outline"
                          onClick={handlePaymentCancel}
                          className="flex-1"
                        >
                          Cancel
                        </Button>
                        <Button
                          onClick={handlePaymentSuccess}
                          className="flex-1 gradient-primary shadow-button"
                        >
                          Simulate Payment
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <PaymentForm
                      rideId={currentRide.id}
                      amount={fareEstimate.total}
                      onSuccess={handlePaymentSuccess}
                      onCancel={handlePaymentCancel}
                    />
                  )}
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