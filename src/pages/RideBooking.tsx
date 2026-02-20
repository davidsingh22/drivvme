import React, { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, Navigation, Clock, TrendingDown, Car, X, CreditCard, Bell, History, ChevronDown, LogOut, HelpCircle, ArrowLeft } from 'lucide-react';
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
import { useMapboxToken, clearMapboxTokenCache } from '@/hooks/useMapboxToken';
import { useDriverNotificationEscalation } from '@/hooks/useDriverNotificationEscalation';
import useRideNotifications from '@/hooks/useRideNotifications';
import InRideStatusBar from '@/components/ride/InRideStatusBar';
import InRideDriverCard from '@/components/ride/InRideDriverCard';
import SafetySheet from '@/components/ride/SafetySheet';
import TripCompletionScreen from '@/components/ride/TripCompletionScreen';
import { MapRecenterButton } from '@/components/MapRecenterButton';
import { useRealtimeDriverTracking } from '@/hooks/useRealtimeDriverTracking';
import { useRiderLocationTracking } from '@/hooks/useRiderLocationTracking';
import { GreetingHeader } from '@/components/booking/GreetingHeader';
import { RecentDestinations } from '@/components/booking/RecentDestinations';
import { QuickDestinations } from '@/components/booking/QuickDestinations';
import welcomeBg from '@/assets/drivveme-galaxy-bg-new.png';
import rideBg from '@/assets/drivveme-ride-bg.png';
import drivvemeCarIcon from '@/assets/drivveme-car-icon.png';
import { HelpDialog } from '@/components/HelpDialog';
import { useUnreadSupportMessages } from '@/hooks/useUnreadSupportMessages';
import { useOneSignalRiderPrompt } from '@/hooks/useOneSignalRiderPrompt';
// Debug UI components - only loaded if localStorage.DEBUG_RIDE === "1"
// Debug UI components - only loaded if localStorage.DEBUG_RIDE === "1"
const RideDebugBar = React.lazy(() => import('@/components/RideDebugBar').then(m => ({
  default: m.RideDebugBar
})));
const RideLocationHistory = React.lazy(() => import('@/components/RideLocationHistory').then(m => ({
  default: m.RideLocationHistory
})));
type RideStep = 'input' | 'estimate' | 'payment' | 'searching' | 'matched' | 'arriving' | 'arrived' | 'inProgress' | 'completed';
interface Location {
  address: string;
  lat: number;
  lng: number;
}

// Test accounts that bypass payment
const TEST_ACCOUNTS = ['alsenesa@hotmail.com'];

// Limited test accounts - bypass payment for a limited number of rides
const LIMITED_TEST_ACCOUNTS: Record<string, number> = {
  'sean.mcturk@outlook.com': 3,
  'mcturksean@gmail.com': 3,
  'patsy@hotmail.com': 999,
  'rymcturk@gmail.com': 3,
  'kissmebaby@hotmail.com': 999
};

// Get remaining free rides for a limited test account
const getRemainingFreeRides = (email: string): number => {
  const lowerEmail = email.toLowerCase();
  const limit = LIMITED_TEST_ACCOUNTS[lowerEmail];
  if (!limit) return 0;
  const usedKey = `drivvme_free_rides_used_${lowerEmail}`;
  const used = parseInt(localStorage.getItem(usedKey) || '0', 10);
  return Math.max(0, limit - used);
};

// Increment used free rides count
const incrementFreeRidesUsed = (email: string): void => {
  const lowerEmail = email.toLowerCase();
  const usedKey = `drivvme_free_rides_used_${lowerEmail}`;
  const used = parseInt(localStorage.getItem(usedKey) || '0', 10);
  localStorage.setItem(usedKey, String(used + 1));
};

// Auto-retry indicator that won't hang forever
const CalculatingRouteIndicator = ({ language, dropoff, onRetry }: { language: string; dropoff: any; onRetry: () => void }) => {
  const [elapsed, setElapsed] = useState(0);
  const retriedRef = useRef(false);

  useEffect(() => {
    retriedRef.current = false;
    setElapsed(0);
    const interval = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(interval);
  }, [dropoff?.lat, dropoff?.lng]);

  // Auto-retry after 6 seconds if still showing
  useEffect(() => {
    if (elapsed >= 6 && !retriedRef.current) {
      retriedRef.current = true;
      console.log('[RideBooking] Calculating route timed out, auto-retrying...');
      onRetry();
    }
  }, [elapsed, onRetry]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center justify-center gap-3 py-8">
      <div className="h-5 w-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      <span className="text-sm text-muted-foreground">
        {elapsed >= 6
          ? (language === 'fr' ? 'Nouvelle tentative...' : 'Retrying...')
          : (language === 'fr' ? 'Calcul du trajet...' : 'Calculating route...')}
      </span>
    </motion.div>
  );
};

const RideBooking = () => {
  const {
    t,
    language
  } = useLanguage();
  const {
    user,
    profile,
    roles,
    isRider,
    isDriver,
    isLoading: authLoading,
    signOut
  } = useAuth();
  const navigate = useNavigate();
  const {
    toast
  } = useToast();
  const {
    isSupported: pushSupported,
    isSubscribed: pushSubscribed,
    permission: pushPermission,
    subscribe: subscribeToPush,
    isLoading: pushLoading,
    refreshPermission: refreshPushPermission
  } = usePushNotifications();
  const [notificationHelpOpen, setNotificationHelpOpen] = useState(false);

  // Active ride persistence hook
  const {
    activeRide,
    isLoading: activeRideLoading,
    updateRide,
    clearRide
  } = useActiveRide(user?.id);
  const hasRestoredRide = useRef(false);

  // Cache-first destinations: render from localStorage instantly, update from DB in background
  const DEST_CACHE_KEY = 'drivveme_cached_destinations';
  const [prefetchedDestinations, setPrefetchedDestinations] = useState<any[]>(() => {
    try {
      const cached = localStorage.getItem(DEST_CACHE_KEY);
      return cached ? JSON.parse(cached) : [];
    } catch { return []; }
  });
  const hasPrefetched = useRef(false);
  useEffect(() => {
    if (!user?.id || hasPrefetched.current) return;
    hasPrefetched.current = true;
    supabase
      .from('rider_destinations')
      .select('*')
      .eq('user_id', user.id)
      .order('last_visited_at', { ascending: false })
      .limit(10)
      .then(({ data }) => {
        if (data && data.length > 0) {
          setPrefetchedDestinations(data);
          try { localStorage.setItem(DEST_CACHE_KEY, JSON.stringify(data)); } catch {}
        }
      });
  }, [user?.id]);
  const [step, setStep] = useState<RideStep>('input');
  // Show "Current Location" as placeholder — GPS will replace it with a real address
  const [pickup, setPickup] = useState<Location | null>(null);
  const [dropoff, setDropoff] = useState<Location | null>(null);
  const [pickupAddress, setPickupAddress] = useState(() => {
    return language === 'fr' ? 'Position actuelle' : 'Current Location';
  });
  // Flag: true once GPS has resolved a real address
  const [gpsResolved, setGpsResolved] = useState(false);
  const [dropoffAddress, setDropoffAddress] = useState('');
  const [fareEstimate, setFareEstimate] = useState<FareEstimate | null>(null);
  const [distanceKm, setDistanceKm] = useState(0);
  const [durationMinutes, setDurationMinutes] = useState(0);
  const [currentRide, setCurrentRide] = useState<any>(null);
  const [driverInfo, setDriverInfo] = useState<any>(null);
  const [driverLocation, setDriverLocation] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [riderLiveLocation, setRiderLiveLocation] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notificationTier, setNotificationTier] = useState(1);
  const [safetySheetOpen, setSafetySheetOpen] = useState(false);
  const [minutesAway, setMinutesAway] = useState<number | null>(null);
  const [followDriver, setFollowDriver] = useState(true);
  const paymentGateCheckedRef = useRef<string | null>(null);
  const riderLocationWatchId = useRef<number | null>(null);
  const mapRef = useRef<any>(null);
  const hasAutoDetectedLocation = useRef(false);
  // Spinner fully removed — no detecting state needed
  const [showFullInput, setShowFullInput] = useState(false);
  const [helpDialogOpen, setHelpDialogOpen] = useState(false);
  const {
    unreadCount: unreadSupportMessages
  } = useUnreadSupportMessages();

  // Auto-prompt OneSignal push notifications for riders
  useOneSignalRiderPrompt();

  // Realtime driver tracking with live ETA
  const isActiveRidePhase = step === 'matched' || step === 'arriving' || step === 'arrived' || step === 'inProgress';
  const targetLocation = step === 'inProgress' ? dropoff : pickup;
  const {
    driverLocation: realtimeDriverLocation,
    eta: realtimeETA,
    lastUpdateSeconds,
    dataSource,
    hasNoUpdatesError,
    isReconnecting,
    resubscribe
  } = useRealtimeDriverTracking({
    rideId: currentRide?.id ?? null,
    driverId: currentRide?.driver_id ?? null,
    targetLocation: targetLocation,
    enabled: isActiveRidePhase && !!currentRide?.driver_id
  });

  // Use realtime driver location when available
  const effectiveDriverLocation = realtimeDriverLocation ? {
    lat: realtimeDriverLocation.lat,
    lng: realtimeDriverLocation.lng
  } : driverLocation;
  const {
    token: mapboxToken
  } = useMapboxToken();

  // Session recovery: refresh session + Mapbox token when returning from background after idle
  useEffect(() => {
    let lastVisible = Date.now();
    const handleVisibility = async () => {
      if (document.visibilityState === 'visible') {
        const idleMs = Date.now() - lastVisible;
        // If idle > 5 minutes, proactively refresh session and clear stale token cache
        if (idleMs > 5 * 60 * 1000) {
          console.log('[RideBooking] Returning after', Math.round(idleMs / 1000), 's idle — refreshing session');
          try {
            const { data } = await supabase.auth.refreshSession();
            if (data?.session) {
              console.log('[RideBooking] Session refreshed successfully');
              // Clear stale Mapbox token so it re-fetches with fresh session
              clearMapboxTokenCache();
            }
          } catch (err) {
            console.error('[RideBooking] Session refresh failed:', err);
          }
        }
      } else {
        lastVisible = Date.now();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  // Track rider location for admin visibility
  useRiderLocationTracking(true);

  // Tiered driver notification escalation
  const escalationOptions = currentRide && step === 'searching' && pickup && dropoff && fareEstimate ? {
    rideId: currentRide.id,
    pickupLat: pickup.lat,
    pickupLng: pickup.lng,
    pickupAddress: pickup.address,
    dropoffAddress: dropoff.address,
    estimatedFare: fareEstimate.total,
    onTierChange: (tier: number) => {
      setNotificationTier(tier);
      if (tier > 1) {
        toast({
          title: `Expanding search (Tier ${tier})`,
          description: tier === 4 ? 'Contacting fastest available drivers...' : 'Looking for more drivers nearby...'
        });
      }
    },
    onDriverFound: () => {
      setNotificationTier(1); // Reset
    }
  } : null;
  const {
    start: startEscalation,
    stop: stopEscalation
  } = useDriverNotificationEscalation(escalationOptions);

  // Route guard - drivers go to /driver, only pure riders stay here
  // Track if we've started a redirect to prevent flash
  const [isRedirecting, setIsRedirecting] = useState(false);
  const routeGuardResolved = useRef(false);
  useEffect(() => {
    // Don't redirect while auth state is still being resolved.
    if (authLoading) return;

    // Once we've resolved the route guard, don't re-run on background refreshes
    if (routeGuardResolved.current) return;

    if (!user) {
      setIsRedirecting(true);
      navigate('/login', {
        replace: true
      });
      return;
    }

    // Drivers should never land on /ride (rider booking UI).
    let cancelled = false;
    const maybeRedirectDriver = async () => {
      // If context already knows they're a driver, redirect immediately.
      if (isDriver) {
        if (cancelled) return;
        setIsRedirecting(true);
        navigate('/driver', {
          replace: true
        });
        return;
      }

      // If roles are present and not driver, allow rider flow — mark resolved.
      if (roles.length > 0 && !isDriver) {
        routeGuardResolved.current = true;
        return;
      }

      // Roles missing: do a one-shot backend role check to avoid misrouting drivers to /ride.
      const {
        data: isDriverRpc
      } = await supabase.rpc('is_driver', {
        _user_id: user.id
      });
      if (cancelled) return;
      if (isDriverRpc) {
        setIsRedirecting(true);
        navigate('/driver', {
          replace: true
        });
        return;
      }

      // Extra resilience: check if user has an active ride AS A DRIVER
      const {
        data: activeDriverRide
      } = await supabase.from('rides').select('id').eq('driver_id', user.id).in('status', ['driver_assigned', 'driver_en_route', 'arrived', 'in_progress']).limit(1).maybeSingle();
      if (cancelled) return;
      if (activeDriverRide) {
        setIsRedirecting(true);
        navigate('/driver', {
          replace: true
        });
        return;
      }

      // Extra resilience: infer driver if a driver_profile exists.
      const {
        data: dp
      } = await supabase.from('driver_profiles').select('id').eq('user_id', user.id).maybeSingle();
      if (cancelled) return;
      if (dp?.id) {
        setIsRedirecting(true);
        navigate('/driver', {
          replace: true
        });
        return;
      }

      // Not a driver — mark resolved so we don't re-run
      routeGuardResolved.current = true;
    };
    void maybeRedirectDriver();
    return () => {
      cancelled = true;
    };
  }, [user, authLoading, roles.length, isDriver, navigate]);

  // Helper to reverse geocode coordinates to a readable address
  const reverseGeocode = useCallback(async (lat: number, lng: number): Promise<string | null> => {
    if (!mapboxToken) return null;
    try {
      const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${mapboxToken}&language=${language}&types=address,poi`);
      const data = await res.json();
      const place = data?.features?.[0];
      if (place) {
        // Extract a clean street address
        let cleanAddress = '';

        // Check if it's a POI with address
        if (place.properties?.address) {
          cleanAddress = place.properties.address;
        } else if (place.text && place.address) {
          // Combine street number and street name
          cleanAddress = `${place.address} ${place.text}`;
        } else if (place.place_name) {
          // Use first part of place_name (before first comma)
          cleanAddress = place.place_name.split(',')[0];
        }
        return cleanAddress || place.place_name || null;
      }
    } catch (err) {
      console.error('[RideBooking] Reverse geocode error:', err);
    }
    return null;
  }, [mapboxToken, language]);

   // localStorage cache key for pickup
  const PICKUP_CACHE_KEY = 'drivveme_last_pickup';

  // Ref to store GPS coords obtained before mapboxToken is ready
  const pendingGpsCoords = useRef<{ lat: number; lng: number } | null>(null);

  // Helper: apply GPS coords to pickup state
  const applyGpsCoords = useCallback((lat: number, lng: number) => {
    console.log('[RideBooking] GPS acquired:', lat.toFixed(4), lng.toFixed(4));
    setPickup({ address: language === 'fr' ? 'Position actuelle' : 'Current Location', lat, lng });
    pendingGpsCoords.current = { lat, lng };
    setGpsResolved(false); // Will be resolved once address is reverse geocoded
  }, [language]);

  // Step 1: Get GPS coords immediately with aggressive retry + watchPosition fallback
  useEffect(() => {
    if (hasAutoDetectedLocation.current) return;
    if (!navigator.geolocation) return;
    hasAutoDetectedLocation.current = true;

    let watchId: number | null = null;
    let resolved = false;
    let attempt = 0;
    const MAX_ATTEMPTS = 3;

    const onSuccess = (position: GeolocationPosition) => {
      if (resolved) return;
      resolved = true;
      if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
      applyGpsCoords(position.coords.latitude, position.coords.longitude);
    };

    const tryGetPosition = () => {
      attempt++;
      const useHighAccuracy = attempt <= 2; // Last attempt uses low accuracy as fallback
      const timeout = attempt === 1 ? 8000 : attempt === 2 ? 12000 : 15000;
      console.log(`[RideBooking] GPS attempt ${attempt}/${MAX_ATTEMPTS} (highAccuracy=${useHighAccuracy}, timeout=${timeout}ms)`);

      navigator.geolocation.getCurrentPosition(
        onSuccess,
        (error) => {
          console.warn(`[RideBooking] GPS attempt ${attempt} failed:`, error.code, error.message);
          if (!resolved && attempt < MAX_ATTEMPTS) {
            // Retry after a brief delay
            setTimeout(tryGetPosition, 1000);
          } else if (!resolved) {
            // All attempts failed — start watchPosition as last resort
            console.log('[RideBooking] All getCurrentPosition attempts failed, starting watchPosition...');
            watchId = navigator.geolocation.watchPosition(
              onSuccess,
              (watchErr) => {
                console.warn('[RideBooking] watchPosition error:', watchErr.code, watchErr.message);
              },
              { enableHighAccuracy: false, timeout: 20000, maximumAge: 60000 }
            );
            // Give watchPosition 15s then give up and use cache
            setTimeout(() => {
              if (!resolved) {
                console.warn('[RideBooking] GPS completely unavailable, using cache fallback');
                if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
                try {
                  const cached = localStorage.getItem(PICKUP_CACHE_KEY);
                  if (cached) {
                    const { lat, lng, addressLabel } = JSON.parse(cached);
                    if (lat && lng && addressLabel) {
                      setPickup({ address: addressLabel, lat, lng });
                      setPickupAddress(addressLabel);
                      setGpsResolved(true);
                    }
                  }
                } catch {}
              }
            }, 15000);
          }
        },
        { enableHighAccuracy: useHighAccuracy, timeout, maximumAge: 0 }
      );
    };

    tryGetPosition();

    return () => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    };
  }, [language, applyGpsCoords]);

  // Step 2: Once we have BOTH GPS coords AND mapboxToken, reverse geocode to get the real street address
  useEffect(() => {
    if (!pendingGpsCoords.current) return;
    if (!mapboxToken) return; // Wait for token
    const { lat, lng } = pendingGpsCoords.current;
    pendingGpsCoords.current = null; // Clear so this only runs once

    console.log('[RideBooking] Resolving address for GPS coords...');
    reverseGeocode(lat, lng).then(address => {
      const finalAddress = address || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      console.log('[RideBooking] Address resolved:', finalAddress);
      setPickupAddress(finalAddress);
      setPickup({ address: finalAddress, lat, lng });
      setGpsResolved(true);
      try {
        localStorage.setItem(PICKUP_CACHE_KEY, JSON.stringify({ lat, lng, addressLabel: finalAddress, ts: Date.now() }));
        localStorage.setItem('last_pickup_address', finalAddress);
      } catch {}
    });
  }, [mapboxToken, reverseGeocode]);

  // Step 3: Safety net — if pickup has coords but still shows generic text, resolve when token is ready
  useEffect(() => {
    if (!pickup || !pickup.lat || !pickup.lng || !mapboxToken || gpsResolved) return;
    const genericLabels = ['Current Location', 'Position actuelle', 'Current location', ''];
    const isGeneric = genericLabels.includes(pickupAddress) || pickupAddress.match(/^-?\d+\.\d+,\s*-?\d+\.\d+$/);
    if (!isGeneric) {
      setGpsResolved(true);
      return;
    }
    reverseGeocode(pickup.lat, pickup.lng).then(address => {
      if (address) {
        setPickupAddress(address);
        setPickup(prev => prev ? { ...prev, address } : null);
        setGpsResolved(true);
        try {
          localStorage.setItem(PICKUP_CACHE_KEY, JSON.stringify({ lat: pickup.lat, lng: pickup.lng, addressLabel: address, ts: Date.now() }));
          localStorage.setItem('last_pickup_address', address);
        } catch {}
      }
    });
  }, [pickup?.lat, pickup?.lng, pickupAddress, mapboxToken, reverseGeocode, gpsResolved]);

  // Restore active ride when returning to the app (especially on iOS)
  useEffect(() => {
    if (activeRideLoading || !activeRide || hasRestoredRide.current) return;
    hasRestoredRide.current = true;
    console.log('Restoring active ride:', activeRide.id, activeRide.status);

    // Check if payment was completed for this ride before restoring to searching step
    const checkPaymentAndRestore = async () => {
      setCurrentRide(activeRide);

      // Restore locations
      setPickup({
        address: activeRide.pickup_address,
        lat: activeRide.pickup_lat,
        lng: activeRide.pickup_lng
      });
      setDropoff({
        address: activeRide.dropoff_address,
        lat: activeRide.dropoff_lat,
        lng: activeRide.dropoff_lng
      });
      setPickupAddress(activeRide.pickup_address);
      setDropoffAddress(activeRide.dropoff_address);

      // Set fare estimate from the ride data using stored values or recalculate
      if (activeRide.distance_km && activeRide.estimated_duration_minutes) {
        const recalculated = calculateFare(activeRide.distance_km, activeRide.estimated_duration_minutes);
        setFareEstimate(recalculated);
      }

      // If ride is pending_payment or searching without a succeeded payment, show payment
      if (activeRide.status === 'pending_payment' || activeRide.status === 'searching') {
        const {
          data: payment
        } = await supabase.from('payments').select('status').eq('ride_id', activeRide.id).maybeSingle();

        // If payment isn't succeeded yet, stay on payment step
        if (!payment || payment.status !== 'succeeded') {
          console.log('Payment not succeeded, showing payment step');
          setStep('payment');
          toast({
            title: 'Complete your payment',
            description: 'Please complete payment to find a driver.'
          });
          return;
        }
      }

      // Restore step based on status (payment was completed)
      const statusToStep: Record<string, RideStep> = {
        pending_payment: 'payment',
        searching: 'searching',
        driver_assigned: 'matched',
        driver_en_route: 'arriving',
        arrived: 'arrived',
        in_progress: 'inProgress',
        completed: 'completed'
      };
      const newStep = statusToStep[activeRide.status] || 'payment';
      setStep(newStep);

      // Fetch driver info if assigned
      if (activeRide.driver_id) {
        fetchDriverInfo(activeRide.driver_id);
      }

      // Show a prominent alert about the current ride
      toast({
        title: 'Active ride restored',
        description: `Status: ${activeRide.status.replace('_', ' ')}`
      });
    };
    checkPaymentAndRestore();
  }, [activeRide, activeRideLoading, toast]);

  // Subscribe to ride updates via realtime
  useEffect(() => {
    if (!currentRide?.id) return;
    console.log('[RideBooking] Subscribing to realtime for ride:', currentRide.id);
    const channel = supabase.channel(`ride-${currentRide.id}`).on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'rides',
      filter: `id=eq.${currentRide.id}`
    }, payload => {
      console.log('[RideBooking] Realtime UPDATE received:', payload.new);
      const updatedRide = payload.new as any;
      setCurrentRide(updatedRide);
      updateRide(updatedRide); // Persist to localStorage

      // Update step based on status
      switch (updatedRide.status) {
        case 'driver_assigned':
          setStep('matched');
          fetchDriverInfo(updatedRide.driver_id);
          // Notify rider that driver has been found
          toast({
            title: t('booking.found'),
            description: 'Your driver is on the way!'
          });
          break;
        case 'driver_en_route':
          setStep('arriving');
          toast({
            title: 'Driver on the way',
            description: 'Your driver is heading to your pickup location.'
          });
          break;
        case 'arrived':
          setStep('arrived');
          toast({
            title: 'Driver has arrived!',
            description: 'Your driver is waiting at the pickup location.'
          });
          break;
        case 'in_progress':
          setStep('inProgress');
          toast({
            title: 'Ride started',
            description: 'Enjoy your trip!'
          });
          break;
        case 'completed':
          setStep('completed');
          clearRide(); // Clear from localStorage
          // Save the dropoff destination for future suggestions
          if (dropoff && user?.id) {
            saveDropoffDestination(dropoff);
          }
          break;
        case 'cancelled':
          toast({
            title: t('booking.cancelled'),
            variant: 'destructive'
          });
          clearRide(); // Clear from localStorage
          resetBooking();
          break;
      }
    }).subscribe(status => {
      console.log('[RideBooking] Realtime subscription status:', status);
    });
    return () => {
      console.log('[RideBooking] Unsubscribing from realtime');
      supabase.removeChannel(channel);
    };
  }, [currentRide?.id, t, toast]);

  // Hard payment gate: never allow the UI to show "searching" (or beyond) if payment isn't succeeded.
  // Test accounts bypass this gate entirely (unlimited or limited free rides).
  const isUnlimitedTestAccount = user?.email && TEST_ACCOUNTS.includes(user.email.toLowerCase());
  const remainingFreeRides = user?.email ? getRemainingFreeRides(user.email) : 0;
  const isTestAccount = isUnlimitedTestAccount || remainingFreeRides > 0;
  useEffect(() => {
    if (!currentRide?.id) return;
    if (!fareEstimate) return;
    // Test accounts skip payment gate
    if (isTestAccount) return;
    const shouldGate = step === 'searching' || step === 'matched' || step === 'arriving' || step === 'arrived' || step === 'inProgress';
    if (!shouldGate) return;

    // Avoid spamming the backend/toasts on repeated renders.
    const gateKey = `${currentRide.id}:${step}`;
    if (paymentGateCheckedRef.current === gateKey) return;
    paymentGateCheckedRef.current = gateKey;
    let cancelled = false;
    (async () => {
      const {
        data: payment,
        error
      } = await supabase.from('payments').select('status').eq('ride_id', currentRide.id).maybeSingle();
      if (cancelled) return;

      // If we can't read the payment row yet, treat it as not paid and force payment UI.
      const status = payment?.status;
      const isPaid = status === 'succeeded';
      if (!isPaid) {
        console.log('[RideBooking] Payment gate triggered', {
          rideId: currentRide.id,
          status,
          error
        });
        setStep('payment');
        toast({
          title: 'Payment required',
          description: 'Please complete payment to find a driver.'
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentRide?.id, step, fareEstimate, toast, isTestAccount]);

  // Fallback polling: poll every 5s for ANY active ride status (not just searching)
  useEffect(() => {
    if (!currentRide?.id) return;
    const activeStatuses = ['searching', 'driver_assigned', 'driver_en_route', 'arrived', 'in_progress'];
    if (!activeStatuses.includes(currentRide.status)) return;
    const pollInterval = setInterval(async () => {
      console.log('[RideBooking] Polling ride status...');
      const {
        data,
        error
      } = await supabase.from('rides').select('*').eq('id', currentRide.id).single();
      if (error) {
        console.error('[RideBooking] Poll error:', error);
        return;
      }
      if (data && data.status !== currentRide.status) {
        console.log('[RideBooking] Poll detected status change:', data.status);
        setCurrentRide(data);
        updateRide(data);
        switch (data.status) {
          case 'driver_assigned':
            setStep('matched');
            fetchDriverInfo(data.driver_id);
            toast({ title: t('booking.found'), description: 'Your driver is on the way!' });
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
            clearRide();
            if (dropoff && user?.id) saveDropoffDestination(dropoff);
            break;
          case 'cancelled':
            toast({ title: t('booking.cancelled'), variant: 'destructive' });
            clearRide();
            resetBooking();
            break;
        }
      }
    }, 5000);
    return () => clearInterval(pollInterval);
  }, [currentRide?.id, currentRide?.status, t, toast]);

  // Fetch driver info when ride completes but driverInfo is missing
  useEffect(() => {
    if (step === 'completed' && currentRide?.driver_id && !driverInfo) {
      console.log('[RideBooking] Fetching missing driverInfo for completion screen');
      fetchDriverInfo(currentRide.driver_id);
    }
  }, [step, currentRide?.driver_id, driverInfo]);

  // Subscribe to driver location updates
  useEffect(() => {
    if (!currentRide?.driver_id) {
      setDriverLocation(null);
      return;
    }

    // Fetch initial driver location
    const fetchDriverLocation = async () => {
      const {
        data
      } = await supabase.from('driver_profiles').select('current_lat, current_lng').eq('user_id', currentRide.driver_id).single();
      if (data?.current_lat && data?.current_lng) {
        setDriverLocation({
          lat: data.current_lat,
          lng: data.current_lng
        });
      }
    };
    fetchDriverLocation();

    // Subscribe to real-time location updates
    const channel = supabase.channel(`driver-location-${currentRide.driver_id}`).on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'driver_profiles',
      filter: `user_id=eq.${currentRide.driver_id}`
    }, payload => {
      const updated = payload.new as {
        current_lat: number | null;
        current_lng: number | null;
      };
      if (updated.current_lat && updated.current_lng) {
        setDriverLocation({
          lat: updated.current_lat,
          lng: updated.current_lng
        });
      }
    }).subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentRide?.driver_id]);

  // Track rider's live location during active ride phases
  useEffect(() => {
    const shouldTrackRider = step === 'matched' || step === 'arriving' || step === 'arrived' || step === 'inProgress';
    if (!shouldTrackRider || !('geolocation' in navigator)) {
      // Clear tracking if not needed
      if (riderLocationWatchId.current !== null) {
        navigator.geolocation.clearWatch(riderLocationWatchId.current);
        riderLocationWatchId.current = null;
      }
      // Don't clear riderLiveLocation - keep last known position
      return;
    }

    // If we already have a watch, don't create another
    if (riderLocationWatchId.current !== null) return;

    // First, try to get an immediate position reading
    navigator.geolocation.getCurrentPosition(position => {
      setRiderLiveLocation({
        lat: position.coords.latitude,
        lng: position.coords.longitude
      });
    }, () => {
      // Fallback to pickup location if geolocation fails
      if (pickup) {
        setRiderLiveLocation({
          lat: pickup.lat,
          lng: pickup.lng
        });
      }
    }, {
      enableHighAccuracy: false,
      timeout: 5000,
      maximumAge: 60000
    });

    // Start watching rider's position with more lenient settings
    riderLocationWatchId.current = navigator.geolocation.watchPosition(position => {
      setRiderLiveLocation({
        lat: position.coords.latitude,
        lng: position.coords.longitude
      });
    }, error => {
      console.log('[RideBooking] Rider location watch error:', error.message);
      // On error, fallback to pickup location if no location yet
      if (!riderLiveLocation && pickup) {
        setRiderLiveLocation({
          lat: pickup.lat,
          lng: pickup.lng
        });
      }
    }, {
      enableHighAccuracy: false,
      timeout: 30000,
      maximumAge: 30000
    });
    return () => {
      if (riderLocationWatchId.current !== null) {
        navigator.geolocation.clearWatch(riderLocationWatchId.current);
        riderLocationWatchId.current = null;
      }
    };
  }, [step, pickup]);
  const fetchDriverInfo = async (driverId: string) => {
    console.log('[RideBooking] Fetching driver info for:', driverId);
    const [profileResult, driverProfileResult] = await Promise.all([supabase.from('profiles').select('first_name, last_name, phone_number, avatar_url').eq('user_id', driverId).maybeSingle(), supabase.from('driver_profiles').select('vehicle_make, vehicle_model, vehicle_color, license_plate, average_rating').eq('user_id', driverId).maybeSingle()]);
    const {
      data: profile,
      error: profileError
    } = profileResult;
    const {
      data: driverProfile,
      error: driverProfileError
    } = driverProfileResult;
    if (profileError) console.error('[RideBooking] Error fetching driver profile:', profileError);
    if (driverProfileError) console.error('[RideBooking] Error fetching driver vehicle info:', driverProfileError);

    // Always set something so the in-ride UI can render (never blank screen)
    setDriverInfo({
      first_name: profile?.first_name || (language === 'fr' ? 'Chauffeur' : 'Driver'),
      last_name: profile?.last_name || '',
      phone_number: profile?.phone_number || null,
      avatar_url: profile?.avatar_url || null,
      vehicle_make: driverProfile?.vehicle_make || '',
      vehicle_model: driverProfile?.vehicle_model || '',
      vehicle_color: driverProfile?.vehicle_color || '',
      license_plate: driverProfile?.license_plate || '—',
      average_rating: Number(driverProfile?.average_rating ?? 5)
    });
  };

  // Save dropoff destination for frequent places suggestions
  const saveDropoffDestination = async (destination: Location) => {
    if (!user?.id) return;
    try {
      // Extract name from address (first part before comma)
      const parts = destination.address.split(',');
      const name = parts[0]?.trim() || destination.address;
      const address = parts.slice(1).join(',').trim() || destination.address;

      // Check if destination already exists
      const {
        data: existing
      } = await supabase.from('rider_destinations').select('id, visit_count').eq('user_id', user.id).eq('lat', destination.lat).eq('lng', destination.lng).maybeSingle();
      if (existing) {
        // Update visit count
        await supabase.from('rider_destinations').update({
          visit_count: existing.visit_count + 1,
          last_visited_at: new Date().toISOString(),
          name,
          address
        }).eq('id', existing.id);
      } else {
        // Insert new destination
        await supabase.from('rider_destinations').insert({
          user_id: user.id,
          name,
          address,
          lat: destination.lat,
          lng: destination.lng,
          visit_count: 1,
          last_visited_at: new Date().toISOString()
        });
      }
      console.log('[RideBooking] Saved dropoff destination for future suggestions');
    } catch (err) {
      console.error('[RideBooking] Error saving dropoff destination:', err);
    }
  };
  useEffect(() => {
    if (step === 'searching' && currentRide && pickup && dropoff && fareEstimate) {
      startEscalation();
    } else {
      stopEscalation();
    }
  }, [step, currentRide?.id]);
  const handlePickupChange = (address: string, location?: {
    lat: number;
    lng: number;
  }) => {
    setPickupAddress(address);
    if (location) {
      setPickup({
        address,
        ...location
      });
      // Force-save to localStorage on every manual pickup change
      try {
        localStorage.setItem(PICKUP_CACHE_KEY, JSON.stringify({ lat: location.lat, lng: location.lng, addressLabel: address, ts: Date.now() }));
        localStorage.setItem('last_pickup_address', address);
      } catch {}
    }
  };
  const handleDropoffChange = (address: string, location?: {
    lat: number;
    lng: number;
  }) => {
    setDropoffAddress(address);
    if (location) {
      setDropoff({
        address,
        ...location
      });
      // Auto-navigate to estimate when destination is selected with coordinates
      // (will be handled by the effect below)
    }
  };

  // (auto-estimate effect moved below calculateRoute declaration)
  const useCurrentLocation = () => {
    if (!navigator.geolocation) return;
    setPickupAddress(language === 'fr' ? 'Détection en cours...' : 'Getting your location...');
    setGpsResolved(false);
    let resolved = false;
    let attempt = 0;

    const onGot = async (position: GeolocationPosition) => {
      if (resolved) return;
      resolved = true;
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      setPickup({ address: language === 'fr' ? 'Position actuelle' : 'Current Location', lat, lng });
      pendingGpsCoords.current = { lat, lng };
      if (mapboxToken) {
        const address = await reverseGeocode(lat, lng);
        if (address) {
          setPickupAddress(address);
          setPickup({ address, lat, lng });
          setGpsResolved(true);
          try {
            localStorage.setItem(PICKUP_CACHE_KEY, JSON.stringify({ lat, lng, addressLabel: address, ts: Date.now() }));
            localStorage.setItem('last_pickup_address', address);
          } catch {}
        }
      }
    };

    const tryGet = () => {
      attempt++;
      const highAccuracy = attempt <= 2;
      navigator.geolocation.getCurrentPosition(onGot, (err) => {
        console.warn(`[RideBooking] useCurrentLocation attempt ${attempt} failed:`, err.message);
        if (!resolved && attempt < 3) {
          setTimeout(tryGet, 1000);
        } else if (!resolved) {
          // Last resort: try low accuracy with long timeout
          navigator.geolocation.getCurrentPosition(onGot, () => {
            if (!resolved) {
              toast({
                title: language === 'fr' ? 'Erreur de localisation' : 'Location error',
                description: language === 'fr' ? 'Impossible de détecter votre position. Veuillez entrer votre adresse manuellement.' : 'Unable to detect your location. Please enter your address manually.',
                variant: 'destructive'
              });
            }
          }, { enableHighAccuracy: false, timeout: 20000, maximumAge: 60000 });
        }
      }, { enableHighAccuracy: highAccuracy, timeout: highAccuracy ? 8000 : 15000, maximumAge: 0 });
    };

    tryGet();
  };
  const calculateRoute = useCallback(async () => {
    if (!dropoff) return;
    // Use pickup coords if available; if pickup has no real coords (lat=0), skip Mapbox and use fallback math
    const pickupToUse = pickup && pickup.lat !== 0 && pickup.lng !== 0 ? pickup : null;
    try {
      let estimatedDistance = 0;
      let estimatedDuration = 0;
      if (pickupToUse && mapboxToken) {
        const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${pickupToUse.lng},${pickupToUse.lat};${dropoff.lng},${dropoff.lat}?overview=false&alternatives=false&access_token=${mapboxToken}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        try {
          const res = await fetch(url, { signal: controller.signal });
          clearTimeout(timeout);
          const data = await res.json();
          const route = data?.routes?.[0];
          if (route?.distance && route?.duration) {
            estimatedDistance = route.distance / 1000;
            estimatedDuration = route.duration / 60;
          } else {
            throw new Error('No route returned');
          }
        } catch {
          clearTimeout(timeout);
          // Fallback to straight-line
          if (pickupToUse) {
            const R = 6371;
            const dLat = (dropoff.lat - pickupToUse.lat) * Math.PI / 180;
            const dLon = (dropoff.lng - pickupToUse.lng) * Math.PI / 180;
            const a = Math.sin(dLat / 2) ** 2 + Math.cos(pickupToUse.lat * Math.PI / 180) * Math.cos(dropoff.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
            estimatedDistance = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 1.4;
            estimatedDuration = estimatedDistance / 30 * 60;
          }
        }
      } else if (pickupToUse) {
        // No token — rough fallback
        const R = 6371;
        const dLat = (dropoff.lat - pickupToUse.lat) * Math.PI / 180;
        const dLon = (dropoff.lng - pickupToUse.lng) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(pickupToUse.lat * Math.PI / 180) * Math.cos(dropoff.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
        estimatedDistance = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 1.4;
        estimatedDuration = estimatedDistance / 30 * 60;
      } else {
        // No pickup coords at all — use a default 5km estimate so the user isn't stuck
        estimatedDistance = 5;
        estimatedDuration = 12;
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
        variant: 'destructive'
      });
    }
  }, [pickup, dropoff, toast, mapboxToken]);

  // Auto-calculate route when both pickup and dropoff have coordinates
  const hasTriggeredAutoEstimate = useRef(false);
  useEffect(() => {
    if (!dropoff) {
      hasTriggeredAutoEstimate.current = false;
      return;
    }
    if (step !== 'input') return;
    if (hasTriggeredAutoEstimate.current) return;
    hasTriggeredAutoEstimate.current = true;
    calculateRoute();
  }, [pickup, dropoff, step, calculateRoute]);

  const handleGetEstimate = async () => {
    if (!pickup || !dropoff) {
      toast({
        title: 'Missing locations',
        description: 'Please select both pickup and destination from the suggestions.',
        variant: 'destructive'
      });
      return;
    }
    await calculateRoute();
  };
  const handleProceedToPayment = async () => {
    if (!user || !pickup || !dropoff || !fareEstimate) return;

    // Test accounts skip payment entirely (unlimited or with remaining free rides)
    const isUnlimited = user.email && TEST_ACCOUNTS.includes(user.email.toLowerCase());
    const freeRidesLeft = user.email ? getRemainingFreeRides(user.email) : 0;
    const skipPayment = isUnlimited || freeRidesLeft > 0;

    // Show payment UI immediately (no perceived delay) — unless test account
    if (!skipPayment) {
      setStep('payment');
    }
    setIsSubmitting(true);

    // Create the ride in the background as fast as possible.
    // This avoids edge-function overhead so the PaymentForm gets a rideId sooner.
    (async () => {
      try {
        const {
          data: {
            session
          }
        } = await supabase.auth.getSession();
        if (!session) {
          toast({
            title: 'Session expired',
            description: 'Please sign in again to continue.',
            variant: 'destructive'
          });
          setStep('estimate');
          navigate('/login');
          return;
        }

        // Test accounts create ride directly with 'searching' status
        const rideStatus = skipPayment ? 'searching' : 'pending_payment';
        const {
          data: ride,
          error: rideErr
        } = await supabase.from('rides').insert({
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
          promo_discount: fareEstimate.promoDiscount,
          subtotal_before_tax: fareEstimate.subtotalBeforeTax,
          gst_amount: fareEstimate.gstAmount,
          qst_amount: fareEstimate.qstAmount,
          platform_fee: fareEstimate.platformFee,
          status: rideStatus
        }).select('*').single();
        if (rideErr || !ride?.id) {
          console.error('Ride insert error:', rideErr);
          throw new Error(rideErr?.message || 'Ride creation failed');
        }

        // Optional rider notification (non-blocking)
        void supabase.from('notifications').insert({
          user_id: user.id,
          ride_id: ride.id,
          type: 'ride_booked',
          title: skipPayment ? 'Test ride created' : 'Payment required',
          message: skipPayment ? 'Looking for a driver...' : 'Complete payment to find a driver.'
        });
        setCurrentRide(ride);
        updateRide(ride);

        // Test accounts go directly to searching (escalation hook will handle notifications)
        if (skipPayment) {
          // Increment free rides counter for limited test accounts
          if (!isUnlimited && freeRidesLeft > 0 && user.email) {
            incrementFreeRidesUsed(user.email);
          }
          setStep('searching');
          const remainingAfter = user.email ? getRemainingFreeRides(user.email) : 0;
          toast({
            title: 'Test mode',
            description: isUnlimited ? 'Payment bypassed. Starting driver search...' : `Free ride used! ${remainingAfter} free ride${remainingAfter !== 1 ? 's' : ''} remaining.`
          });
        }
      } catch (err: any) {
        console.error('Error creating ride:', err);
        toast({
          title: 'Error booking ride',
          description: err.message,
          variant: 'destructive'
        });
        setStep('estimate');
      } finally {
        setIsSubmitting(false);
      }
    })();
  };
  const handlePaymentSuccess = async () => {
    // Payment succeeded – transition ride status to searching so drivers can see it
    if (currentRide?.id) {
      try {
        await supabase.from('rides').update({
          status: 'searching'
        }).eq('id', currentRide.id).eq('status', 'pending_payment');

        // Escalation hook will automatically start notifying drivers when step changes to 'searching'
      } catch (e) {
        console.error('Failed to update ride status to searching', e);
      }
    }
    setStep('searching');
    toast({
      title: t('booking.searching'),
      description: 'Payment confirmed! Finding nearby drivers...'
    });
  };
  const handlePaymentCancel = async () => {
    // Cancel the ride if payment is cancelled
    if (currentRide) {
      const {
        error
      } = await supabase.from('rides').update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancelled_by: user?.id,
        cancellation_reason: 'Payment cancelled'
      }).eq('id', currentRide.id);
      if (error) {
        toast({
          title: 'Cancel failed',
          description: error.message,
          variant: 'destructive'
        });
      }
    }
    setCurrentRide(null);
    clearRide();
    setStep('estimate');
  };
  const handleCancelRide = async () => {
    if (!currentRide) return;

    // Optimistic UI update first — makes cancel feel instant
    const rideId = currentRide.id;
    resetBooking();
    toast({
      title: 'Cancelling ride…'
    });
    try {
      const {
        error
      } = await supabase.from('rides').update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancelled_by: user?.id,
        cancellation_reason: 'Cancelled by rider'
      }).eq('id', rideId);
      if (error) throw error;
      toast({
        title: 'Ride cancelled'
      });
    } catch (error: any) {
      console.error('Cancel ride error:', error);
      toast({
        title: 'Cancel may have failed',
        description: error.message,
        variant: 'destructive'
      });
    }
  };
  const resetBooking = () => {
    setStep('input');
    // Re-initialize pickup from cache so we never show empty/fallback
    let cachedPickup: Location | null = null;
    let cachedAddr = '';
    try {
      const cached = localStorage.getItem('drivveme_last_pickup');
      if (cached) {
        const { lat, lng, addressLabel } = JSON.parse(cached);
        if (lat && lng && addressLabel) {
          cachedPickup = { address: addressLabel, lat, lng };
          cachedAddr = addressLabel;
        }
      }
    } catch {}
    if (!cachedAddr) {
      try {
        cachedAddr = localStorage.getItem('last_pickup_address') || '';
      } catch {}
    }
    setPickup(cachedPickup);
    setPickupAddress(cachedAddr);
    setDropoff(null);
    setDropoffAddress('');
    setFareEstimate(null);
    setCurrentRide(null);
    setDriverInfo(null);
    setDriverLocation(null);
    clearRide(); // Clear from localStorage
    hasRestoredRide.current = false;
    // Allow GPS to re-detect on next cycle
    hasAutoDetectedLocation.current = false;
  };

  // isActiveRidePhase already declared above for realtime tracking
  // Use ride notifications hook (must be before any returns)
  useRideNotifications({
    phase: isActiveRidePhase ? step as 'matched' | 'arriving' | 'arrived' | 'inProgress' : 'matched',
    driverName: driverInfo?.first_name || 'Driver',
    minutesAway,
    language
  });

  // Calculate minutes away from target
  useEffect(() => {
    if (!driverLocation || !mapboxToken) {
      setMinutesAway(null);
      return;
    }
    const targetLocation = step === 'inProgress' ? dropoff : pickup;
    if (!targetLocation) return;
    const controller = new AbortController();
    const fetchETA = async () => {
      try {
        const response = await fetch(`https://api.mapbox.com/directions/v5/mapbox/driving/${driverLocation.lng},${driverLocation.lat};${targetLocation.lng},${targetLocation.lat}?access_token=${mapboxToken}`, {
          signal: controller.signal
        });
        const data = await response.json();
        if (data.routes?.[0]) {
          setMinutesAway(Math.round(data.routes[0].duration / 60));
        }
      } catch (err) {
        if ((err as any)?.name !== 'AbortError') {
          console.error('ETA fetch error:', err);
        }
      }
    };
    fetchETA();
    return () => controller.abort();
  }, [driverLocation?.lat, driverLocation?.lng, step, pickup, dropoff, mapboxToken]);

  // Avoid blocking the whole page during background token refreshes.
  // Show loading while redirecting to prevent black screen flash
  if (isRedirecting || (authLoading && roles.length === 0)) {
    return <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">{t('common.loading')}</div>
      </div>;
  }

  // Share trip handler
  const handleShareTrip = async () => {
    if (!currentRide || !driverInfo) return;
    const shareData = {
      title: language === 'fr' ? 'Mon trajet Drivvme' : 'My Drivvme Trip',
      text: language === 'fr' ? `Je suis en route avec ${driverInfo.first_name}. Véhicule: ${driverInfo.vehicle_color} ${driverInfo.vehicle_make} ${driverInfo.vehicle_model}, Plaque: ${driverInfo.license_plate}` : `I'm on my way with ${driverInfo.first_name}. Vehicle: ${driverInfo.vehicle_color} ${driverInfo.vehicle_make} ${driverInfo.vehicle_model}, Plate: ${driverInfo.license_plate}`,
      url: window.location.href
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch (err) {
        console.log('Share cancelled');
      }
    } else {
      await navigator.clipboard.writeText(shareData.text);
      toast({
        title: language === 'fr' ? 'Copié!' : 'Copied!',
        description: language === 'fr' ? 'Infos du trajet copiées' : 'Trip info copied to clipboard'
      });
    }
  };
  // Check if debug mode is enabled
  const showDebug = typeof window !== 'undefined' && (() => {
    try {
      return localStorage.getItem('DEBUG_RIDE') === '1';
    } catch {
      return false;
    }
  })();

  // FULLSCREEN ACTIVE RIDE EXPERIENCE
  // Never block rendering on driverInfo (RLS/network delays can otherwise cause a blank screen)
  if (isActiveRidePhase) {
    return <div className="h-screen w-screen relative overflow-hidden">
        {/* Fullscreen Map */}
        <MapComponent pickup={pickup} dropoff={dropoff} driverLocation={effectiveDriverLocation} riderLocation={riderLiveLocation} routeMode={step === 'arriving' || step === 'arrived' ? 'driver-to-pickup' : step === 'inProgress' ? 'driver-to-dropoff' : 'pickup-dropoff'} followDriver={step === 'arriving' || step === 'arrived' || step === 'inProgress'} />

        {/* Debug Bar Overlay - ONLY visible if localStorage.DEBUG_RIDE === "1" */}
        {showDebug && <Suspense fallback={null}>
            <div className="absolute top-4 left-4 right-4 z-20 max-w-md">
              <RideDebugBar rideId={currentRide?.id ?? null} rideStatus={currentRide?.status ?? null} driverLocation={realtimeDriverLocation ? {
            lat: realtimeDriverLocation.lat,
            lng: realtimeDriverLocation.lng,
            speed: realtimeDriverLocation.speed,
            accuracy: realtimeDriverLocation.accuracy,
            heading: realtimeDriverLocation.heading,
            updatedAt: realtimeDriverLocation.updatedAt
          } : null} lastUpdateSeconds={lastUpdateSeconds} dataSource={dataSource} isConnected={!!realtimeDriverLocation} hasError={hasNoUpdatesError} />
              
              {/* Location History Table */}
              <div className="mt-2">
                <RideLocationHistory rideId={currentRide?.id ?? null} enabled={isActiveRidePhase} />
              </div>
            </div>
          </Suspense>}

        {/* Connecting to driver message - shown when no updates for 10+ seconds */}
        {hasNoUpdatesError && !showDebug && <div className="absolute top-4 left-4 right-4 z-20">
            <div className="bg-muted/90 backdrop-blur-sm rounded-lg px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                <span className="text-sm text-muted-foreground">
                  {isReconnecting ? language === 'fr' ? 'Reconnexion…' : 'Reconnecting…' : language === 'fr' ? 'Connexion à la position du chauffeur…' : 'Connecting to driver location…'}
                </span>
              </div>
              {/* Manual retry button */}
              <button onClick={resubscribe} className="text-xs text-primary hover:underline">
                {language === 'fr' ? 'Réessayer' : 'Retry'}
              </button>
            </div>
          </div>}

        {/* Status Bar Overlay */}
        <InRideStatusBar phase={step as 'matched' | 'arriving' | 'arrived' | 'inProgress'} driverLocation={effectiveDriverLocation} pickupLocation={pickup} dropoffLocation={dropoff} lastUpdateSeconds={lastUpdateSeconds} />

        {/* Driver Card at Bottom */}
        {driverInfo ? <InRideDriverCard driverInfo={driverInfo} driverId={currentRide?.driver_id || ''} pickupAddress={pickup?.address || currentRide?.pickup_address || ''} dropoffAddress={dropoff?.address || currentRide?.dropoff_address || ''} estimatedFare={fareEstimate?.total || currentRide?.estimated_fare || 0} distanceKm={distanceKm || currentRide?.distance_km || 0} durationMinutes={durationMinutes || currentRide?.estimated_duration_minutes || 0} rideId={currentRide?.id || ''} rideStatus={currentRide?.status || ''} phase={step as 'matched' | 'arriving' | 'arrived' | 'inProgress'} minutesAway={minutesAway} onShareTrip={handleShareTrip} onSafetyPress={() => setSafetySheetOpen(true)} onCancelRide={handleCancelRide} /> : <div className="absolute bottom-0 left-0 right-0 z-10">
            <Card className="rounded-t-3xl rounded-b-none border-b-0 shadow-2xl p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">
                    {language === 'fr' ? 'Chargement des détails...' : 'Loading trip details...'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {language === 'fr' ? 'La carte et le trajet sont en direct — les infos du chauffeur arrivent.' : 'Map is live — driver details will appear shortly.'}
                  </p>
                </div>
                <div className="h-5 w-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              </div>
            </Card>
          </div>}

        {/* Safety Sheet */}
        <SafetySheet open={safetySheetOpen} onOpenChange={setSafetySheetOpen} rideId={currentRide?.id || ''} driverName={driverInfo?.first_name || (language === 'fr' ? 'Chauffeur' : 'Driver')} vehicleInfo={driverInfo ? `${driverInfo.vehicle_color} ${driverInfo.vehicle_make} ${driverInfo.vehicle_model}` : ''} licensePlate={driverInfo?.license_plate || ''} onShareLocation={handleShareTrip} />

        {/* Cancel button is now inside InRideDriverCard trip details */}
      </div>;
  }


  // TRIP COMPLETION SCREEN
  if (step === 'completed' && currentRide) {
    const fallbackDriverInfo = driverInfo || { first_name: language === 'fr' ? 'Chauffeur' : 'Driver', avatar_url: null, vehicle_make: '', vehicle_model: '', vehicle_color: '', license_plate: '' };
    return <div className="min-h-screen bg-background">
        <Navbar />
        <div className="pt-20 pb-12 container mx-auto px-4 max-w-md">
          <TripCompletionScreen rideId={currentRide.id} driverId={currentRide.driver_id} riderId={user?.id || ''} driverInfo={fallbackDriverInfo} actualFare={currentRide.actual_fare || fareEstimate?.total || 0} estimatedFare={fareEstimate?.total || currentRide.estimated_fare || 0} savings={fareEstimate?.savings || 0} ride={currentRide} onComplete={resetBooking} />
        </div>
      </div>;
  }

  // DEFAULT BOOKING FLOW - MAP-FREE "WHERE TO?" SCREEN
  if (step === 'input') {
    const genericLabels = ['Detecting...', 'Détection...', 'Current location', 'Current Location', 'Position actuelle', ''];
    const hasRealAddress = pickupAddress && !genericLabels.includes(pickupAddress) && !pickupAddress.match(/^-?\d+\.\d+,\s*-?\d+\.\d+$/);
    const displayPickupAddress = hasRealAddress
      ? pickupAddress.split(',')[0]
      : (language === 'fr' ? 'Localisation en cours...' : 'Getting your location...');
    const isFallback = !hasRealAddress;

    return (
      <div className="min-h-[100dvh] bg-background flex flex-col">
        {/* ── Header Bar ── */}
        <div className="flex items-center justify-between px-5 pt-[env(safe-area-inset-top,12px)] pb-3" style={{ paddingTop: 'max(env(safe-area-inset-top, 12px), 12px)' }}>
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center logo-icon-pulse">
              <Car className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-display font-bold text-xl logo-flash">Drivveme</span>
          </div>

          {/* Menu */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onTouchEnd={(e) => { e.preventDefault(); navigate('/history'); }}
              onClick={() => navigate('/history')}
              className="p-2 rounded-lg hover:bg-muted transition-colors touch-manipulation"
              aria-label="Ride history"
            >
              <History className="h-5 w-5 text-muted-foreground" />
            </button>
            <button
              type="button"
              onTouchEnd={(e) => { e.preventDefault(); setHelpDialogOpen(true); }}
              onClick={() => setHelpDialogOpen(true)}
              className="p-2 rounded-lg hover:bg-muted transition-colors touch-manipulation relative"
              aria-label="Help"
            >
              <HelpCircle className="h-5 w-5 text-muted-foreground" />
              {unreadSupportMessages > 0 && <span className="absolute top-1 right-1 h-2.5 w-2.5 bg-destructive rounded-full animate-pulse" />}
            </button>
            <button
              type="button"
              onTouchEnd={(e) => { e.preventDefault(); signOut(); navigate('/'); }}
              onClick={() => { signOut(); navigate('/'); }}
              className="p-2 rounded-lg hover:bg-muted transition-colors touch-manipulation"
              aria-label="Log out"
            >
              <LogOut className="h-5 w-5 text-muted-foreground" />
            </button>
          </div>
          <HelpDialog open={helpDialogOpen} onOpenChange={setHelpDialogOpen} />
        </div>

        {/* ── Greeting ── */}
        <div className="px-5 pb-2">
          <GreetingHeader />
        </div>

        {/* ── Destination Search Bar ── */}
        <div className="px-5 pb-3">
          <div className="rounded-2xl border border-primary/40 bg-card/80 shadow-glow">
            <LocationInput
              type="dropoff"
              value={dropoffAddress}
              onChange={(addr, coords) => handleDropoffChange(addr, coords)}
              placeholder={language === 'fr' ? 'Où allez-vous ?' : 'Where to?'}
            />
          </div>
        </div>

        {/* ── Pickup Row with Edit ── */}
        <div className="px-5 pb-4">
          <button
            type="button"
            onTouchEnd={(e) => { e.preventDefault(); setShowFullInput(true); }}
            onClick={() => setShowFullInput(true)}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-secondary/60 border border-border hover:bg-secondary transition-colors touch-manipulation text-left"
            aria-label="Edit pickup location"
          >
            <div className="h-8 w-8 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0">
              <Navigation className="h-4 w-4 text-accent" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground">{language === 'fr' ? 'Départ' : 'Pickup'}</p>
              <div className="flex items-center gap-2">
                {isFallback && <div className="h-2 w-2 rounded-full bg-primary animate-pulse flex-shrink-0" />}
                <p className={`text-sm truncate transition-all duration-300 ${isFallback ? 'font-medium text-primary' : 'font-medium text-foreground animate-fade-in'}`}>{displayPickupAddress}</p>
              </div>
            </div>
            {/* Spinner removed — address or fallback always visible */}
            <span className="text-xs font-medium text-primary flex-shrink-0 px-2.5 py-1 rounded-full border border-primary/30">
              {language === 'fr' ? 'Éditer' : 'Edit'}
            </span>
          </button>
        </div>

        {/* ── Recent / Quick Destinations ── */}
        <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-4">
          {!dropoffAddress && (
            <>
              {/* Show prefetched destinations instantly while React Query loads */}
              {prefetchedDestinations.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-muted-foreground px-1">
                    {language === 'fr' ? 'Récents' : 'Recent'}
                  </h3>
                  {prefetchedDestinations.slice(0, 5).map((dest) => (
                    <button
                      key={dest.id}
                      type="button"
                      onClick={() => handleDropoffChange(dest.address || dest.name, { lat: dest.lat, lng: dest.lng })}
                      onTouchEnd={(e) => { e.preventDefault(); handleDropoffChange(dest.address || dest.name, { lat: dest.lat, lng: dest.lng }); }}
                      className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-secondary/60 transition-colors touch-manipulation text-left"
                    >
                      <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{dest.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{dest.address}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              <QuickDestinations onSelectDestination={(dest) => {
                handleDropoffChange(dest.address, { lat: dest.lat, lng: dest.lng });
              }} />
              {prefetchedDestinations.length === 0 && (
                <RecentDestinations onSelectDestination={(dest) => {
                  handleDropoffChange(dest.address, { lat: dest.lat, lng: dest.lng });
                }} />
              )}
            </>
          )}

          {/* Show calculating indicator when destination selected — with auto-retry timeout */}
          {dropoffAddress && !fareEstimate && step === 'input' && (
            <CalculatingRouteIndicator
              language={language}
              dropoff={dropoff}
              onRetry={calculateRoute}
            />
          )}

          {/* Manual pickup/destination buttons */}
          {!dropoffAddress && (
            <div className="flex gap-3">
              <button
                type="button"
                onTouchEnd={(e) => { e.preventDefault(); setShowFullInput(true); }}
                onClick={() => setShowFullInput(true)}
                className="flex-1 flex items-center gap-2 px-4 py-3 rounded-xl bg-secondary/40 border border-border hover:bg-secondary transition-colors touch-manipulation"
              >
                <MapPin className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium text-foreground">
                  {language === 'fr' ? 'Saisir manuellement' : 'Enter manually'}
                </span>
              </button>
            </div>
          )}
        </div>

        {/* ── Full Input Modal (editing pickup) ── */}
        <AnimatePresence>
          {showFullInput && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-background"
            >
              <div className="h-full flex flex-col">
                <div className="flex items-center gap-4 p-4 border-b border-border">
                  <Button variant="ghost" size="icon" onClick={() => setShowFullInput(false)}>
                    <X className="h-5 w-5" />
                  </Button>
                  <h2 className="font-semibold">
                    {language === 'fr' ? 'Modifier les lieux' : 'Edit Locations'}
                  </h2>
                </div>

                <div className="p-4 space-y-3">
                  <LocationInput type="pickup" value={pickupAddress} onChange={handlePickupChange} onUseCurrentLocation={useCurrentLocation} />
                  <LocationInput type="dropoff" value={dropoffAddress} onChange={handleDropoffChange} />
                </div>

                <div className="flex-1 overflow-y-auto p-4">
                  <RecentDestinations onSelectDestination={(dest) => {
                    handleDropoffChange(dest.address, { lat: dest.lat, lng: dest.lng });
                    setShowFullInput(false);
                  }} />
                </div>

                <div className="p-4 border-t border-border" style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 12px), 12px)' }}>
                  <Button
                    onClick={() => {
                      setShowFullInput(false);
                      if (pickup && dropoff) handleGetEstimate();
                    }}
                    className="w-full gradient-primary shadow-button py-6 text-lg"
                    disabled={!pickupAddress || !dropoffAddress}
                  >
                    {pickup && dropoff ? (language === 'fr' ? 'Obtenir un prix' : 'Get Estimate') : (language === 'fr' ? 'Confirmer' : 'Confirm')}
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // ESTIMATE, PAYMENT, SEARCHING STEPS (side panel layout)
  return <div className="min-h-screen bg-background">
      <Navbar />
      
      <div className="pt-16 h-screen flex flex-col lg:flex-row">
        {/* Map */}
        <div className="flex-1 relative">
          <MapComponent pickup={pickup} dropoff={dropoff} driverLocation={driverLocation} routeMode="pickup-dropoff" />
        </div>

        {/* Booking Panel */}
        <motion.div initial={{
        x: 100,
        opacity: 0
      }} animate={{
        x: 0,
        opacity: 1
      }} className="w-full lg:w-[420px] bg-card border-l border-border flex flex-col">
          <div className="p-6 flex-1 overflow-y-auto">
            <AnimatePresence mode="wait">

              {/* Estimate Step */}
              {step === 'estimate' && fareEstimate && <motion.div key="estimate" initial={{
              opacity: 0,
              y: 20
            }} animate={{
              opacity: 1,
              y: 0
            }} exit={{
              opacity: 0,
              y: -20
            }} className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="icon" onClick={() => {
                        setStep('input');
                        setDropoff(null);
                        setDropoffAddress('');
                        setFareEstimate(null);
                        hasTriggeredAutoEstimate.current = false;
                      }}>
                        <ArrowLeft className="h-5 w-5" />
                      </Button>
                      <h2 className="font-display text-2xl font-bold fare-header-glow">
                        {t('pricing.estimated')}
                      </h2>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => {
                      setStep('input');
                      setDropoff(null);
                      setDropoffAddress('');
                      setFareEstimate(null);
                      hasTriggeredAutoEstimate.current = false;
                    }} className="text-primary text-sm">
                      {language === 'fr' ? 'Modifier' : 'Modify'}
                    </Button>
                  </div>

                  {/* Route Summary */}
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <MapPin className="h-5 w-5 text-primary mt-0.5 animate-pulse" />
                      <div>
                        <p className="text-sm fare-label-glow">Pickup</p>
                        <p className="font-medium">{pickup?.address}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Navigation className="h-5 w-5 text-accent mt-0.5 animate-pulse" />
                      <div>
                        <p className="text-sm fare-label-glow">Destination</p>
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

                  {/* Price Comparison - PROMINENT UBER vs DRIVVEME */}
                  <Card className="p-6 gradient-card border-primary/20 overflow-hidden">
                    {/* Header */}
                    <div className="text-center mb-4">
                      <p className="text-sm text-muted-foreground">
                        {language === 'fr' ? 'Comparaison des prix' : 'Price Comparison'}
                      </p>
                    </div>

                    {/* Side-by-side Price Comparison */}
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      {/* Uber Price */}
                      <div className="relative p-4 bg-muted rounded-lg border border-border">
                        <div className="absolute top-2 right-2">
                          <span className="text-[10px] px-2 py-0.5 bg-muted-foreground/20 rounded-full text-muted-foreground font-medium">
                            Uber
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mb-1 mt-4">
                          {language === 'fr' ? 'Prix Uber actuel' : 'Current Uber Price'}
                        </p>
                        <p className="text-2xl font-bold text-foreground/70">
                          {formatCurrency(fareEstimate.uberTotal || fareEstimate.total / 0.925, language)}
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {language === 'fr' ? 'taxes incluses' : 'taxes included'}
                        </p>
                      </div>
                      
                      {/* Drivveme Price */}
                      <div className="relative p-4 bg-primary/10 rounded-lg border-2 border-primary">
                        <div className="absolute -top-2 -right-2">
                          <span className="text-xs px-2 py-1 bg-accent text-accent-foreground rounded-full font-bold animate-pulse shadow-lg">
                            -7.5%
                          </span>
                        </div>
                        <p className="text-xs mb-1 mt-4 font-medium drivveme-brand-glow">
                          {language === 'fr' ? 'Prix Drivveme' : 'Drivveme Price'}
                        </p>
                        <p className="font-display text-2xl font-bold text-primary price-flash-glow">
                          {formatCurrency(fareEstimate.total, language)}
                        </p>
                        <p className="text-[10px] text-primary/70 mt-1">
                          {language === 'fr' ? 'taxes incluses' : 'taxes included'}
                        </p>
                      </div>
                    </div>
                    
                    {/* Savings Banner */}
                    <div className="flex items-center justify-center gap-3 text-accent bg-accent/10 rounded-xl p-4 mb-4">
                      <TrendingDown className="h-6 w-6" />
                      <div className="text-center">
                        <span className="font-bold text-lg">
                          {language === 'fr' ? 'Tu économises' : 'You save'} {formatCurrency(fareEstimate.savings, language)}!
                        </span>
                        <p className="text-xs text-accent/80">
                          {language === 'fr' ? `${fareEstimate.savingsPercent}% moins cher qu'Uber` : `${fareEstimate.savingsPercent}% cheaper than Uber`}
                        </p>
                      </div>
                    </div>

                    {/* Fare Breakdown */}
                    <div className="space-y-2 text-sm border-t border-border/50 pt-4">
                      <div className="flex justify-between text-muted-foreground">
                        <span>{language === 'fr' ? 'Sous-total' : 'Subtotal'}</span>
                        <span>{formatCurrency(fareEstimate.subtotalBeforeTax, language)}</span>
                      </div>
                      <div className="flex justify-between text-muted-foreground">
                        <span>{language === 'fr' ? 'TPS (5%)' : 'GST (5%)'}</span>
                        <span>{formatCurrency(fareEstimate.gstAmount, language)}</span>
                      </div>
                      <div className="flex justify-between text-muted-foreground">
                        <span>{language === 'fr' ? 'TVQ (9.975%)' : 'QST (9.975%)'}</span>
                        <span>{formatCurrency(fareEstimate.qstAmount, language)}</span>
                      </div>
                      <div className="flex justify-between font-bold pt-2 border-t border-border/50">
                        <span>Total</span>
                        <span className="text-primary">{formatCurrency(fareEstimate.total, language)}</span>
                      </div>
                    </div>
                  </Card>

                  {/* Push Notification Prompt */}
                  {!pushSubscribed && <Card className="p-4 bg-primary/5 border-primary/20">
                      <div className="flex items-center gap-3">
                        <Bell className="h-5 w-5 text-primary" />
                        <div className="flex-1">
                          <p className="font-medium text-sm">Get notified when your driver arrives</p>
                          {!pushSupported ? <p className="text-xs text-muted-foreground">
                              Push notifications aren't available in this browser mode.
                            </p> : pushPermission === 'denied' ? <p className="text-xs text-muted-foreground">
                              Notifications are blocked in your browser settings.
                            </p> : <p className="text-xs text-muted-foreground">Enable notifications to stay updated</p>}
                        </div>

                        {!pushSupported ? <Button size="sm" variant="outline" onClick={() => setNotificationHelpOpen(true)}>
                            How to enable
                          </Button> : pushPermission === 'denied' ? <Button size="sm" variant="outline" onClick={() => {
                    refreshPushPermission();
                    setNotificationHelpOpen(true);
                  }}>
                            Fix settings
                          </Button> : <Button size="sm" variant="outline" onClick={async () => {
                    const ok = await subscribeToPush();
                    if (!ok) return;
                    toast({
                      title: 'Notifications enabled',
                      description: 'You\'ll be notified when your driver arrives.'
                    });
                  }} disabled={pushLoading}>
                            {pushLoading ? 'Enabling...' : 'Enable'}
                          </Button>}
                      </div>

                      <NotificationPermissionHelpDialog open={notificationHelpOpen} onOpenChange={setNotificationHelpOpen} />
                    </Card>}

                  <Button onClick={handleProceedToPayment} className="w-full gradient-primary shadow-button py-6 text-lg" disabled={isSubmitting}>
                    {isSubmitting ? <>
                        <motion.div animate={{
                    rotate: 360
                  }} transition={{
                    duration: 1,
                    repeat: Infinity,
                    ease: 'linear'
                  }} className="w-5 h-5 mr-2 rounded-full border-2 border-primary-foreground border-t-transparent" />
                        Preparing payment...
                      </> : <>
                        <CreditCard className="h-5 w-5 mr-2" />
                        {t('booking.confirm')} & Pay
                      </>}
                  </Button>
                </motion.div>}

              {/* Payment Step */}
              {step === 'payment' && fareEstimate && <motion.div key="payment" initial={{
              opacity: 0,
              y: 20
            }} animate={{
              opacity: 1,
              y: 0
            }} exit={{
              opacity: 0,
              y: -20
            }} className="space-y-6">
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

                  {currentRide?.id ? <PaymentForm rideId={currentRide.id} amount={fareEstimate.total} onSuccess={handlePaymentSuccess} onCancel={handlePaymentCancel} /> : <Card className="p-6 flex flex-col items-center justify-center space-y-4">
                      <motion.div animate={{
                  rotate: 360
                }} transition={{
                  duration: 1,
                  repeat: Infinity,
                  ease: 'linear'
                }} className="w-10 h-10 rounded-full border-4 border-primary border-t-transparent" />
                      <p className="text-muted-foreground text-center">
                        Preparing your payment...
                      </p>
                    </Card>}
                </motion.div>}

            {/* Searching Step */}
              {step === 'searching' && <motion.div key="searching" initial={{
              opacity: 0,
              y: 20
            }} animate={{
              opacity: 1,
              y: 0
            }} exit={{
              opacity: 0,
              y: -20
            }} className="space-y-6">
                  {/* Searching animation */}
                  <div className="flex flex-col items-center space-y-4 py-6">
                    <motion.div animate={{
                  rotate: 360
                }} transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: 'linear'
                }} className="w-16 h-16 rounded-full border-4 border-primary border-t-transparent" />
                    <h2 className="font-display text-xl font-bold text-center">
                      {t('booking.searching')}
                    </h2>
                    <p className="text-muted-foreground text-center text-sm">
                      {language === 'fr' ? 'Recherche de chauffeurs à proximité...' : 'Looking for nearby drivers...'}
                    </p>
                  </div>

                  {/* Trip details card */}
                  <Card className="p-4 space-y-4">
                    <h3 className="font-semibold text-sm text-muted-foreground">
                      {language === 'fr' ? 'Détails du trajet' : 'Trip Details'}
                    </h3>
                    
                    {/* Route */}
                    <div className="space-y-3">
                      <div className="flex items-start gap-3">
                        <div className="mt-1.5">
                          <div className="w-3 h-3 rounded-full bg-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-muted-foreground">
                            {language === 'fr' ? 'Départ' : 'Pickup'}
                          </p>
                          <p className="text-sm font-medium truncate">{pickup?.address || currentRide?.pickup_address}</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="mt-1.5">
                          <div className="w-3 h-3 rounded-full bg-accent" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-muted-foreground">
                            {language === 'fr' ? 'Destination' : 'Destination'}
                          </p>
                          <p className="text-sm font-medium truncate">{dropoff?.address || currentRide?.dropoff_address}</p>
                        </div>
                      </div>
                    </div>

                    {/* Trip stats */}
                    <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border">
                      <div className="text-center">
                        <p className="font-bold text-lg text-primary">
                          {formatCurrency(fareEstimate?.total || currentRide?.estimated_fare || 0, language)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {language === 'fr' ? 'Tarif' : 'Fare'}
                        </p>
                      </div>
                      <div className="text-center">
                        <p className="font-bold text-lg">
                          {formatDistance(distanceKm || currentRide?.distance_km || 0, language)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {language === 'fr' ? 'Distance' : 'Distance'}
                        </p>
                      </div>
                      <div className="text-center">
                        <p className="font-bold text-lg">
                          {formatDuration(durationMinutes || currentRide?.estimated_duration_minutes || 0, language)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {language === 'fr' ? 'Durée' : 'Duration'}
                        </p>
                      </div>
                    </div>
                  </Card>

                  <Button variant="outline" onClick={handleCancelRide} className="w-full text-destructive border-destructive/50 hover:bg-destructive/10">
                    {t('common.cancel')} {language === 'fr' ? 'la course' : 'Ride'}
                  </Button>
                </motion.div>}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
    </div>;
};
export default RideBooking;