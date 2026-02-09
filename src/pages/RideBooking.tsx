import React, { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, Navigation, Clock, TrendingDown, Car, X, CreditCard, Bell, History, ChevronDown, LogOut, HelpCircle } from 'lucide-react';
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
import { useMapboxToken } from '@/hooks/useMapboxToken';
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
  const [isDetectingLocation, setIsDetectingLocation] = useState(true);
  const [showFullInput, setShowFullInput] = useState(false);
  const [helpDialogOpen, setHelpDialogOpen] = useState(false);
  const {
    unreadCount: unreadSupportMessages
  } = useUnreadSupportMessages();

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

  // Auto-detect GPS location on mount and set as default pickup
  useEffect(() => {
    if (hasAutoDetectedLocation.current) return;
    if (!navigator.geolocation) {
      setIsDetectingLocation(false);
      return;
    }
    hasAutoDetectedLocation.current = true;
    let retryCount = 0;
    const maxRetries = 3;
    const attemptReverseGeocode = async (lat: number, lng: number) => {
      const address = await reverseGeocode(lat, lng);
      if (address) {
        setPickupAddress(address);
        setPickup({
          address,
          lat,
          lng
        });
        setIsDetectingLocation(false);
        return;
      }

      // Retry if geocoding failed and we have retries left
      if (retryCount < maxRetries && mapboxToken) {
        retryCount++;
        console.log(`[RideBooking] Reverse geocode retry ${retryCount}/${maxRetries}`);
        setTimeout(() => attemptReverseGeocode(lat, lng), 1000);
        return;
      }

      // Final fallback: use coordinates as readable address
      const coordAddress = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      setPickupAddress(coordAddress);
      setPickup({
        address: coordAddress,
        lat,
        lng
      });
      setIsDetectingLocation(false);
    };
    navigator.geolocation.getCurrentPosition(async position => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;

      // Always store coords immediately so pickup is never null
      const tempAddress = language === 'fr' ? 'Détection...' : 'Detecting...';
      setPickup({
        address: tempAddress,
        lat,
        lng
      });
      setPickupAddress(tempAddress);

      // Wait for mapboxToken if not available yet - effect below will resolve
      if (!mapboxToken) return;
      await attemptReverseGeocode(lat, lng);
    }, error => {
      console.log('[RideBooking] GPS auto-detect failed:', error.message);
      setIsDetectingLocation(false);
    }, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 60000
    });

    // Safety timeout: never show detecting overlay for more than 6 seconds
    const safetyTimer = setTimeout(() => {
      setIsDetectingLocation(false);
    }, 6000);
    return () => clearTimeout(safetyTimer);
  }, [mapboxToken, language, reverseGeocode]);

  // Effect to resolve address when pickup has coords but generic address
  useEffect(() => {
    if (!pickup || !mapboxToken) return;
    const genericLabels = ['Detecting...', 'Détection...', 'Current location', 'Position actuelle'];
    const isGeneric = genericLabels.includes(pickupAddress) || pickupAddress.match(/^-?\d+\.\d+,\s*-?\d+\.\d+$/);
    if (isGeneric) {
      reverseGeocode(pickup.lat, pickup.lng).then(address => {
        if (address) {
          setPickupAddress(address);
          setPickup(prev => prev ? {
            ...prev,
            address
          } : null);
          setIsDetectingLocation(false);
        }
      });
    }
  }, [pickup, pickupAddress, mapboxToken, reverseGeocode]);

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

  // Fallback polling: if realtime misses updates, poll every 5 seconds
  useEffect(() => {
    if (!currentRide?.id) return;
    // Only poll when in 'searching' status
    if (currentRide.status !== 'searching') return;
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
        if (data.status === 'driver_assigned') {
          setStep('matched');
          fetchDriverInfo(data.driver_id);
          toast({
            title: t('booking.found'),
            description: 'Your driver is on the way!'
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
    }
  };
  const useCurrentLocation = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(position => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      const fallbackAddress = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      setPickupAddress(fallbackAddress);
      setPickup({
        address: fallbackAddress,
        lat,
        lng
      });
    }, () => {
      toast({
        title: 'Location error',
        description: 'Unable to get your current location',
        variant: 'destructive'
      });
    });
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
        const dLat = (dropoff.lat - pickup.lat) * Math.PI / 180;
        const dLon = (dropoff.lng - pickup.lng) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(pickup.lat * Math.PI / 180) * Math.cos(dropoff.lat * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const straightLineDistance = R * c;
        estimatedDistance = straightLineDistance * 1.4;
        estimatedDuration = estimatedDistance / 30 * 60;
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
    setPickup(null);
    setDropoff(null);
    setPickupAddress('');
    setDropoffAddress('');
    setFareEstimate(null);
    setCurrentRide(null);
    setDriverInfo(null);
    setDriverLocation(null);
    clearRide(); // Clear from localStorage
    hasRestoredRide.current = false;
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
  if (step === 'completed' && currentRide && driverInfo) {
    return <div className="min-h-screen bg-background">
        <Navbar />
        <div className="pt-20 pb-12 container mx-auto px-4 max-w-md">
          <TripCompletionScreen rideId={currentRide.id} driverId={currentRide.driver_id} riderId={user?.id || ''} driverInfo={driverInfo} actualFare={currentRide.actual_fare || fareEstimate?.total || 0} estimatedFare={fareEstimate?.total || currentRide.estimated_fare || 0} savings={fareEstimate?.savings || 0} ride={currentRide} onComplete={resetBooking} />
        </div>
      </div>;
  }

  // DEFAULT BOOKING FLOW - MAP-CENTRIC DESIGN
  if (step === 'input') {
    // Extract short address for display - always show real address, never generic label
    const displayPickupAddress = pickupAddress && !['Detecting...', 'Détection...', 'Current location', 'Position actuelle'].includes(pickupAddress) ? pickupAddress.split(',')[0] : isDetectingLocation ? language === 'fr' ? 'Détection...' : 'Detecting...' : pickupAddress?.split(',')[0] || '';
    return <div className="min-h-screen bg-background relative overflow-hidden">
        {/* Full-page background image */}
        <div className="absolute inset-0 z-0" style={{
        backgroundImage: `url(${rideBg})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center center'
      }} />
        {/* Gradient overlay for better contrast */}
        <div className="absolute inset-0 z-0" style={{
        background: 'linear-gradient(to bottom, rgba(10, 10, 25, 0.3) 0%, rgba(60, 30, 100, 0.4) 50%, rgba(10, 10, 25, 0.6) 100%)'
      }} />
        
        {/* Full-bleed Map - with transparency to show background */}
        <div className="absolute inset-0 z-10" style={{
        opacity: 0.85
      }}>
          <MapComponent pickup={pickup} dropoff={dropoff} driverLocation={null} routeMode="pickup-dropoff" pickupAddress={displayPickupAddress} use3DStyle={true} />
        </div>
            
        {/* Compact Frosted Top Bar */}
        <motion.div initial={{
        y: -100,
        opacity: 0
      }} animate={{
        y: 0,
        opacity: 1
      }} className="absolute z-20" style={{
        top: '12px',
        left: '12px',
        right: '12px'
      }}>
          <div className="flex items-center justify-between px-5" style={{
          height: '58px',
          borderRadius: '16px',
          background: 'rgba(10, 10, 15, 0.55)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          border: '1px solid rgba(255, 255, 255, 0.10)',
          boxShadow: '0 10px 30px rgba(0, 0, 0, 0.35)'
        }}>
            {/* Logo with flash animation */}
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center logo-icon-pulse">
                <Car className="h-4 w-4 text-primary-foreground" />
              </div>
              <span className="font-display font-bold text-xl logo-flash">
                Drivveme
              </span>
            </div>
            
            {/* Menu Button with Dropdown */}
            <div className="relative group">
              <button className="p-2 rounded-lg hover:bg-white/10 transition-colors flex items-center gap-1">
                <div className="flex flex-col gap-1">
                  <div className="w-5 h-0.5 bg-white rounded-full" />
                  <div className="w-5 h-0.5 bg-white rounded-full" />
                  <div className="w-5 h-0.5 bg-white rounded-full" />
                </div>
              </button>
              
              {/* Dropdown Menu */}
              <div className="absolute right-0 top-full mt-2 w-48 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
                <div className="rounded-xl overflow-hidden" style={{
                background: 'rgba(20, 10, 35, 0.95)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                boxShadow: '0 10px 40px rgba(0, 0, 0, 0.5)'
              }}>
                  <button onClick={() => navigate('/history')} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/10 transition-colors text-left">
                    <History className="h-5 w-5 text-primary" />
                    <span className="text-white font-medium">
                      {language === 'fr' ? 'Mes trajets' : 'Past Rides'}
                    </span>
                  </button>
                  <div className="h-px bg-white/10" />
                  <button onClick={() => {
                  // Force a full page refresh to reset everything
                  window.location.href = '/ride';
                }} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/10 transition-colors text-left">
                    <Car className="h-5 w-5 text-accent" />
                    <span className="text-white font-medium">
                      {language === 'fr' ? 'Réserver' : 'Book a Ride'}
                    </span>
                  </button>
                  <div className="h-px bg-white/10" />
                  <button onClick={() => {
                  setHelpDialogOpen(true);
                }} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/10 transition-colors text-left relative">
                    <div className="relative">
                      <HelpCircle className="h-5 w-5 text-primary" />
                      {unreadSupportMessages > 0 && <span className="absolute -top-1 -right-1 h-3 w-3 bg-destructive rounded-full animate-pulse" />}
                    </div>
                    <span className="text-white font-medium">
                      {language === 'fr' ? 'Aide' : 'Help'}
                    </span>
                    {unreadSupportMessages > 0 && <span className="ml-auto bg-destructive text-destructive-foreground text-xs font-bold px-2 py-0.5 rounded-full animate-pulse">
                        {unreadSupportMessages}
                      </span>}
                  </button>
                  <div className="h-px bg-white/10" />
                  <button onClick={() => {
                  signOut();
                  navigate('/');
                }} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/10 transition-colors text-left">
                    <LogOut className="h-5 w-5 text-destructive" />
                    <span className="text-white font-medium">
                      {language === 'fr' ? 'Déconnexion' : 'Log Out'}
                    </span>
                  </button>
                </div>
              </div>
            </div>

            <HelpDialog open={helpDialogOpen} onOpenChange={setHelpDialogOpen} />
          </div>
        </motion.div>
        
        {/* GPS Detection Overlay */}
        {isDetectingLocation && <div className="absolute inset-0 bg-background/60 backdrop-blur-sm flex items-center justify-center z-30">
            <div className="bg-card/95 backdrop-blur-md rounded-2xl p-6 shadow-xl flex flex-col items-center gap-4 border border-white/10">
              <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              <p className="text-sm font-medium text-white">
                {language === 'fr' ? 'Détection de votre position...' : 'Detecting your location...'}
              </p>
            </div>
          </div>}
          
        {/* Bottom Frosted Glass Sheet (40vh) with cityscape background */}
        <motion.div initial={{
        y: 100,
        opacity: 0
      }} animate={{
        y: 0,
        opacity: 1
      }} className="absolute z-20 overflow-hidden" style={{
        left: '12px',
        right: '12px',
        bottom: '12px',
        height: 'min(65vh, calc(100dvh - 200px))',
        borderRadius: '20px',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        boxShadow: '0 18px 50px rgba(0, 0, 0, 0.45)'
      }}>
          {/* Background image layer */}
          <div className="absolute inset-0" style={{
          backgroundImage: `url(${welcomeBg})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center top'
        }} />
          {/* Frosted glass overlay */}
          <div className="absolute inset-0" style={{
          background: 'linear-gradient(135deg, rgba(60, 30, 100, 0.3) 0%, rgba(30, 15, 60, 0.4) 50%, rgba(60, 30, 100, 0.3) 100%)'
        }} />
          {/* Glowing logo + brand name at top center */}
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center">
            
            
          </div>
          {/* Content layer */}
          <div className="relative h-full p-5 pt-6 space-y-3 overflow-y-auto z-10">
            {/* Greeting */}
            <GreetingHeader />
            
            {/* Pickup Location Row */}
            <div onClick={() => setShowFullInput(true)} className="flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer hover:bg-white/10 transition-colors" style={{
            background: 'rgba(40, 20, 60, 0.7)',
            border: '1.5px solid rgba(200, 50, 255, 0.6)',
            boxShadow: '0 0 12px rgba(200, 50, 255, 0.25), inset 0 0 8px rgba(200, 50, 255, 0.1)'
          }}>
              <div className="h-9 w-9 rounded-full bg-lime-400/20 flex items-center justify-center flex-shrink-0">
                <Navigation className="h-4 w-4 text-lime-400" />
              </div>
              <span className="flex-1 text-white font-semibold truncate drop-shadow-sm">
                {displayPickupAddress}
              </span>
              <span className="text-white font-medium text-sm flex-shrink-0 px-3 py-1 rounded-full bg-white/15">
                {language === 'fr' ? 'Éditer' : 'Edit'}
              </span>
            </div>

            {/* Destination Input - Where to? */}
            <div className="rounded-xl" style={{
            background: 'rgba(40, 20, 60, 0.7)',
            border: '1.5px solid rgba(200, 50, 255, 0.6)',
            boxShadow: '0 0 12px rgba(200, 50, 255, 0.25), inset 0 0 8px rgba(200, 50, 255, 0.1)'
          }}>
              <LocationInput type="dropoff" value={dropoffAddress} onChange={(addr, coords) => handleDropoffChange(addr, coords)} placeholder={language === 'fr' ? 'Où allez-vous ?' : 'Where to?'} />
            </div>

            {/* Quick Destinations - Top 2 Most Visited */}
            {!dropoffAddress && <QuickDestinations onSelectDestination={dest => {
            handleDropoffChange(dest.address, {
              lat: dest.lat,
              lng: dest.lng
            });
          }} />}

            {/* Get Estimate Button - shows when destination is selected */}
            {dropoffAddress && pickup && <motion.div initial={{
            opacity: 0,
            y: 10
          }} animate={{
            opacity: 1,
            y: 0
          }} transition={{
            delay: 0.1
          }}>
                <Button onClick={handleGetEstimate} className="w-full gradient-primary shadow-button py-5 text-lg font-semibold" disabled={!pickupAddress || !dropoffAddress}>
                  {language === 'fr' ? 'Obtenir un prix' : 'Get Estimate'}
                </Button>
              </motion.div>}
          </div>
        </motion.div>

        {/* Full Input Modal - for editing pickup or when tapped */}
        <AnimatePresence>
          {showFullInput && <motion.div initial={{
          opacity: 0
        }} animate={{
          opacity: 1
        }} exit={{
          opacity: 0
        }} className="fixed inset-0 z-50 bg-background">
              <div className="h-full flex flex-col">
                {/* Header */}
                <div className="flex items-center gap-4 p-4 border-b border-border">
                  <Button variant="ghost" size="icon" onClick={() => setShowFullInput(false)}>
                    <X className="h-5 w-5" />
                  </Button>
                  <h2 className="font-semibold">
                    {language === 'fr' ? 'Où allons-nous?' : 'Where to?'}
                  </h2>
                </div>

                {/* Location Inputs */}
                <div className="p-4 space-y-3">
                  <LocationInput type="pickup" value={pickupAddress} onChange={handlePickupChange} onUseCurrentLocation={useCurrentLocation} />
                  
                  <LocationInput type="dropoff" value={dropoffAddress} onChange={handleDropoffChange} />
                </div>

                {/* Recent Destinations */}
                <div className="flex-1 overflow-y-auto p-4">
                  <RecentDestinations onSelectDestination={dest => {
                handleDropoffChange(dest.address, {
                  lat: dest.lat,
                  lng: dest.lng
                });
                setShowFullInput(false);
              }} />
                </div>

                {/* Action Button */}
                <div className="p-4 border-t border-border">
                  <Button onClick={() => {
                setShowFullInput(false);
                if (pickup && dropoff) {
                  handleGetEstimate();
                }
              }} className="w-full gradient-primary shadow-button py-6 text-lg" disabled={!pickupAddress || !dropoffAddress}>
                    {pickup && dropoff ? t('booking.estimate') : language === 'fr' ? 'Confirmer' : 'Confirm'}
                  </Button>
                </div>
              </div>
            </motion.div>}
        </AnimatePresence>
      </div>;
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
                    <h2 className="font-display text-2xl font-bold fare-header-glow">
                      {t('pricing.estimated')}
                    </h2>
                    <Button variant="ghost" size="icon" onClick={() => setStep('input')}>
                      <X className="h-5 w-5" />
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