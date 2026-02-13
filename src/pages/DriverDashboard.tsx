import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Power, MapPin, Navigation, DollarSign, Clock, Star, User, Phone, UserCircle, Bell, Map, HelpCircle, Gift } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { formatCurrency } from '@/lib/pricing';
import Navbar from '@/components/Navbar';
import MapComponent from '@/components/MapComponent';
import DriverProfileModal from '@/components/DriverProfileModal';
import { useToast } from '@/hooks/use-toast';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { NotificationPermissionHelpDialog } from '@/components/NotificationPermissionHelpDialog';
import DriverBeepFix from '@/components/DriverBeepFix';
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
  // availableRides removed — push-only dispatch, no feed
  const [currentRide, setCurrentRide] = useState<RideRequest | null>(null);
  const [riderInfo, setRiderInfo] = useState<RiderInfo | null>(null);
  const [todayEarnings, setTodayEarnings] = useState(0);
  const [todayRides, setTodayRides] = useState(0);
  const [todayTips, setTodayTips] = useState<{ amount: number; rider_name: string; pickup: string; dropoff: string; time: string }[]>([]);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [helpDialogOpen, setHelpDialogOpen] = useState(false);
  const { unreadCount: unreadSupportMessages } = useUnreadSupportMessages();
  const [showGPSNavigation, setShowGPSNavigation] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const [newRideAlertOpen, setNewRideAlertOpen] = useState(false);
  const [newRideAlertRideId, setNewRideAlertRideId] = useState<string | null>(null);
  // Cache the full ride data when alert opens so it persists even if ride is taken/cancelled
  const [cachedAlertRide, setCachedAlertRide] = useState<RideRequest | null>(null);
  
  
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

  // Initialize driver status — always start offline on login/load
  useEffect(() => {
    // Don't sync from DB; driver must manually go online each session
    setIsOnline(false);
  }, []);

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

  // Push-based ride offer listener — no polling, no feed.
  // Listen for in-app notifications of type "new_ride" to trigger the offer modal.
  useEffect(() => {
    if (!isOnline || !user || !session) return;

    // Listen for new ride notifications via realtime on the notifications table
    const channel = supabase
      .channel('driver-ride-offers')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        async (payload) => {
          try {
            const notif = payload.new as { type: string; ride_id: string | null };
            if (notif.type !== 'new_ride' || !notif.ride_id) return;
            if (currentRide || newRideAlertOpen) return; // already busy

            // Fetch the ride details
            const { data: ride, error } = await supabase
              .from('rides')
              .select('*')
              .eq('id', notif.ride_id)
              .eq('status', 'searching')
              .maybeSingle();

            if (error || !ride) return;

            console.log('[DriverDashboard] 🔔 Push-based ride offer:', ride.id);
              
            // Cache and show offer modal
            setCachedAlertRide(ride);
            setNewRideAlertRideId(ride.id);
            setNewRideAlertOpen(true);
            alertStartTimeRef.current = Date.now();

            toast({
              title: '🚗 NEW RIDE REQUEST!',
              description: 'A rider is looking for a driver now.',
            });

            if ('vibrate' in navigator) {
              (navigator as any).vibrate?.([300, 100, 300, 100, 500]);
            }
          } catch (err) {
            console.error('[DriverDashboard] Ride offer handler error:', err);
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

  // Fetch today's earnings and tips
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

      // Fetch charged tips for today
      const { data: tipRides } = await supabase
        .from('rides')
        .select('id, tip_amount, pickup_address, dropoff_address, dropoff_at, rider_id')
        .eq('driver_id', user.id)
        .eq('status', 'completed')
        .eq('tip_status', 'charged')
        .gt('tip_amount', 0)
        .gte('dropoff_at', today.toISOString())
        .order('dropoff_at', { ascending: false });

      if (tipRides && tipRides.length > 0) {
        const riderIds = [...new Set(tipRides.map(r => r.rider_id).filter(Boolean))] as string[];
        let riderNames: Record<string, string> = {};
        if (riderIds.length > 0) {
          const { data: profiles } = await supabase
            .from('profiles')
            .select('user_id, first_name, last_name')
            .in('user_id', riderIds);
          profiles?.forEach(p => {
            riderNames[p.user_id] = `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Rider';
          });
        }
        setTodayTips(tipRides.map(r => ({
          amount: Number(r.tip_amount),
          rider_name: r.rider_id ? (riderNames[r.rider_id] || 'Rider') : 'Rider',
          pickup: r.pickup_address,
          dropoff: r.dropoff_address,
          time: r.dropoff_at || '',
        })));
      } else {
        setTodayTips([]);
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

    // Stop the beep immediately and clear cached ride
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

      // Send OneSignal push notification to the rider
      (async () => {
        try {
          const { data: riderProfile } = await supabase
            .from('profiles')
            .select('onesignal_player_id')
            .eq('user_id', ride.rider_id)
            .maybeSingle();

          const playerId = riderProfile?.onesignal_player_id;
          if (!playerId) {
            console.log('[acceptRide] Rider has no OneSignal player ID, skipping push');
            return;
          }

          const { data: pushResp, error: pushErr } = await supabase.functions.invoke(
            'send-onesignal-notification',
            {
              body: {
                playerIds: [playerId],
                title: 'Driver Accepted 🚗',
                message: 'Your driver is on the way.',
              },
            }
          );

          if (pushErr) {
            console.error('[acceptRide] OneSignal push error:', pushErr);
          } else {
            console.log('[acceptRide] OneSignal push response:', pushResp);
          }
        } catch (e) {
          console.error('[acceptRide] OneSignal push exception:', e);
        }
      })();
    } catch (error) {
      console.error('[DriverDashboard] acceptRide error:', error);
      toast({ title: 'Error', description: 'Something went wrong. Please try again.', variant: 'destructive' });
    } finally {
      setBusyAction(null);
    }
  };

  const updateRideStatus = async (status: string) => {
    if (!currentRide || !user || busyAction) return;

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

    // Beep stops automatically when newRideAlertOpen is cleared
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

  // Beep is handled by DriverBeepFix component in render

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
    <div className="min-h-screen bg-background">

      <DriverBeepFix
        incomingRide={newRideAlertOpen && newRideAlertRideId ? { id: newRideAlertRideId } : null}
        onTimeout={() => {
          setNewRideAlertOpen(false);
          setCachedAlertRide(null);
          setNewRideAlertRideId(null);
          alertStartTimeRef.current = null;
        }}
        timeoutSeconds={25}
      />

      <RideOfferModal
        open={newRideAlertOpen}
        ride={alertRide}
        countdownSeconds={20}
        driverLocation={driverLocation}
        onDecline={() => {
          setNewRideAlertOpen(false);
          setCachedAlertRide(null);
          setNewRideAlertRideId(null);
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
        {/* Map - takes 65% on mobile, flex-[2] on desktop */}
        <div className="flex-[2] min-h-[60vh] lg:min-h-0 relative">
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
          

          {/* Floating Complete Ride Button removed - buttons now in Active Ride panel */}
        </div>

        {/* Driver Panel with Montreal background */}
        <motion.div
          initial={{ x: 100, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          className="w-full lg:w-[420px] border-l border-border flex flex-col relative overflow-hidden min-h-[40vh]"
        >
          {/* Background Image */}
          <div 
            className="absolute inset-0 bg-cover bg-center bg-no-repeat"
            style={{ backgroundImage: `url(${montrealDriverBg})` }}
          />
          {/* Dark overlay for readability */}
          <div className="absolute inset-0 bg-gradient-to-b from-background/90 via-background/85 to-background/95" />
          
          {/* Content container - relative to appear above background */}
          <div className="relative z-10 flex flex-col flex-1 overflow-hidden">
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

            <div className="p-4 flex-1 overflow-y-auto pb-8">

            {/* Go Online/Offline Button - Always visible at top */}
            <Button
                onClick={async () => {
                  await toggleOnlineStatus();
                }}
              className={`w-full h-14 text-lg font-bold mb-4 transition-all ${
                isOnline 
                  ? 'bg-destructive hover:bg-destructive/90 text-destructive-foreground' 
                  : 'gradient-primary'
              }`}
            >
              <Power className={`h-6 w-6 mr-3 ${isOnline ? '' : 'animate-pulse'}`} />
              {isOnline ? 'Go Offline' : 'Go Online'}
            </Button>

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

            {/* Profile and Inbox Buttons */}
            <div className="flex gap-2 mb-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setIsProfileModalOpen(true)}
              >
                <UserCircle className="h-5 w-5 mr-2" />
                Edit Profile
              </Button>
              <DriverInbox />
            </div>

            {/* Help / Contact Admin - Prominent Card */}
            <Card 
              className="mb-4 p-4 border-primary/40 bg-primary/10 cursor-pointer hover:bg-primary/20 transition-colors"
              onClick={() => setHelpDialogOpen(true)}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <HelpCircle className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm">
                    {language === 'fr' ? 'Besoin d\'aide ?' : 'Need Help?'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {language === 'fr' ? 'Contactez l\'équipe DriveMe' : 'Contact DriveMe Support'}
                  </p>
                </div>
                {unreadSupportMessages > 0 && (
                  <span className="h-6 w-6 bg-destructive text-destructive-foreground text-xs font-bold rounded-full flex items-center justify-center animate-pulse">
                    {unreadSupportMessages}
                  </span>
                )}
              </div>
            </Card>

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

            {/* Today's Tips Card */}
            {todayTips.length > 0 && (
              <Card className="mb-4 p-4 border-accent/20 bg-accent/5">
                <div className="flex items-center gap-2 mb-3">
                  <Gift className="h-5 w-5 text-accent" />
                  <h3 className="font-semibold text-sm">
                    {language === 'fr' ? 'Pourboires du jour' : "Today's Tips"}
                  </h3>
                  <span className="ml-auto font-bold text-accent">
                    {formatCurrency(todayTips.reduce((s, t) => s + t.amount, 0), language)}
                  </span>
                </div>
                <div className="space-y-2">
                  {todayTips.map((tip, i) => (
                    <div key={i} className="bg-background/60 rounded-lg p-2 text-xs space-y-1">
                      <div className="flex justify-between items-center">
                        <span className="font-medium">{tip.rider_name}</span>
                        <span className="font-bold text-accent">+{formatCurrency(tip.amount, language)}</span>
                      </div>
                      <div className="text-muted-foreground truncate">
                        <MapPin className="h-3 w-3 inline mr-1" />{tip.pickup} → {tip.dropoff}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Waiting for rides - push-only, no feed */}
            {isOnline && !currentRide && (
              <Card className="p-8 text-center border-dashed border-2 border-muted-foreground/20">
                <Navigation className="h-12 w-12 mx-auto mb-3 text-muted-foreground/40 animate-pulse" />
                <p className="font-medium text-muted-foreground">
                  {language === 'fr' ? 'En attente de courses...' : 'Waiting for ride offers...'}
                </p>
                <p className="text-sm text-muted-foreground/70 mt-1">
                  {language === 'fr' 
                    ? 'Vous recevrez une alerte quand une course est disponible'
                    : 'You\'ll get an alert when a ride is available nearby'}
                </p>
              </Card>
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