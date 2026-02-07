import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Power, MapPin, Navigation, DollarSign, Clock, Star, User, Phone, CheckCircle, XCircle, UserCircle, Bell, Map, HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { formatCurrency, formatDistance, formatDuration } from '@/lib/pricing';
import Navbar from '@/components/Navbar';
import MapComponent from '@/components/MapComponent';
import DriverProfileModal from '@/components/DriverProfileModal';
import { useToast } from '@/hooks/use-toast';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { NotificationPermissionHelpDialog } from '@/components/NotificationPermissionHelpDialog';
import { useAlertSound } from '@/hooks/useAlertSound';
import { RideOfferModal } from '@/components/RideOfferModal';
import { PWAInstallPrompt } from '@/components/PWAInstallPrompt';
import { DriverWakeLockBanner } from '@/components/DriverWakeLockBanner';
import { DriverGPSErrorBanner } from '@/components/DriverGPSErrorBanner';
import { DriverGPSStatusIndicator } from '@/components/DriverGPSStatusIndicator';
import { useDriverGPSStreaming } from '@/hooks/useDriverGPSStreaming';
import { useDriverLocationTracking } from '@/hooks/useDriverLocationTracking';
import { DriverLocationStatus } from '@/components/DriverLocationStatus';
import DriverActiveRidePanel from '@/components/DriverActiveRidePanel';
import DriverNavigationMap from '@/components/DriverNavigationMap';
import DriverInbox from '@/components/DriverInbox';
import RideMessagesPanel from '@/components/RideMessagesPanel';

import { calculatePlatformFee } from '@/lib/platformFees';
import { withTimeout } from '@/lib/withTimeout';
import montrealDriverBg from '@/assets/montreal-driver-night-bg.png';
import { HelpDialog } from '@/components/HelpDialog';
import { useUnreadSupportMessages } from '@/hooks/useUnreadSupportMessages';

interface RideRequest {
  id: string;
  rider_id: string;
  pickup_address: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_address: string;
  dropoff_lat: number;
  dropoff_lng: number;
  distance_km: number;
  estimated_duration_minutes: number;
  estimated_fare: number;
  subtotal_before_tax?: number | null;
  platform_fee?: number | null;
  status: string;
  requested_at: string;
}

interface RiderInfo {
  first_name: string | null;
  last_name: string | null;
  phone_number: string | null;
  avatar_url: string | null;
}

const DriverDashboard = () => {
  const { t, language } = useLanguage();
  const {
    user,
    session,
    roles,
    isDriver,
    driverProfile,
    refreshDriverProfile,
    refreshSession,
    authLoading,
    profileLoading,
  } = useAuth();
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

  const [isOnline, setIsOnline] = useState(false);
  const [availableRides, setAvailableRides] = useState<RideRequest[]>([]);
  const [currentRide, setCurrentRide] = useState<RideRequest | null>(null);
  const [riderInfo, setRiderInfo] = useState<RiderInfo | null>(null);
  const [todayEarnings, setTodayEarnings] = useState(0);
  const [todayRides, setTodayRides] = useState(0);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [helpDialogOpen, setHelpDialogOpen] = useState(false);
  const { unreadCount: unreadSupportMessages } = useUnreadSupportMessages();
  const [showGPSNavigation, setShowGPSNavigation] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const [newRideAlertOpen, setNewRideAlertOpen] = useState(false);
  const [newRideAlertRideId, setNewRideAlertRideId] = useState<string | null>(null);
  // Cache the full ride data when alert opens so it persists even if ride is taken/cancelled
  const [cachedAlertRide, setCachedAlertRide] = useState<RideRequest | null>(null);
  const prevRideIdsRef = useRef<Set<string>>(new Set());
  
  // GPS Streaming for live driver location (continuous foreground tracking)
  const {
    position: gpsPosition,
    error: gpsError,
    isStreaming: isGPSStreaming,
    isConnected: isGPSConnected,
    secondsSinceLastUpdate: gpsSecondsSinceLastUpdate,
    secondsSinceDbSync: gpsSecondsSinceDbSync,
    secondsSinceLastGpsFix: gpsSecondsSinceLastGpsFix,
    retryCount: gpsRetryCount,
    retry: retryGPS,
    lastDbWriteError: gpsLastDbWriteError,
    dbWriteRetryCount: gpsDbWriteRetryCount,
    isDbSyncing: gpsIsDbSyncing,
    authStatus: gpsAuthStatus,
    historyWriteCount: gpsHistoryWriteCount,
    forceWriteWithFeedback: gpsForceWriteWithFeedback,
  } = useDriverGPSStreaming({
    driverId: user?.id ?? null,
    rideId: currentRide?.id ?? null,
    isOnTrip: isOnline || !!currentRide,
    updateIntervalMs: 2500, // Stream every 2.5 seconds
    minDistanceMeters: 15, // Or when moved 15+ meters
  });

  // Admin live map location tracking (separate from ride GPS)
  const {
    isTracking: locationIsTracking,
    lastUpdate: locationLastUpdate,
    locationError,
    permissionStatus: locationPermission,
  } = useDriverLocationTracking({
    userId: user?.id,
    // Use auth user id as the stable driver identifier for driver_locations.
    // (driver_profiles.id is a separate UUID and won't match admin map expectations.)
    driverId: user?.id,
    isOnline,
    updateIntervalMs: 3000,
  });

  // Sync GPS position to local state for map
  const driverLocation = gpsPosition ? { lat: gpsPosition.lat, lng: gpsPosition.lng } : null;
  
  const { play: playAlertSound, stop: stopAlertSound, unlock: unlockAlertSound } = useAlertSound({
    volume: 1.0,  // MAXIMUM volume
    loop: true, 
    loopInterval: 1500  // Faster loop - every 1.5 seconds
  });
  const alertStartTimeRef = useRef<number | null>(null);

  // Helper function for distance calculation (must be defined before any hooks that call it)
  const calculateDistanceKm = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  // Build alertRide from cached data so it persists even when ride is removed from availableRides
  const alertRide = useMemo(() => {
    try {
      // Use cached ride data if available (this persists even if ride is taken/cancelled)
      if (!cachedAlertRide) return null;
      
      // Calculate pickup ETA based on driver location
      let pickupEtaMinutes: number | undefined;
      if (driverLocation && typeof cachedAlertRide.pickup_lat === 'number' && typeof cachedAlertRide.pickup_lng === 'number') {
        const distanceKm = calculateDistanceKm(
          driverLocation.lat, driverLocation.lng,
          cachedAlertRide.pickup_lat, cachedAlertRide.pickup_lng
        );
        pickupEtaMinutes = Math.ceil((distanceKm / 30) * 60); // 30km/h average
      }
      
      return {
        id: cachedAlertRide.id,
        pickup_address: cachedAlertRide.pickup_address || 'Unknown pickup',
        dropoff_address: cachedAlertRide.dropoff_address || 'Unknown destination',
        estimated_fare: cachedAlertRide.estimated_fare,
        distance_km: cachedAlertRide.distance_km,
        estimated_duration_minutes: cachedAlertRide.estimated_duration_minutes,
        pickup_eta_minutes: pickupEtaMinutes,
        is_priority: false,
        pickup_lat: cachedAlertRide.pickup_lat,
        pickup_lng: cachedAlertRide.pickup_lng,
      };
    } catch (err) {
      console.error('[DriverDashboard] Error computing alertRide:', err);
      return null;
    }
  }, [cachedAlertRide, driverLocation]);

  const [redirectGraceOver, setRedirectGraceOver] = useState(false);

  const [showReconnect, setShowReconnect] = useState(false);

  // Persist last known route so iOS Home Screen reloads can restore driver dashboard.
  useEffect(() => {
    try {
      localStorage.setItem('last_route', '/driver');
    } catch {
      // ignore
    }
  }, []);

  // Grace window on initial load/resume (iOS can briefly report null session)
  useEffect(() => {
    setRedirectGraceOver(false);
    const t = window.setTimeout(() => setRedirectGraceOver(true), 5000);
    return () => window.clearTimeout(t);
  }, []);

  // If we have a session but roles/driver profile are taking too long, show a reconnect UI
  // instead of an infinite loading screen.
  useEffect(() => {
    // Reset when things are healthy.
    // IMPORTANT: don't hard-block the entire dashboard on roles/driverProfile.
    // Those can be delayed by mobile networks / transient RLS hiccups and would otherwise
    // create an infinite loading screen. Only block while we are actively fetching.
    const waitingForIdentity = !!session && profileLoading;

    if (!waitingForIdentity) {
      setShowReconnect(false);
      return;
    }

    const t = window.setTimeout(() => setShowReconnect(true), 8000);
    return () => window.clearTimeout(t);
  }, [session, profileLoading, roles.length, driverProfile]);

  // Redirect if not logged in as driver (gated behind authLoading + grace window)
  useEffect(() => {
    if (authLoading) return;
    if (!redirectGraceOver) return;

    // If we truly have no session after load+grace, send to login.
    if (!session) {
      navigate('/login', { replace: true });
      return;
    }

    // If roles are still loading / profile fetch is retrying, never redirect.
    if (profileLoading || roles.length === 0) return;

    // Not a driver -> send to landing.
    if (!isDriver) {
      navigate('/', { replace: true });
    }
  }, [authLoading, redirectGraceOver, session, profileLoading, roles.length, isDriver, navigate]);

  // If we have a valid session and driver role but the driver profile hasn't loaded yet,
  // fetch it in the background (don't redirect). Auto-create if it doesn't exist.
  useEffect(() => {
    if (!session?.user) return;
    if (driverProfile) return;

    // If roles are slow to load, use last_route as a hint that this user is a driver.
    const last = (() => {
      try {
        return localStorage.getItem('last_route');
      } catch {
        return null;
      }
    })();

    const ensureDriverProfile = async () => {
      // First try to fetch existing profile
      const { data: existingProfile, error: fetchError } = await supabase
        .from('driver_profiles')
        .select('*')
        .eq('user_id', session.user.id)
        .maybeSingle();

      if (existingProfile) {
        // Profile exists, refresh it in context
        void refreshDriverProfile();
        return;
      }

      // Profile doesn't exist - create one for drivers
      if (isDriver || last === '/driver') {
        console.log('[DriverDashboard] Creating missing driver_profile for user:', session.user.id);
        const { error: insertError } = await supabase
          .from('driver_profiles')
          .insert({
            user_id: session.user.id,
            is_online: false,
            is_verified: false,
          });

        if (insertError) {
          console.error('[DriverDashboard] Failed to create driver_profile:', insertError);
        } else {
          // Refresh to load the newly created profile
          void refreshDriverProfile();
        }
      }
    };

    if (isDriver || last === '/driver') {
      ensureDriverProfile();
    }
  }, [session?.user?.id, isDriver, driverProfile, refreshDriverProfile]);

  // Force refresh driver profile on mount to ensure fresh data
  useEffect(() => {
    if (!session?.user?.id) return;
    
    // Always try to refresh the driver profile once on mount
    const timer = setTimeout(() => {
      if (!driverProfile) {
        console.log('[DriverDashboard] Force refreshing driver profile...');
        void refreshDriverProfile();
      }
    }, 1000);
    
    return () => clearTimeout(timer);
  }, [session?.user?.id]);

  // Initialize driver status
  useEffect(() => {
    if (driverProfile) {
      setIsOnline(driverProfile.is_online);
    }
  }, [driverProfile]);

  // Restore active ride on page load (critical for iOS resume / page refresh)
  // NOTE: use the session user id (more reliable than the derived `user` field in edge cases)
  useEffect(() => {
    const driverId = session?.user?.id;
    if (!driverId) return;

    const restoreActiveRide = async () => {
      const { data, error } = await supabase
        .from('rides')
        .select('*')
        .eq('driver_id', driverId)
        .in('status', ['driver_assigned', 'driver_en_route', 'arrived', 'in_progress'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!error && data) {
        console.log('[DriverDashboard] Restored active ride:', data.id, data.status);
        setCurrentRide(data);
        
        // Fetch rider info inline
        const { data: riderData } = await supabase
          .from('profiles')
          .select('first_name, last_name, phone_number, avatar_url')
          .eq('user_id', data.rider_id)
          .single();
        
        if (riderData) {
          setRiderInfo(riderData);
        }
      }
    };

    restoreActiveRide();
  }, [session?.user?.id]);

  // GPS location is now handled by useDriverGPSStreaming hook
  // The hook automatically tracks when isOnline or currentRide changes

  // Track whether this is the first fetch (to show alert for already-existing rides)
  const isFirstFetchRef = useRef(true);

  // Fetch available rides when online
  useEffect(() => {
    if (!isOnline || !user || !session) return;
    
    // Reset first fetch flag when going online
    isFirstFetchRef.current = true;
    prevRideIdsRef.current = new Set();

    const fetchRides = async () => {
      // Avoid forcing refreshSession here (can cause unexpected auth churn on flaky connections)
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) return;

      const { data, error } = await supabase
        .from('rides')
        .select('*')
        .eq('status', 'searching')
        .order('requested_at', { ascending: true });

      if (!error && data) {
        try {
          // Detect newly-added rides (to trigger big in-app alert + sound).
          // Defensive: filter out any malformed rides to prevent crashes
          const validRides = data.filter((r) => 
            r && 
            typeof r.id === 'string' && 
            typeof r.pickup_lat === 'number' && 
            typeof r.pickup_lng === 'number'
          );

          const nextIds = new Set(validRides.map((r) => r.id));
          const prevIds = prevRideIdsRef.current;
          const isFirstFetch = isFirstFetchRef.current;
          
          // On first fetch, show alert for the most recent waiting ride
          // On subsequent fetches, only show alert for truly new rides
          let rideToAlert: RideRequest | null = null;
          
          if (isFirstFetch && validRides.length > 0) {
            // First fetch: show the most recent ride that's waiting
            rideToAlert = validRides[validRides.length - 1]; // Most recent by requested_at
            isFirstFetchRef.current = false;
          } else if (!isFirstFetch) {
            // Subsequent fetch: only show newly added rides
            rideToAlert = validRides.find((r) => !prevIds.has(r.id)) ?? null;
          }
          
          prevRideIdsRef.current = nextIds;
          setAvailableRides(validRides);

          if (rideToAlert && !currentRide && !newRideAlertOpen) {
            // Cache the full ride data so it persists even if ride is cancelled/taken
            setCachedAlertRide(rideToAlert);
            setNewRideAlertRideId(rideToAlert.id);
            setNewRideAlertOpen(true);
            alertStartTimeRef.current = Date.now();
            void playAlertSound();
            console.log('[DriverDashboard] 🔔 Showing ride alert for:', rideToAlert.id, isFirstFetch ? '(initial load)' : '(new ride)');
          }
        } catch (err) {
          console.error('[DriverDashboard] Error processing rides:', err);
        }
      }
    };

    fetchRides();

    // Subscribe to new rides
    const channel = supabase
      .channel('searching-rides')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'rides',
          filter: 'status=eq.searching',
        },
        (payload) => {
          try {
            // Reliable in-app fallback alert (works even when system push is flaky on mobile browsers)
            if (!currentRide && payload.eventType === 'INSERT') {
              console.log('[DriverDashboard] 🚗 New ride INSERT detected via realtime!');
              
              // Play LOUD alert sound immediately on realtime event
              void playAlertSound();
              
              toast({
                title: '🚗 NEW RIDE REQUEST!',
                description: 'A rider is looking for a driver now.',
              });

              if ('vibrate' in navigator) {
                // Strong vibration pattern
                (navigator as any).vibrate?.([300, 100, 300, 100, 500]);
              }
            }
            fetchRides();
          } catch (err) {
            console.error('[DriverDashboard] Realtime handler error:', err);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isOnline, user, session]);

  // Subscribe to current ride updates
  useEffect(() => {
    if (!currentRide?.id) return;

    const channel = supabase
      .channel(`driver-ride-${currentRide.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'rides',
          filter: `id=eq.${currentRide.id}`,
        },
        (payload) => {
          const updatedRide = payload.new as RideRequest;
          setCurrentRide(updatedRide);
          
          if (updatedRide.status === 'cancelled') {
            toast({
              title: 'Ride cancelled',
              description: 'The rider cancelled this ride',
              variant: 'destructive',
            });
            setCurrentRide(null);
            setRiderInfo(null);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentRide?.id]);

  // Fetch today's earnings
  useEffect(() => {
    if (!user) return;

    const fetchTodayStats = async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const { data, error } = await supabase
        .from('rides')
        .select('driver_earnings')
        .eq('driver_id', user.id)
        .eq('status', 'completed')
        .gte('dropoff_at', today.toISOString());

      if (!error && data) {
        const earnings = data.reduce((sum, ride) => sum + (Number(ride.driver_earnings) || 0), 0);
        setTodayEarnings(earnings);
        setTodayRides(data.length);
      }
    };

    fetchTodayStats();
  }, [user, currentRide]);

  const toggleOnlineStatus = async () => {
    if (!user) return;

    try {
      const newStatus = !isOnline;
      
      const { error } = await supabase
        .from('driver_profiles')
        .update({ is_online: newStatus })
        .eq('user_id', user.id);

      if (error) {
        toast({
          title: 'Error',
          description: error.message,
          variant: 'destructive',
        });
        return;
      }

      setIsOnline(newStatus);
      await refreshDriverProfile();

      toast({
        title: newStatus ? 'You are now online' : 'You are now offline',
        description: newStatus ? 'You will receive ride requests' : 'You will not receive ride requests',
      });
    } catch (error) {
      console.error('[DriverDashboard] toggleOnlineStatus error:', error);
      toast({ title: 'Error', description: 'Something went wrong. Please try again.', variant: 'destructive' });
    }
  };

  const fetchRiderInfo = useCallback(async (riderId: string) => {
    const { data } = await supabase
      .from('profiles')
      .select('first_name, last_name, phone_number, avatar_url')
      .eq('user_id', riderId)
      .single();

    if (data) {
      setRiderInfo(data);
    }
  }, []);

  // Push notifications are handled server-side via edge functions
  // No client-side notification sending needed

  const acceptRide = async (ride: RideRequest) => {
    if (!user || busyAction) return;

    // Stop the alert sound immediately and clear cached ride
    stopAlertSound();
    setNewRideAlertOpen(false);
    setCachedAlertRide(null);
    setNewRideAlertRideId(null);
    setBusyAction('accept');

    try {
      // Calculate acceptance time for priority driver reward
      const acceptanceTimeSeconds = alertStartTimeRef.current 
        ? Math.floor((Date.now() - alertStartTimeRef.current) / 1000)
        : null;

      const { error } = await withTimeout(
        supabase
          .from('rides')
          .update({
            driver_id: user.id,
            status: 'driver_assigned',
            accepted_at: new Date().toISOString(),
            acceptance_time_seconds: acceptanceTimeSeconds,
          })
          .eq('id', ride.id)
          .eq('status', 'searching')
          .then(r => r),
        7000,
        'Accept ride'
      );

      if (error) {
        toast({
          title: 'Error',
          description: 'This ride is no longer available',
          variant: 'destructive',
        });
        return;
      }

      // Grant Priority Driver status if accepted within 5 seconds
      if (acceptanceTimeSeconds !== null && acceptanceTimeSeconds <= 5) {
        const priorityUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString();
        supabase
          .from('driver_profiles')
          .update({ priority_driver_until: priorityUntil })
          .eq('user_id', user.id)
          .then(() => {});

        toast({
          title: '⚡ Priority Driver Activated!',
          description: 'You get priority for the next 30 minutes for accepting fast!',
        });
      }

      // Update UI immediately
      setCurrentRide({ ...ride, status: 'driver_assigned' });
      setAvailableRides((prev) => prev.filter((r) => r.id !== ride.id));
      
      if (!acceptanceTimeSeconds || acceptanceTimeSeconds > 5) {
        toast({
          title: 'Ride accepted!',
          description: 'Navigate to pickup location',
        });
      }

      // Reset alert tracking
      alertStartTimeRef.current = null;

      // Background: fetch rider info + send notifications
      fetchRiderInfo(ride.rider_id);

      supabase.from('notifications').insert({
        user_id: ride.rider_id,
        ride_id: ride.id,
        type: 'driver_assigned',
        title: 'Driver Found! 🚗',
        message: 'Your driver is on the way to pick you up.',
      }).then(() => {});
    } catch (error) {
      console.error('[DriverDashboard] acceptRide error:', error);
      toast({ title: 'Error', description: 'Something went wrong. Please try again.', variant: 'destructive' });
    } finally {
      setBusyAction(null);
    }
  };

  const updateRideStatus = async (status: string) => {
    if (!currentRide || !user || busyAction) return;

    stopAlertSound();
    setBusyAction(status);

    // Optimistic update — instant UI feedback
    const prev = { ...currentRide };
    if (status === 'completed') {
      const fareForFee = currentRide.subtotal_before_tax ?? currentRide.estimated_fare;
      const fee = calculatePlatformFee(fareForFee);
      toast({
        title: 'Ride completed!',
        description: `You earned ${formatCurrency(fareForFee - fee, language)}`,
      });
      setCurrentRide(null);
      setRiderInfo(null);
      setShowGPSNavigation(false);
    } else {
      setCurrentRide((r) => r ? { ...r, status } : null);
      if (status === 'arrived') {
        toast({ title: language === 'fr' ? 'Arrivé!' : 'Arrived!' });
      } else if (status === 'in_progress') {
        toast({ title: language === 'fr' ? 'Course démarrée!' : 'Ride started!' });
      }
    }

    try {
      const updates: any = { status };
      if (status === 'in_progress') {
        updates.pickup_at = new Date().toISOString();
      } else if (status === 'completed') {
        updates.dropoff_at = new Date().toISOString();
        const fareForFee = prev.subtotal_before_tax ?? prev.estimated_fare;
        const fee = calculatePlatformFee(fareForFee);
        updates.actual_fare = prev.estimated_fare;
        updates.platform_fee = fee;
        updates.driver_earnings = fareForFee - fee;
      }

      const { error } = await withTimeout(
        supabase.from('rides').update(updates).eq('id', prev.id).then(r => r),
        7000,
        `Update status to ${status}`
      );

      if (error) {
        setCurrentRide(prev);
        toast({ title: 'Error', description: error.message, variant: 'destructive' });
        return;
      }

      if (status === 'completed') {
        void refreshDriverProfile();
      }
    } catch (error) {
      setCurrentRide(prev);
      console.error('[DriverDashboard] updateRideStatus error:', error);
      toast({ title: 'Error', description: 'Network slow — status not saved. Try again.', variant: 'destructive' });
    } finally {
      setBusyAction(null);
    }
  };

  const cancelRide = async () => {
    if (!currentRide || !user || busyAction) return;

    stopAlertSound();
    setBusyAction('cancel');

    // Optimistic: clear ride immediately
    const prev = currentRide;
    setCurrentRide(null);
    setRiderInfo(null);
    toast({ title: 'Ride cancelled' });

    try {
      const { error } = await withTimeout(
        supabase
          .from('rides')
          .update({
            status: 'cancelled',
            cancelled_at: new Date().toISOString(),
            cancelled_by: user.id,
            cancellation_reason: 'Cancelled by driver',
            driver_id: null,
          })
          .eq('id', prev.id)
          .then(r => r),
        7000,
        'Cancel ride'
      );

      if (error) {
        setCurrentRide(prev);
        toast({ title: 'Error', description: error.message, variant: 'destructive' });
      }
    } catch (error) {
      setCurrentRide(prev);
      console.error('[DriverDashboard] cancelRide error:', error);
      toast({ title: 'Error', description: 'Network slow — cancel not saved. Try again.', variant: 'destructive' });
    } finally {
      setBusyAction(null);
    }
  };

  // Pre-unlock audio on ANY user interaction so beep can play when ride arrives
  useEffect(() => {
    const handler = () => void unlockAlertSound();
    const events = ['pointerdown', 'touchstart', 'click', 'scroll'];
    events.forEach(e => window.addEventListener(e, handler, { passive: true, once: false }));
    return () => {
      events.forEach(e => window.removeEventListener(e, handler));
    };
  }, [unlockAlertSound]);

  // Use subtotal_before_tax for fee calculation (excludes taxes which riders pay)
  const currentRideFareForFee = currentRide ? (currentRide.subtotal_before_tax ?? currentRide.estimated_fare) : 0;
  const currentRideFee = currentRide ? calculatePlatformFee(currentRideFareForFee) : 0;
  const driverEarnings = currentRide ? currentRideFareForFee - currentRideFee : 0;

  // Loading states: never redirect while we are still restoring session/profile on iOS.
  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">{t('common.loading')}</div>
      </div>
    );
  }

  const waitingForIdentity =
    !!session && profileLoading;

  if (waitingForIdentity) {
    if (!showReconnect) {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="animate-pulse text-muted-foreground">{t('common.loading')}</div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <Card className="w-full max-w-sm p-6 text-center">
          <div className="font-medium">Reconnecting…</div>
          <div className="mt-2 text-sm text-muted-foreground">
            We're keeping you signed in while we reload your driver account.
          </div>
          <div className="mt-5 flex flex-col gap-3">
            <Button
              onClick={async () => {
                await refreshSession();
                await refreshDriverProfile();
              }}
            >
              Retry now
            </Button>
            <Button variant="outline" onClick={() => window.location.reload()}>
              Reload page
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background" onPointerDown={() => void unlockAlertSound()}>

      <RideOfferModal
        open={newRideAlertOpen}
        ride={alertRide}
        countdownSeconds={30}
        driverLocation={driverLocation}
        onDecline={() => {
          setNewRideAlertOpen(false);
          setCachedAlertRide(null);
          setNewRideAlertRideId(null);
          stopAlertSound();
          alertStartTimeRef.current = null;
        }}
        onAccept={() => {
          // Use cached ride data for acceptance (persists even if ride was removed from availableRides)
          if (cachedAlertRide) {
            acceptRide(cachedAlertRide);
          }
        }}
      />
      <Navbar />
      
      <div className="pt-16 h-screen flex flex-col lg:flex-row">
        {/* Map */}
        <div className="flex-1 relative">
          <MapComponent
            pickup={currentRide ? { lat: currentRide.pickup_lat, lng: currentRide.pickup_lng } : null}
            dropoff={currentRide ? { lat: currentRide.dropoff_lat, lng: currentRide.dropoff_lng } : null}
            driverLocation={driverLocation}
              routeMode={
                currentRide
                  ? currentRide.status === 'in_progress'
                    ? 'driver-to-dropoff'
                    : 'driver-to-pickup'
                  : 'pickup-dropoff'
              }
              followDriver={!!currentRide}
          />
          
          {/* Online/Offline Toggle Overlay */}
          <div className="absolute top-4 left-4 right-4">
            <Card className={`p-4 flex items-center justify-between ${isOnline ? 'border-success/50 bg-success/5' : 'border-muted'}`}>
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${isOnline ? 'bg-success animate-pulse' : 'bg-muted-foreground'}`} />
                <span className="font-medium">
                  {isOnline ? t('driver.goOffline') : t('driver.goOnline')}
                </span>
              </div>
              <Switch
                checked={isOnline}
                onCheckedChange={async () => {
                  // Unlock audio (browser gesture) so subsequent alerts can play sound.
                  await unlockAlertSound();
                  await toggleOnlineStatus();
                }}
                className="data-[state=checked]:bg-success"
              />
            </Card>
          </div>

          {/* Floating Complete Ride Button removed - buttons now in Active Ride panel */}
        </div>

        {/* Driver Panel with Montreal background */}
        <motion.div
          initial={{ x: 100, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          className="w-full lg:w-[420px] border-l border-border flex flex-col relative overflow-hidden"
        >
          {/* Background Image */}
          <div 
            className="absolute inset-0 bg-cover bg-center bg-no-repeat"
            style={{ backgroundImage: `url(${montrealDriverBg})` }}
          />
          {/* Dark overlay for readability */}
          <div className="absolute inset-0 bg-gradient-to-b from-background/90 via-background/85 to-background/95" />
          
          {/* Content container - relative to appear above background */}
          <div className="relative z-10 flex flex-col flex-1">
            {/* Wake Lock Banner - Keep screen awake while driving */}
            <div className="pt-4">
              <DriverWakeLockBanner isOnline={isOnline} hasActiveRide={!!currentRide} />
              
              {/* GPS Status Indicator - Simplified to just the button */}
              {(isOnline || currentRide) && (
                <DriverGPSStatusIndicator
                  onForceSend={gpsForceWriteWithFeedback}
                  isStreaming={isGPSStreaming}
                  isConnected={isGPSConnected}
                  position={gpsPosition}
                  secondsSinceLastUpdate={gpsSecondsSinceLastUpdate}
                  secondsSinceDbSync={gpsSecondsSinceDbSync}
                  secondsSinceLastGpsFix={gpsSecondsSinceLastGpsFix}
                  retryCount={gpsRetryCount}
                  onRetry={retryGPS}
                  rideId={currentRide?.id ?? null}
                  lastDbWriteError={gpsLastDbWriteError}
                  dbWriteRetryCount={gpsDbWriteRetryCount}
                  isDbSyncing={gpsIsDbSyncing}
                  authStatus={gpsAuthStatus}
                  historyWriteCount={gpsHistoryWriteCount}
                />
              )}
              
              {/* GPS Error Banner - Show when location fails */}
              <DriverGPSErrorBanner 
                error={gpsError} 
                retryCount={gpsRetryCount} 
                onRetry={retryGPS} 
              />
            </div>

            <div className="p-6 flex-1 overflow-y-auto">

            {/* ========== DRIVER ACTIVE RIDE PANEL ========== */}
            {/* Always shows Start/End Ride buttons for the assigned driver */}
            <DriverActiveRidePanel
              onRideCompleted={() => {
                setCurrentRide(null);
                setRiderInfo(null);
                void refreshDriverProfile();
              }}
              onRideUpdated={(ride) => {
                // Keep local state in sync
                setCurrentRide(ride as RideRequest);
              }}
            />

            {/* ========== RIDE MESSAGES PANEL ========== */}
            {/* Always rendered - shows messaging UI or explanation why not available */}
            <RideMessagesPanel />

            {/* GPS Navigation Button - Prominent when there's an active ride */}
            {currentRide && ['driver_assigned', 'driver_en_route', 'arrived', 'in_progress'].includes(currentRide.status) && (
              <button
                type="button"
                className="w-full mb-4 py-6 text-lg font-bold bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl flex items-center justify-center gap-3"
                style={{
                  touchAction: 'manipulation',
                  userSelect: 'none',
                  WebkitUserSelect: 'none',
                  WebkitTapHighlightColor: 'transparent',
                }}
                onPointerDownCapture={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setShowGPSNavigation(true);
                }}
                onTouchStartCapture={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setShowGPSNavigation(true);
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setShowGPSNavigation(true);
                }}
              >
                <Map className="h-6 w-6" />
                {language === 'fr' ? 'Ouvrir Navigation GPS' : 'Open GPS Navigation'}
              </button>
            )}

            {/* Profile, Help and Inbox Buttons */}
            <div className="flex gap-2 mb-4">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setIsProfileModalOpen(true)}
              >
                <UserCircle className="h-5 w-5 mr-2" />
                Edit Profile
              </Button>
              <Button
                variant="outline"
                onClick={() => setHelpDialogOpen(true)}
                className="relative"
              >
                <HelpCircle className="h-5 w-5" />
                {unreadSupportMessages > 0 && (
                  <span className="absolute -top-1 -right-1 h-4 w-4 bg-destructive text-destructive-foreground text-xs font-bold rounded-full flex items-center justify-center animate-pulse">
                    {unreadSupportMessages}
                  </span>
                )}
              </Button>
              <DriverInbox />
            </div>

            {/* Push Notifications (critical for new ride alerts when app is backgrounded) */}
            {!pushSubscribed && (
              <Card className="p-4 mb-4 bg-primary/5 border-primary/20">
                <div className="flex items-start gap-3">
                  <Bell className="h-5 w-5 text-primary mt-0.5" />
                  <div className="flex-1">
                    <p className="font-medium text-sm">Enable notifications for new ride requests</p>
                    {!pushSupported ? (
                      <p className="text-xs text-muted-foreground">
                        Push isn’t available in this browser mode. On iPhone/iPad you must install the app (Add to Home Screen).
                      </p>
                    ) : pushPermission === 'denied' ? (
                      <p className="text-xs text-muted-foreground">Notifications are blocked in your device/browser settings.</p>
                    ) : (
                      <p className="text-xs text-muted-foreground">Turn on notifications so you don’t miss trips.</p>
                    )}
                  </div>

                  {!pushSupported ? (
                    <Button size="sm" variant="outline" onClick={() => setNotificationHelpOpen(true)}>
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
                      disabled={pushLoading}
                      onClick={async () => {
                        const ok = await subscribeToPush();
                        if (ok) {
                          toast({ title: language === 'fr' ? 'Notifications activées' : 'Notifications enabled' });
                        }
                      }}
                    >
                      {pushLoading ? 'Enabling…' : 'Enable & Test'}
                    </Button>
                  )}
                </div>

                <NotificationPermissionHelpDialog open={notificationHelpOpen} onOpenChange={setNotificationHelpOpen} />
              </Card>
            )}

            {/* Go Online/Offline Button */}
            <Button
                onClick={async () => {
                  await unlockAlertSound();
                  await toggleOnlineStatus();
                }}
              className={`w-full h-16 text-lg font-bold mb-6 transition-all ${
                isOnline 
                  ? 'bg-destructive hover:bg-destructive/90 text-destructive-foreground' 
                  : 'gradient-primary'
              }`}
            >
              <Power className={`h-6 w-6 mr-3 ${isOnline ? '' : 'animate-pulse'}`} />
              {isOnline ? 'Go Offline' : 'Go Online'}
            </Button>

            {/* Location Sharing Status */}
            {isOnline && (
              <div className="flex justify-center mb-6">
                <DriverLocationStatus
                  isTracking={locationIsTracking}
                  lastUpdate={locationLastUpdate}
                  locationError={locationError}
                  permissionStatus={locationPermission}
                  isOnline={isOnline}
                />
              </div>
            )}

            {/* Earnings moved to dedicated Earnings page (/earnings) */}
            {/* Active ride buttons are handled by DriverActiveRidePanel above */}

            {/* Available Rides Section - Always visible when online */}
            {isOnline && (
              <div id="available-rides" className={currentRide ? 'mt-8 pt-6 border-t border-border' : ''}>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-display text-xl font-bold flex items-center gap-2">
                    <Navigation className="h-5 w-5 text-primary" />
                    {currentRide ? 'Other Available Rides' : 'Available Rides'}
                  </h2>
                  {availableRides.length > 0 && (
                    <span className="bg-primary text-primary-foreground text-xs font-bold px-2.5 py-1 rounded-full">
                      {availableRides.length}
                    </span>
                  )}
                </div>

                {availableRides.length === 0 && (
                  <Card className="p-8 text-center border-dashed border-2 border-muted-foreground/20">
                    <Navigation className="h-12 w-12 mx-auto mb-3 text-muted-foreground/40" />
                    <p className="font-medium text-muted-foreground">No rides available nearby</p>
                    <p className="text-sm text-muted-foreground/70 mt-1">New requests will appear here automatically</p>
                  </Card>
                )}

                <div className="space-y-4">
                  {availableRides.map((ride, index) => {
                    // Calculate pickup distance from driver
                    let pickupDistanceKm: number | undefined;
                    if (driverLocation && typeof ride.pickup_lat === 'number' && typeof ride.pickup_lng === 'number') {
                      pickupDistanceKm = calculateDistanceKm(
                        driverLocation.lat, driverLocation.lng,
                        ride.pickup_lat, ride.pickup_lng
                      );
                    }
                    const driverEarnings = Number(ride.estimated_fare) - calculatePlatformFee(Number(ride.estimated_fare));

                    return (
                      <motion.div
                        key={ride.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.05 }}
                      >
                        <Card className="p-4 border-primary/20 hover:border-primary/40 transition-all hover:shadow-md">
                          {/* Earnings highlight */}
                          <div className="flex items-center justify-between mb-3">
                            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                              {pickupDistanceKm !== undefined
                                ? `${pickupDistanceKm.toFixed(1)} km away`
                                : 'Ride Request'}
                            </span>
                            <span className="text-lg font-bold text-accent">
                              {formatCurrency(driverEarnings, language)}
                            </span>
                          </div>

                          {/* Route */}
                          <div className="space-y-2 mb-3">
                            <div className="flex items-start gap-2">
                              <div className="mt-1.5 h-2.5 w-2.5 rounded-full bg-primary flex-shrink-0" />
                              <p className="text-sm font-medium line-clamp-1">{ride.pickup_address}</p>
                            </div>
                            <div className="ml-[5px] border-l-2 border-dashed border-muted-foreground/30 h-3" />
                            <div className="flex items-start gap-2">
                              <div className="mt-1.5 h-2.5 w-2.5 rounded-sm bg-accent flex-shrink-0" />
                              <p className="text-sm font-medium line-clamp-1">{ride.dropoff_address}</p>
                            </div>
                          </div>

                          {/* Trip details */}
                          <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3">
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {formatDistance(Number(ride.distance_km), language)}
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {formatDuration(ride.estimated_duration_minutes, language)}
                            </span>
                          </div>

                          {/* Earnings breakdown */}
                          <div className="p-3 bg-muted/50 rounded-lg mb-4 text-sm">
                            <div className="flex justify-between mb-1">
                              <span className="text-muted-foreground">Fare</span>
                              <span>{formatCurrency(Number(ride.estimated_fare), language)}</span>
                            </div>
                            <div className="flex justify-between text-destructive mb-1">
                              <span>{t('driver.platformFee')}</span>
                              <span>-{formatCurrency(calculatePlatformFee(Number(ride.estimated_fare)), language)}</span>
                            </div>
                            <div className="flex justify-between font-bold text-accent pt-2 border-t border-border">
                              <span>{t('driver.yourEarnings')}</span>
                              <span>{formatCurrency(driverEarnings, language)}</span>
                            </div>
                          </div>

                          {/* Action buttons */}
                          <div className="grid grid-cols-2 gap-2">
                            <Button
                              variant="outline"
                              className="text-destructive border-destructive/50 hover:bg-destructive/10"
                              onClick={() => setAvailableRides((prev) => prev.filter((r) => r.id !== ride.id))}
                            >
                              <XCircle className="h-4 w-4 mr-2" />
                              {t('driver.decline')}
                            </Button>
                            <Button
                              className="gradient-primary"
                              onClick={() => acceptRide(ride)}
                              disabled={!!currentRide}
                            >
                              <CheckCircle className="h-4 w-4 mr-2" />
                              {t('driver.accept')}
                            </Button>
                          </div>
                        </Card>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Offline message */}
            {!isOnline && !currentRide && (
              <div className="text-center py-12 text-muted-foreground">
                <Navigation className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Go online to see rides</p>
              </div>
            )}
          </div>
          </div> {/* Close content container */}
        </motion.div>
      </div>

      {/* Profile Edit Modal */}
      <DriverProfileModal 
        open={isProfileModalOpen} 
        onOpenChange={setIsProfileModalOpen} 
      />

      <HelpDialog open={helpDialogOpen} onOpenChange={setHelpDialogOpen} />

      {/* PWA Install Prompt for Drivers */}
      <PWAInstallPrompt />

      {/* Fullscreen GPS Navigation Map */}
      {showGPSNavigation && currentRide && (
        <DriverNavigationMap
          driverLocation={driverLocation}
          destination={
            currentRide.status === 'in_progress'
              ? { lat: currentRide.dropoff_lat, lng: currentRide.dropoff_lng, address: currentRide.dropoff_address }
              : { lat: currentRide.pickup_lat, lng: currentRide.pickup_lng, address: currentRide.pickup_address }
          }
          destinationType={currentRide.status === 'in_progress' ? 'dropoff' : 'pickup'}
          rideStatus={currentRide.status}
          onClose={() => setShowGPSNavigation(false)}
          onArrived={() => updateRideStatus('arrived')}
          onStartRide={() => updateRideStatus('in_progress')}
          onCompleteRide={() => updateRideStatus('completed')}
          onCancelRide={cancelRide}
        />
      )}
    </div>
  );
};

export default DriverDashboard;