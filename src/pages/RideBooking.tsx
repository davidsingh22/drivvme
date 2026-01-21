import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, Navigation, Clock, TrendingDown, Car, X, Star, Phone, MessageSquare, CreditCard, Bell } from 'lucide-react';
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
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { NotificationPermissionHelpDialog } from '@/components/NotificationPermissionHelpDialog';
import { useActiveRide } from '@/hooks/useActiveRide';
import { RideStatusBanner } from '@/components/RideStatusBanner';
import { useMapboxToken } from '@/hooks/useMapboxToken';

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
  const {
    isSupported: pushSupported,
    isSubscribed: pushSubscribed,
    permission: pushPermission,
    subscribe: subscribeToPush,
    isLoading: pushLoading,
    refreshPermission: refreshPushPermission,
  } = usePushNotifications();
  const [notificationHelpOpen, setNotificationHelpOpen] = useState(false);

  // Active ride persistence hook
  const { activeRide, isLoading: activeRideLoading, updateRide, clearRide } = useActiveRide(user?.id);
  const hasRestoredRide = useRef(false);

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
  const [driverLocation, setDriverLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showStatusBanner, setShowStatusBanner] = useState(false);

  const { token: mapboxToken } = useMapboxToken();

  // Check if current user is a test account - use email from profile or auth user as fallback
  const userEmail = profile?.email || user?.email;
  const isTestAccount = userEmail && TEST_ACCOUNTS.includes(userEmail.toLowerCase());

  // Route guard - drivers go to /driver, only pure riders stay here
  useEffect(() => {
    // Don't redirect during initial auth load unless we have cached roles
    if (authLoading && roles.length === 0) return;

    if (!user) {
      navigate('/login', { replace: true });
      return;
    }

    // Wait for roles to be loaded before deciding
    if (roles.length === 0) return;

    // Drivers (even those also registered as riders) should use the driver dashboard
    // This prevents drivers from accidentally seeing the rider "Finding your driver" UI
    if (isDriver) {
      navigate('/driver', { replace: true });
    }
  }, [user, authLoading, roles.length, isDriver, navigate]);

  // Restore active ride when returning to the app (especially on iOS)
  useEffect(() => {
    if (activeRideLoading || !activeRide || hasRestoredRide.current) return;
    
    hasRestoredRide.current = true;
    console.log('Restoring active ride:', activeRide.id, activeRide.status);
    
    setCurrentRide(activeRide);
    setShowStatusBanner(true);
    
    // Restore locations
    setPickup({
      address: activeRide.pickup_address,
      lat: activeRide.pickup_lat,
      lng: activeRide.pickup_lng,
    });
    setDropoff({
      address: activeRide.dropoff_address,
      lat: activeRide.dropoff_lat,
      lng: activeRide.dropoff_lng,
    });
    setPickupAddress(activeRide.pickup_address);
    setDropoffAddress(activeRide.dropoff_address);
    
    // Restore step based on status
    const statusToStep: Record<string, RideStep> = {
      searching: 'searching',
      driver_assigned: 'matched',
      driver_en_route: 'arriving',
      arrived: 'arrived',
      in_progress: 'inProgress',
      completed: 'completed',
    };
    const newStep = statusToStep[activeRide.status] || 'searching';
    setStep(newStep);
    
    // Fetch driver info if assigned
    if (activeRide.driver_id) {
      fetchDriverInfo(activeRide.driver_id);
    }
    
    // Show a prominent alert about the current ride
    toast({
      title: 'Active ride restored',
      description: `Status: ${activeRide.status.replace('_', ' ')}`,
    });
  }, [activeRide, activeRideLoading, toast]);

  // Subscribe to ride updates via realtime
  useEffect(() => {
    if (!currentRide?.id) return;

    console.log('[RideBooking] Subscribing to realtime for ride:', currentRide.id);

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
          console.log('[RideBooking] Realtime UPDATE received:', payload.new);
          const updatedRide = payload.new as any;
          setCurrentRide(updatedRide);
          updateRide(updatedRide); // Persist to localStorage
          setShowStatusBanner(true);
          
          // Update step based on status
          switch (updatedRide.status) {
            case 'driver_assigned':
              setStep('matched');
              fetchDriverInfo(updatedRide.driver_id);
              // Notify rider that driver has been found
              toast({
                title: t('booking.found'),
                description: 'Your driver is on the way!',
              });
              break;
            case 'driver_en_route':
              setStep('arriving');
              toast({
                title: 'Driver on the way',
                description: 'Your driver is heading to your pickup location.',
              });
              break;
            case 'arrived':
              setStep('arrived');
              toast({
                title: 'Driver has arrived!',
                description: 'Your driver is waiting at the pickup location.',
              });
              break;
            case 'in_progress':
              setStep('inProgress');
              toast({
                title: 'Ride started',
                description: 'Enjoy your trip!',
              });
              break;
            case 'completed':
              setStep('completed');
              clearRide(); // Clear from localStorage
              break;
            case 'cancelled':
              toast({
                title: t('booking.cancelled'),
                variant: 'destructive',
              });
              clearRide(); // Clear from localStorage
              resetBooking();
              break;
          }
        }
      )
      .subscribe((status) => {
        console.log('[RideBooking] Realtime subscription status:', status);
      });

    return () => {
      console.log('[RideBooking] Unsubscribing from realtime');
      supabase.removeChannel(channel);
    };
  }, [currentRide?.id, t, toast]);

  // Fallback polling: if realtime misses updates, poll every 5 seconds
  useEffect(() => {
    if (!currentRide?.id) return;
    // Only poll when in 'searching' status
    if (currentRide.status !== 'searching') return;

    const pollInterval = setInterval(async () => {
      console.log('[RideBooking] Polling ride status...');
      const { data, error } = await supabase
        .from('rides')
        .select('*')
        .eq('id', currentRide.id)
        .single();

      if (error) {
        console.error('[RideBooking] Poll error:', error);
        return;
      }

      if (data && data.status !== currentRide.status) {
        console.log('[RideBooking] Poll detected status change:', data.status);
        setCurrentRide(data);
        updateRide(data);
        setShowStatusBanner(true);

        if (data.status === 'driver_assigned') {
          setStep('matched');
          fetchDriverInfo(data.driver_id);
          toast({
            title: t('booking.found'),
            description: 'Your driver is on the way!',
          });
        }
      }
    }, 5000);

    return () => clearInterval(pollInterval);
  }, [currentRide?.id, currentRide?.status, t, toast]);

  // Subscribe to driver location updates
  useEffect(() => {
    if (!currentRide?.driver_id) {
      setDriverLocation(null);
      return;
    }

    // Fetch initial driver location
    const fetchDriverLocation = async () => {
      const { data } = await supabase
        .from('driver_profiles')
        .select('current_lat, current_lng')
        .eq('user_id', currentRide.driver_id)
        .single();

      if (data?.current_lat && data?.current_lng) {
        setDriverLocation({ lat: data.current_lat, lng: data.current_lng });
      }
    };

    fetchDriverLocation();

    // Subscribe to real-time location updates
    const channel = supabase
      .channel(`driver-location-${currentRide.driver_id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'driver_profiles',
          filter: `user_id=eq.${currentRide.driver_id}`,
        },
        (payload) => {
          const updated = payload.new as { current_lat: number | null; current_lng: number | null };
          if (updated.current_lat && updated.current_lng) {
            setDriverLocation({ lat: updated.current_lat, lng: updated.current_lng });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentRide?.driver_id]);

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
      // Use the same Directions API as the map rendering so the estimate matches the real route.
      // Fallback to a rough estimate only if we don't have a token.
      let estimatedDistance = 0;
      let estimatedDuration = 0;

      if (mapboxToken) {
        const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${pickup.lng},${pickup.lat};${dropoff.lng},${dropoff.lat}?overview=false&alternatives=false&access_token=${mapboxToken}`;
        const res = await fetch(url);
        const data = await res.json();
        const route = data?.routes?.[0];

        // Mapbox returns distance in meters, duration in seconds
        if (!route?.distance || !route?.duration) {
          throw new Error('No route returned');
        }

        estimatedDistance = route.distance / 1000;
        estimatedDuration = route.duration / 60;
      } else {
        // Rough fallback (straight-line with a road factor)
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

        estimatedDistance = straightLineDistance * 1.4;
        estimatedDuration = (estimatedDistance / 30) * 60;
      }

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
  }, [pickup, dropoff, toast, mapboxToken]);

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

    // Show payment step immediately for faster UI response
    setStep('payment');
    setIsSubmitting(true);
    
    try {
      // Session refresh runs in background - don't block UI
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        toast({
          title: 'Session expired',
          description: 'Please sign in again to continue.',
          variant: 'destructive',
        });
        setStep('estimate');
        navigate('/login');
        return;
      }

      const userId = session.user.id;
      console.log('Creating ride with rider_id:', userId);

      // Create the ride + notify drivers server-side (more reliable than client-only notify)
      const { data, error } = await supabase.functions.invoke('create-ride-and-notify-drivers', {
        body: {
          pickup,
          dropoff,
          distanceKm,
          durationMinutes,
          estimatedFare: fareEstimate.total,
        },
      });

      const ride = data?.ride;

      if (error) {
        console.error('Ride insert error:', error);
        throw error;
      }

      if (!ride?.id) {
        throw new Error('Ride creation failed');
      }

      setCurrentRide(ride);
      updateRide(ride); // Persist to localStorage
      setShowStatusBanner(true);
    } catch (error: any) {
      console.error('Error creating ride:', error);
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
      // Go back to estimate step on error
      setStep('estimate');
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
      const { error } = await supabase
        .from('rides')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          cancelled_by: user?.id,
          cancellation_reason: 'Payment cancelled',
        })
        .eq('id', currentRide.id);

      if (error) {
        toast({ title: 'Cancel failed', description: error.message, variant: 'destructive' });
      }
    }
    setCurrentRide(null);
    clearRide();
    setStep('estimate');
  };

  const handleCancelRide = async () => {
    if (!currentRide) return;

    try {
      const { error } = await supabase
        .from('rides')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          cancelled_by: user?.id,
          cancellation_reason: 'Cancelled by rider',
        })
        .eq('id', currentRide.id);

      if (error) throw error;

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
    setDriverLocation(null);
    setShowStatusBanner(false);
    clearRide(); // Clear from localStorage
    hasRestoredRide.current = false;
  };

  // Avoid blocking the whole page during background token refreshes.
  // If roles are already loaded, keep the UI responsive.
  if (authLoading && roles.length === 0) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">{t('common.loading')}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      {/* Persistent status banner for active rides */}
      {showStatusBanner && currentRide && !['completed', 'cancelled'].includes(currentRide.status) && (
        <RideStatusBanner
          status={currentRide.status}
          driverName={driverInfo ? `${driverInfo.first_name || ''} ${driverInfo.last_name || ''}`.trim() : undefined}
          pickupAddress={currentRide.pickup_address}
          onDismiss={() => setShowStatusBanner(false)}
        />
      )}
      
      <div className="pt-16 h-screen flex flex-col lg:flex-row">
        {/* Map */}
        <div className="flex-1 relative">
          <MapComponent
            pickup={pickup}
            dropoff={dropoff}
            driverLocation={driverLocation}
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

                  {/* Price Comparison */}
                  <Card className="p-6 gradient-card border-primary/20">
                    {/* Uber Equivalent */}
                    <div className="mb-4 pb-4 border-b border-border/50">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-muted-foreground">Uber Equivalent</span>
                        <span className="text-lg line-through text-muted-foreground">
                          {formatCurrency(fareEstimate.uberEquivalent, language)}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground/70">
                        <span>Base fare: {formatCurrency(fareEstimate.uberBaseFare, language)}</span>
                        <span>Booking fee: {formatCurrency(fareEstimate.uberBookingFee, language)}</span>
                        <span>Distance: {formatCurrency(fareEstimate.uberDistanceFare, language)}</span>
                        <span>Time: {formatCurrency(fareEstimate.uberTimeFare, language)}</span>
                      </div>
                    </div>

                    {/* Drivveme Price */}
                    <div className="mb-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-lg font-medium">Drivveme Price</span>
                        <span className="font-display text-3xl font-bold text-gradient">
                          {formatCurrency(fareEstimate.total, language)}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                        <span>Base fare: {formatCurrency(fareEstimate.baseFare, language)}</span>
                        <span>Booking fee: {formatCurrency(fareEstimate.bookingFee, language)}</span>
                        <span>Distance: {formatCurrency(fareEstimate.distanceFare, language)}</span>
                        <span>Time: {formatCurrency(fareEstimate.timeFare, language)}</span>
                      </div>
                    </div>
                    
                    {/* Savings highlight */}
                    <div className="flex items-center gap-2 text-accent bg-accent/10 rounded-lg p-3">
                      <TrendingDown className="h-5 w-5" />
                      <span className="font-medium">
                        You save {formatCurrency(fareEstimate.savings, language)} ({fareEstimate.savingsPercent}% cheaper!)
                      </span>
                    </div>

                    {fareEstimate.surgeMultiplier > 1 && (
                      <div className="mt-3 flex items-center gap-2 text-warning text-sm">
                        <Clock className="h-4 w-4" />
                        <span>Surge pricing: {fareEstimate.surgeMultiplier}x</span>
                      </div>
                    )}
                  </Card>

                  {/* Push Notification Prompt */}
                  {!pushSubscribed && (
                    <Card className="p-4 bg-primary/5 border-primary/20">
                      <div className="flex items-center gap-3">
                        <Bell className="h-5 w-5 text-primary" />
                        <div className="flex-1">
                          <p className="font-medium text-sm">Get notified when your driver arrives</p>
                          {!pushSupported ? (
                            <p className="text-xs text-muted-foreground">
                              Push notifications aren9t available in this browser mode. On iPhone/iPad, install the app (Add to Home Screen) to enable push.
                            </p>
                          ) : pushPermission === 'denied' ? (
                            <p className="text-xs text-muted-foreground">
                              Notifications are blocked in your browser settings.
                            </p>
                          ) : (
                            <p className="text-xs text-muted-foreground">Enable notifications to stay updated</p>
                          )}
                        </div>

                        {!pushSupported ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setNotificationHelpOpen(true)}
                          >
                            How to enable
                          </Button>
                        ) : pushPermission === 'denied' ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              refreshPushPermission();
                              setNotificationHelpOpen(true);
                            }}
                          >
                            Fix settings
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={async () => {
                              const ok = await subscribeToPush();
                              if (!ok) return;

                              const { data, error } = await supabase.functions.invoke('send-push-notification', {
                                body: {
                                  userId: user?.id,
                                  title: 'Test notification',
                                  body: 'Notifications are working for your account.',
                                  url: '/ride',
                                },
                              });

                              if (error) {
                                toast({ title: 'Test notification failed', description: error.message, variant: 'destructive' });
                                return;
                              }

                              if (!data?.sent) {
                                toast({
                                  title: 'Not subscribed yet',
                                  description: 'No subscription found for your device. Try enabling again.',
                                  variant: 'destructive',
                                });
                                return;
                              }

                              toast({
                                title: 'Test notification sent',
                                description: "If you don't see it, check notification settings (and iPhone requires Add to Home Screen).",
                              });
                            }}
                            disabled={pushLoading}
                          >
                            {pushLoading ? 'Enabling...' : 'Enable & Test'}
                          </Button>
                        )}
                      </div>

                      <NotificationPermissionHelpDialog
                        open={notificationHelpOpen}
                        onOpenChange={setNotificationHelpOpen}
                      />
                    </Card>
                  )}

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
                      <Button
                        asChild
                        variant="outline"
                        className="gap-2"
                        disabled={!driverInfo.phone_number}
                      >
                        <a
                          href={driverInfo.phone_number ? `tel:${driverInfo.phone_number}` : undefined}
                          aria-disabled={!driverInfo.phone_number}
                        >
                          <Phone className="h-4 w-4" />
                          Call
                        </a>
                      </Button>
                      <Button
                        asChild
                        variant="outline"
                        className="gap-2"
                        disabled={!driverInfo.phone_number}
                      >
                        <a
                          href={driverInfo.phone_number ? `sms:${driverInfo.phone_number}` : undefined}
                          aria-disabled={!driverInfo.phone_number}
                        >
                          <MessageSquare className="h-4 w-4" />
                          Message
                        </a>
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