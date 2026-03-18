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
import { consumePendingRide, onPendingRide } from '@/lib/pendingRideStore';
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

  const [isOnline, setIsOnline] = useState(true);
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
  
  // Refs to avoid stale closures in realtime/notification listeners
  const currentRideRef = useRef<RideRequest | null>(null);
  const newRideAlertOpenRef = useRef(false);
  const newRideAlertRideIdRef = useRef<string | null>(null);
  const lastHandledOfferIdRef = useRef<string | null>(null);

  // Keep refs in sync with state
  useEffect(() => { currentRideRef.current = currentRide; }, [currentRide]);
  useEffect(() => { newRideAlertOpenRef.current = newRideAlertOpen; }, [newRideAlertOpen]);
  useEffect(() => { newRideAlertRideIdRef.current = newRideAlertRideId; }, [newRideAlertRideId]);


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
    resetLocationError,
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
  
  // GPS error → non-blocking dismissible toast (never blocks UI)
  const lastGpsToastRef = useRef<string | null>(null);
  useEffect(() => {
    if (!gpsError) { lastGpsToastRef.current = null; return; }
    const key = `${gpsError.code}`;
    if (key === lastGpsToastRef.current) return;
    lastGpsToastRef.current = key;
    if (currentRide || newRideAlertOpen) return;
    toast({
      title: gpsError.code === 1 ? (language === 'fr' ? 'GPS refusé' : 'GPS Permission Denied')
        : gpsError.code === 2 ? (language === 'fr' ? 'Signal GPS perdu' : 'GPS Signal Lost')
        : (language === 'fr' ? 'GPS lent' : 'GPS Timeout'),
      description: language === 'fr' ? 'Appuyez sur Réessayer dans les paramètres' : 'Location access needed for tracking',
      variant: 'destructive',
    });
  }, [gpsError?.code, currentRide, newRideAlertOpen]);

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

  // Auto-online: driver should always be online when opening the app.
  // They only need to explicitly click "Go Offline" when done.
  const autoOnlineTriggeredRef = useRef(false);
  useEffect(() => {
    if (autoOnlineTriggeredRef.current) return;
    const userId = session?.user?.id;
    if (!userId) return;
    autoOnlineTriggeredRef.current = true;

    const goOnline = async () => {
      console.log('[DriverDashboard] Auto-setting driver online');
      const { error } = await supabase
        .from('driver_profiles')
        .update({ is_online: true })
        .eq('user_id', userId);
      if (!error) {
        setIsOnline(true);
      } else {
        console.error('[DriverDashboard] auto-online failed:', error);
        // Fallback: read current status from DB
        const { data } = await supabase
          .from('driver_profiles')
          .select('is_online')
          .eq('user_id', userId)
          .maybeSingle();
        setIsOnline(data?.is_online ?? false);
      }
    };
    goOnline();
  }, [session?.user?.id]);

  const touchDriverActivity = useCallback(async (reason: string) => {
    const driverUserId = session?.user?.id;
    if (!driverUserId) return;

    const now = new Date().toISOString();
    const hasCurrentRide = !!currentRideRef.current || !!currentRide;
    const driverStatus = hasCurrentRide ? 'on_trip' : (isOnline ? 'available' : 'offline');
    const currentScreen = hasCurrentRide ? 'ride' : 'dashboard';
    const displayName = user?.email || session?.user?.email || driverUserId;
    const presencePayload = {
      driver_id: driverUserId,
      last_seen: now,
      updated_at: now,
      status: driverStatus,
      current_screen: currentScreen,
      display_name: displayName,
    };

    try {
      const [profileRes, locationRes, presenceUpdateRes] = await Promise.all([
        supabase
          .from('driver_profiles')
          .update({ updated_at: now, is_online: isOnline })
          .eq('user_id', driverUserId),
        supabase
          .from('driver_locations')
          .update({ updated_at: now, is_online: isOnline })
          .eq('user_id', driverUserId),
        supabase
          .from('driver_presence')
          .update(presencePayload)
          .eq('driver_id', driverUserId)
          .select('id'),
      ]);

      if (profileRes.error) {
        console.warn('[DriverDashboard] driver activity profile touch failed:', profileRes.error);
      }
      if (locationRes.error) {
        console.warn('[DriverDashboard] driver activity location touch failed:', locationRes.error);
      }

      if (presenceUpdateRes.error) {
        console.warn('[DriverDashboard] driver presence update failed:', presenceUpdateRes.error);
      } else if (!presenceUpdateRes.data?.length) {
        const { error: presenceInsertError } = await supabase
          .from('driver_presence')
          .insert(presencePayload);
        if (presenceInsertError) {
          console.warn('[DriverDashboard] driver presence insert failed:', presenceInsertError);
        }
      }

      console.log(`[DriverDashboard] Driver activity touched (${reason})`);
    } catch (error) {
      console.warn('[DriverDashboard] driver activity touch failed:', error);
    }
  }, [session?.user?.id, session?.user?.email, user?.email, isOnline, currentRide]);

  useEffect(() => {
    if (!session?.user?.id) return;
    void touchDriverActivity('mount');
  }, [session?.user?.id, touchDriverActivity]);

  useEffect(() => {
    if (!session?.user?.id) return;

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void touchDriverActivity('visibilitychange');
      }
    };
    const handleFocus = () => void touchDriverActivity('focus');
    const handlePageShow = () => void touchDriverActivity('pageshow');

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('pageshow', handlePageShow);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, [session?.user?.id, touchDriverActivity]);

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

  // Safety guard: realtime subscription + aggressive polling to catch cancellations INSTANTLY.
  useEffect(() => {
    if (!currentRide?.id || !session?.user?.id) return;

    const rideId = currentRide.id;
    let cleared = false;

    const clearRide = (source: string) => {
      if (cleared) return;
      cleared = true;
      console.log(`[DriverDashboard] 🚫 Ride cleared (${source}):`, rideId);
      setCurrentRide(null);
      setRiderInfo(null);
      setShowGPSNavigation(false);
      toast({
        title: language === 'fr' ? 'Course annulée' : 'Ride cancelled',
        description: language === 'fr' ? 'Le passager a annulé cette course' : 'The rider cancelled this ride',
        variant: 'destructive',
      });
    };

    // Layer 1: Direct realtime subscription on the ride row itself
    const channel = supabase
      .channel(`active-ride-watch-${rideId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'rides',
          filter: `id=eq.${rideId}`,
        },
        (payload) => {
          const updated = payload.new as any;
          if (updated.status === 'cancelled' || updated.status === 'completed') {
            clearRide('realtime-ride-update: ' + updated.status);
          }
        }
      )
      .subscribe();

    // Layer 2: Aggressive polling every 2 seconds
    const validate = async () => {
      if (cleared) return;
      const { data } = await supabase
        .from('rides')
        .select('status')
        .eq('id', rideId)
        .maybeSingle();

      if (!data || data.status === 'completed' || data.status === 'cancelled') {
        clearRide('poll: ' + (data?.status || 'not found'));
      }
    };

    validate();
    const interval = window.setInterval(validate, 2000);

    return () => {
      cleared = true;
      window.clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [currentRide?.id, session?.user?.id]);

  // GPS location is now handled by useDriverGPSStreaming hook
  // The hook automatically tracks when isOnline or currentRide changes

  // Shared countdown constant — visual countdown in modal
  const COUNTDOWN_SECONDS = 25;
  // Max age we'll still recover an offer (gives driver time to open app)
  const MAX_OFFER_AGE_SECONDS = 90;

  // recoveredCountdown is kept for API compat but always null now (always fresh 25s)
  const [recoveredCountdown, setRecoveredCountdown] = useState<number | null>(null);

  // Recovery: check for pending new_ride notifications on mount/resume.
  // IMPORTANT: NOT gated on isOnline — driver may tap push before toggling online.
  // Uses session?.user?.id as primary (hydrates before useAuth's user), falls back to user?.id.
  useEffect(() => {
    // AUTH-GATE: Do NOT return early when userId is null.
    // We mount the effect unconditionally so the onAuthStateChange listener
    // can fire and trigger recovery once the session hydrates (cold start fix).
    const userId = session?.user?.id || user?.id;
    if (!userId) {
      console.log('[Recovery] ⏳ No userId yet — mounting auth listener to wait for SIGNED_IN');
    }
    let cancelled = false;

    const wasAlreadyHandled = (candidateId?: string | null) =>
      !!candidateId && candidateId === lastHandledOfferIdRef.current;

    const isCurrentlyDisplayed = (candidateId?: string | null) =>
      !!candidateId && !!newRideAlertOpenRef.current && newRideAlertRideIdRef.current === candidateId;

    /**
     * Show a ride offer from a ride_id (used by both recovery query and global store).
     * Returns true if successfully showed the modal.
     */
    const showOfferForRide = async (rideId: string, options?: { force?: boolean }): Promise<boolean> => {
      const force = options?.force ?? false;
      if (cancelled || !rideId || currentRideRef.current) return false;
      if (!force && wasAlreadyHandled(rideId)) {
        console.log('[Recovery] ⛔ Ignoring already-handled ride:', rideId);
        return false;
      }
      if (isCurrentlyDisplayed(rideId)) return false;

      const replacingOpenRide =
        !!newRideAlertOpenRef.current &&
        !!newRideAlertRideIdRef.current &&
        newRideAlertRideIdRef.current !== rideId;

      if (replacingOpenRide) {
        console.log('[Recovery] 🔄 Force-remounting modal for new ride:', rideId);
        setNewRideAlertOpen(false);
        setCachedAlertRide(null);
        setNewRideAlertRideId(null);
        newRideAlertOpenRef.current = false;
        newRideAlertRideIdRef.current = null;
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (cancelled || currentRideRef.current) return false;
      }

      const { data: ride, error: rideError } = await supabase
        .from('rides')
        .select('*')
        .eq('id', rideId)
        .eq('status', 'searching')
        .maybeSingle();

      if (rideError || !ride) {
        console.log('[Recovery] Ride not in searching status for', rideId);
        return false;
      }
      if (cancelled || currentRideRef.current || (!force && wasAlreadyHandled(ride.id)) || isCurrentlyDisplayed(ride.id)) return false;

      // Only reject if ride is truly expired (>90s). Visual countdown always starts fresh at 25s.
      const notifAge = (Date.now() - new Date(ride.requested_at || ride.created_at).getTime()) / 1000;
      if (notifAge > MAX_OFFER_AGE_SECONDS) {
        console.log('[Recovery] ⏰ Ride too old:', Math.round(notifAge), 's');
        return false;
      }

      // Always show a FRESH 25s countdown — the timer starts when the modal appears, not when the notification was created.
      console.log('[Recovery] ✅ Showing ride offer:', ride.id, '(age:', Math.round(notifAge), 's, visual countdown: FRESH 25s)');
      setRecoveredCountdown(null); // null = use full default countdown
      setCachedAlertRide(ride);
      setNewRideAlertRideId(ride.id);
      newRideAlertRideIdRef.current = ride.id;
      setNewRideAlertOpen(true);
      newRideAlertOpenRef.current = true;
      // Auto-dismiss reconnecting overlay so the modal is visible immediately
      setShowReconnect(false);
      alertStartTimeRef.current = Date.now() - (notifAge * 1000);
      return true;
    };

    /**
     * Core recovery check with forced session refresh.
     * Retry-ladder calls this at 100ms, 1500ms, 4000ms after activation.
     */
    const checkPendingOffers = async (attempt: number = 0) => {
      if (cancelled) return;

      const hasCurrentRide = !!currentRideRef.current;
      if (hasCurrentRide) {
        console.log(`[Recovery] ⏭️ Skipping (attempt ${attempt}) — active ride in progress`);
        return;
      }

      try {
        // STEP 0: Check localStorage / fast-path signal FIRST (works before auth hydrates)
        let lsRideId: string | null = null;
        try {
          lsRideId = localStorage.getItem('pendingRideFromPush') || (window as any).__FAST_PATH_RIDE_ID || null;
          if (lsRideId) {
            if (wasAlreadyHandled(lsRideId)) {
              console.log(`[Recovery] (attempt ${attempt}) ♻️ Ignoring stale local ride signal:`, lsRideId);
              localStorage.removeItem('pendingRideFromPush');
              if (localStorage.getItem('last_notified_ride') === lsRideId) {
                localStorage.removeItem('last_notified_ride');
              }
              if ((window as any).__FAST_PATH_RIDE_ID === lsRideId) {
                delete (window as any).__FAST_PATH_RIDE_ID;
              }
            } else if (!isCurrentlyDisplayed(lsRideId)) {
              console.log(`[Recovery] (attempt ${attempt}) 📱 Found local signal:`, lsRideId);
              const shown = await showOfferForRide(lsRideId);
              if (shown) return;
            }
          }
        } catch {
          // ignore localStorage errors
        }

        // SOFT AUTH: Try to get session but NEVER block — query anyway with ride_id
        let activeSession: any = null;
        try {
          const { data: { session: freshSession } } = await supabase.auth.getSession();
          activeSession = freshSession;
          if (!freshSession) {
            const { data: refreshed } = await supabase.auth.refreshSession();
            activeSession = refreshed?.session;
          }
        } catch {}

        const effectiveUserId = activeSession?.user?.id;
        console.log(`[Recovery] (attempt ${attempt}) Auth: ${effectiveUserId ? 'uid=' + effectiveUserId : 'NO SESSION — proceeding anyway'}`);

        // If we have a ride_id from localStorage, try direct fetch WITHOUT needing userId
        const lsDirectId = localStorage.getItem('pendingRideFromPush') || (window as any).__FAST_PATH_RIDE_ID;
        if (!effectiveUserId && lsDirectId && !wasAlreadyHandled(lsDirectId) && !isCurrentlyDisplayed(lsDirectId)) {
          console.log(`[Recovery] (attempt ${attempt}) 🚀 No auth yet — direct ride fetch for:`, lsDirectId);
          await showOfferForRide(lsDirectId);
          return;
        }
        if (!effectiveUserId) {
          console.log(`[Recovery] (attempt ${attempt}) No auth + no fresh ride_id — waiting for next tick`);
          return;
        }

        // STEP 2: Check global pending ride store (from push click before mount)
        const globalRideId = consumePendingRide();
        if (globalRideId) {
          if (wasAlreadyHandled(globalRideId)) {
            console.log(`[Recovery] (attempt ${attempt}) ♻️ Ignoring handled global ride:`, globalRideId);
          } else {
            console.log(`[Recovery] (attempt ${attempt}) 🌐 Found global pending ride:`, globalRideId);
            const shown = await showOfferForRide(globalRideId);
            if (shown) return;
          }
        }

        // STEP 3: Query unread notifications
        console.log(`[Recovery] (attempt ${attempt}) 🔍 Querying unread new_ride notifications for user: ${effectiveUserId}`);

        const { data: pending, error: notifError } = await supabase
          .from('notifications')
          .select('ride_id, created_at')
          .eq('user_id', effectiveUserId)
          .eq('type', 'new_ride')
          .eq('is_read', false)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (notifError) {
          console.warn(`[Recovery] ❌ (attempt ${attempt}) Notification query error:`, notifError.message);
          return;
        }

        if (!pending?.ride_id) {
          console.log(`[Recovery] (attempt ${attempt}) No unread new_ride notifications found`);
          return;
        }

        if (isCurrentlyDisplayed(pending.ride_id)) {
          console.log(`[Recovery] (attempt ${attempt}) ⏭️ Ride already displayed:`, pending.ride_id);
          return;
        }

        const shouldForceReopen = wasAlreadyHandled(pending.ride_id);
        if (shouldForceReopen) {
          console.log(`[Recovery] (attempt ${attempt}) 🔁 Unread ride still pending — forcing reopen:`, pending.ride_id);
        }

        const notifAge = (Date.now() - new Date(pending.created_at).getTime()) / 1000;
        console.log(`[Recovery] (attempt ${attempt}) 📋 Found notification — ride:`, pending.ride_id, 'age:', Math.round(notifAge), 's');

        if (notifAge > MAX_OFFER_AGE_SECONDS) {
          console.log(`[Recovery] ⏰ Expired (age: ${Math.round(notifAge)}s > ${MAX_OFFER_AGE_SECONDS}s) — marking read`);
          await supabase
            .from('notifications')
            .update({ is_read: true })
            .eq('ride_id', pending.ride_id)
            .eq('user_id', effectiveUserId)
            .eq('type', 'new_ride');
          return;
        }

        const shown = await showOfferForRide(pending.ride_id, { force: shouldForceReopen });
        if (!shown) {
          // Ride no longer searching — mark notification read to avoid re-querying
          console.log('[Recovery] Ride not available — marking notification read');
          await supabase
            .from('notifications')
            .update({ is_read: true })
            .eq('ride_id', pending.ride_id)
            .eq('user_id', effectiveUserId)
            .eq('type', 'new_ride');
        }
        // NOTE: Do NOT mark is_read here if shown — only mark read on accept/decline/timeout
      } catch (err) {
        console.warn(`[Recovery] (attempt ${attempt}) check failed:`, err);
      }
    };

    // ===== RETRY LADDER: High-frequency burst in first 3s =====
    console.log('[Recovery] 🚀 Effect mounted. userId:', userId || '(pending auth)');
    const BURST_SCHEDULE = [0, 500, 1500, 3000]; // 4 knocks in 3s
    const runLadder = () => {
      const timers: ReturnType<typeof setTimeout>[] = [];
      BURST_SCHEDULE.forEach((ms, i) => {
        timers.push(setTimeout(() => checkPendingOffers(i), ms));
      });
      return timers;
    };

    // ALWAYS run the ladder — even without userId (auth-free path uses ride_id directly)
    const initialTimers = runLadder();

    // Poll every 3 seconds as safety net — start immediately if authenticated,
    // otherwise the onAuthStateChange SIGNED_IN handler will start it.
    let intervalId = userId ? window.setInterval(() => checkPendingOffers(99), 3000) : 0;
    const ensurePolling = () => {
      if (!intervalId) {
        console.log('[Recovery] ▶️ Starting 3s polling interval (auth just arrived)');
        intervalId = window.setInterval(() => checkPendingOffers(99), 3000);
      }
    };

    // Listen for global store updates (push click while already mounted)
    const unsubGlobal = onPendingRide(async (rideId) => {
      console.log('[Recovery] 🌐 Global store event received:', rideId);
      await showOfferForRide(rideId);
    });

    // Force-clear stale state and re-check on app resume
    // Auto-retry GPS on resume to clear stale "GPS Permission Denied" banners
    const retryGeolocation = () => {
      try {
        navigator.geolocation?.getCurrentPosition(
          () => console.log('[Recovery] 📍 GPS re-acquired on resume'),
          (err) => console.log('[Recovery] 📍 GPS retry error on resume:', err.code),
          { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
        );
      } catch { /* ignore */ }
    };

    const resetAndRetry = (source: string) => {
      console.log(`[Recovery] 👁️ ${source} — clearing ALL stale state, force-refreshing session + retrying GPS + running retry ladder`);
      setRecoveredCountdown(null);
      // Force-clear BOTH refs AND state so useEffect sync doesn't overwrite back
      newRideAlertOpenRef.current = false;
      newRideAlertRideIdRef.current = null;
      setNewRideAlertOpen(false);
      setNewRideAlertRideId(null);
      setCachedAlertRide(null);
      // Auto-clear the GPS error banner so it doesn't block the UI on resume
      resetLocationError();
      // If a ride is active, force a GPS re-acquire so the navigation works immediately
      if (currentRide || currentRideRef.current) {
        try {
          navigator.geolocation.getCurrentPosition(() => {}, () => {}, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
        } catch (_) {}
      }
      // NOTE: Do NOT clear currentRideRef if there's an active ride in progress
      if (!currentRide) {
        currentRideRef.current = null;
      }
      supabase.auth.refreshSession().catch(() => {});
      retryGeolocation();
      runLadder();
    };

    const handleResume = () => {
      if (document.visibilityState === 'visible' || !document.hidden) {
        resetAndRetry('App resumed (visibilitychange)');
      }
    };
    const handleFocus = () => resetAndRetry('Window focused');
    const handlePageShow = () => resetAndRetry('pageshow fired');

    // Post-reconnection check: when auth transitions to SIGNED_IN, immediately check for rides
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (cancelled) return;
      console.log(`[Recovery] 🔐 Auth state changed: ${_event}, Session: ${newSession ? 'present' : 'null'}`);
      if (_event === 'SIGNED_IN' && newSession) {
        console.log('[Recovery] ✅ SIGNED_IN detected — running retry ladder + ensuring polling');
        ensurePolling();
        runLadder();
      }
      if (_event === 'TOKEN_REFRESHED' && newSession) {
        console.log('[Recovery] 🔄 TOKEN_REFRESHED — running single check');
        checkPendingOffers(50);
      }
    });

    document.addEventListener('visibilitychange', handleResume);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('pageshow', handlePageShow);

    return () => {
      cancelled = true;
      initialTimers.forEach(clearTimeout);
      if (intervalId) window.clearInterval(intervalId);
      unsubGlobal();
      authListener?.subscription?.unsubscribe();
      document.removeEventListener('visibilitychange', handleResume);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, [user?.id, session?.user?.id]);

  // Push-based ride offer listener — no polling, no feed.
  // Listen for in-app notifications of type "new_ride" to trigger the offer modal.
  // Use session user id first so the listener is active even if context hydration is slow.
  useEffect(() => {
    const userId = session?.user?.id || user?.id;
    if (!userId) return;

    const channelName = `driver-ride-offers-${userId}-${Date.now()}`;
    console.log('[Realtime] 📡 Subscribing to notifications channel:', channelName);

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        async (payload) => {
          try {
            const notif = payload.new as { type: string; ride_id: string | null };
            console.log('[Realtime] 📩 Notification received:', notif.type, notif.ride_id);

            // Handle ride_cancelled notifications — dismiss offer modal or clear active ride
            if (notif.type === 'ride_cancelled' && notif.ride_id) {
              console.log('[Realtime] 🚫 ride_cancelled for:', notif.ride_id);
              if (newRideAlertRideIdRef.current === notif.ride_id) {
                setNewRideAlertOpen(false);
                setCachedAlertRide(null);
                setNewRideAlertRideId(null);
                alertStartTimeRef.current = null;
              }
              if (currentRideRef.current?.id === notif.ride_id) {
                setCurrentRide(null);
                setRiderInfo(null);
                setShowGPSNavigation(false);
              }
              toast({
                title: language === 'fr' ? 'Course annulée' : 'Ride cancelled',
                description: language === 'fr' ? 'Le passager a annulé cette course' : 'The rider cancelled this ride',
                variant: 'destructive',
              });
              return;
            }

            if (notif.type !== 'new_ride' || !notif.ride_id) return;

            if (notif.ride_id === lastHandledOfferIdRef.current) {
              console.log('[Realtime] ♻️ Ignoring already-handled ride:', notif.ride_id);
              return;
            }

            if (currentRideRef.current) {
              console.log('[Realtime] ⏭️ Active ride in progress — ignoring new offer');
              return;
            }

            if (newRideAlertOpenRef.current && newRideAlertRideIdRef.current === notif.ride_id) {
              console.log('[Realtime] ⏭️ Same ride already open:', notif.ride_id);
              return;
            }

            const replacingOpenRide =
              !!newRideAlertOpenRef.current &&
              !!newRideAlertRideIdRef.current &&
              newRideAlertRideIdRef.current !== notif.ride_id;

            if (replacingOpenRide) {
              console.log('[Realtime] 🔄 Force-remounting modal for new ride:', notif.ride_id);
              setNewRideAlertOpen(false);
              setCachedAlertRide(null);
              setNewRideAlertRideId(null);
              newRideAlertOpenRef.current = false;
              newRideAlertRideIdRef.current = null;
              await new Promise((resolve) => setTimeout(resolve, 0));
              if (currentRideRef.current) return;
            }

            // Fetch the ride details
            const { data: ride, error } = await supabase
              .from('rides')
              .select('*')
              .eq('id', notif.ride_id)
              .eq('status', 'searching')
              .maybeSingle();

            if (error || !ride) {
              console.log('[Realtime] Ride not available:', error?.message || 'not searching');
              return;
            }

            console.log('[Realtime] 🔔 Showing ride offer from realtime:', ride.id);

            setCachedAlertRide(ride);
            setNewRideAlertRideId(ride.id);
            newRideAlertRideIdRef.current = ride.id;
            setNewRideAlertOpen(true);
            newRideAlertOpenRef.current = true;
            setShowReconnect(false); // Auto-dismiss reconnecting overlay
            setRecoveredCountdown(null); // fresh offer = full countdown
            alertStartTimeRef.current = Date.now();

            toast({
              title: '🚗 NEW RIDE REQUEST!',
              description: 'A rider is looking for a driver now.',
            });

            if ('vibrate' in navigator) {
              (navigator as any).vibrate?.([300, 100, 300, 100, 500]);
            }
          } catch (err) {
            console.error('[Realtime] Ride offer handler error:', err);
          }
        }
      )
      .subscribe((status) => {
        console.log('[Realtime] 📡 Channel status:', status);
      });

    return () => {
      console.log('[Realtime] 🔌 Removing channel:', channelName);
      supabase.removeChannel(channel);
    };
  }, [session?.user?.id, user?.id]);

  // Watch alerted ride for cancellation — dismiss modal if rider cancels
  // Uses BOTH realtime (may fail due to RLS on cancelled rows) AND polling fallback
  useEffect(() => {
    if (!newRideAlertRideId || !newRideAlertOpen) return;

    const dismissAlert = (reason: string) => {
      console.log('[DriverDashboard] Alerted ride dismissed:', reason);
      setNewRideAlertOpen(false);
      setCachedAlertRide(null);
      setNewRideAlertRideId(null);
      alertStartTimeRef.current = null;
    };

    // Realtime listener (works when RLS allows seeing the updated row)
    const channel = supabase
      .channel(`alert-ride-cancel-${newRideAlertRideId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'rides',
          filter: `id=eq.${newRideAlertRideId}`,
        },
        (payload) => {
          const updated = payload.new as any;
          if (updated.status === 'cancelled' || (updated.driver_id && updated.driver_id !== user?.id)) {
            dismissAlert('realtime: ' + updated.status);
            if (updated.status === 'cancelled') {
              toast({
                title: language === 'fr' ? 'Course annulée' : 'Ride cancelled',
                description: language === 'fr' ? 'Le passager a annulé cette course' : 'The rider cancelled this ride',
                variant: 'destructive',
              });
            }
          }
        }
      )
      .subscribe();

    // Polling fallback every 3s — catches cancellations that realtime misses
    // (driver RLS only allows SELECT on status='searching', so cancelled rows are invisible to realtime)
    const rideId = newRideAlertRideId;
    const pollInterval = setInterval(async () => {
      try {
        const { data, error } = await supabase
          .from('rides')
          .select('status, driver_id')
          .eq('id', rideId)
          .maybeSingle();

        // If ride is no longer visible (RLS blocks cancelled rows) or status changed
        if (error || !data || data.status !== 'searching' || (data.driver_id && data.driver_id !== user?.id)) {
          dismissAlert('poll: ' + (data?.status || 'not visible'));
          if (!data || data.status === 'cancelled' || (!data && !error)) {
            toast({
              title: language === 'fr' ? 'Course annulée' : 'Ride cancelled',
              description: language === 'fr' ? 'Le passager a annulé cette course' : 'The rider cancelled this ride',
              variant: 'destructive',
            });
          }
        }
      } catch (e) {
        // Network error — ignore, will retry next interval
      }
    }, 3000);

    return () => {
      clearInterval(pollInterval);
      supabase.removeChannel(channel);
    };
  }, [newRideAlertRideId, newRideAlertOpen, user?.id]);

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
          
          // Don't restore completed/cancelled rides — they're finished
          if (updatedRide.status === 'completed' || updatedRide.status === 'cancelled') {
            setCurrentRide(null);
            setRiderInfo(null);
            setShowGPSNavigation(false);
            if (updatedRide.status === 'cancelled') {
              toast({
                title: 'Ride cancelled',
                description: 'The rider cancelled this ride',
                variant: 'destructive',
              });
            }
            return;
          }
          
          setCurrentRide(updatedRide);
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
    if (!user) {
      console.warn('[DriverDashboard] toggleOnlineStatus: user not loaded yet, refreshing session...');
      // Try to recover the session
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          await supabase.auth.refreshSession();
        }
      } catch (e) {
        console.error('[DriverDashboard] session recovery failed:', e);
      }
      // Re-check after recovery attempt
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session?.user) {
        toast({ title: 'Session expired', description: 'Please log in again.', variant: 'destructive' });
        return;
      }
      // Use the recovered user for this toggle
      const recoveredUser = sessionData.session.user;
      try {
        const newStatus = !isOnline;
        const { error } = await supabase
          .from('driver_profiles')
          .update({ is_online: newStatus })
          .eq('user_id', recoveredUser.id);
        if (error) {
          toast({ title: 'Error', description: error.message, variant: 'destructive' });
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
        toast({ title: 'Error', description: 'Something went wrong.', variant: 'destructive' });
      }
      return;
    }

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

    console.log('[AcceptRide] START — ride.id:', ride.id, 'user.id:', user.id);

    // Pre-check: verify ride is still available before committing UI changes
    try {
      const { data: freshRide } = await supabase
        .from('rides')
        .select('status, driver_id')
        .eq('id', ride.id)
        .maybeSingle();

      if (!freshRide || freshRide.status !== 'searching' || freshRide.driver_id) {
        console.log('[AcceptRide] Ride no longer available:', freshRide?.status, freshRide?.driver_id);
        setNewRideAlertOpen(false);
        setCachedAlertRide(null);
        setNewRideAlertRideId(null);
        alertStartTimeRef.current = null;
        toast({
          title: language === 'fr' ? 'Course non disponible' : 'Ride unavailable',
          description: language === 'fr' ? 'Cette course a été annulée ou prise par un autre chauffeur' : 'This ride was cancelled or taken by another driver',
          variant: 'destructive',
        });
        return;
      }
    } catch {
      // If pre-check fails (network), proceed with acceptance attempt — DB constraints will catch it
    }

    // Stop the beep immediately and clear cached ride
    const acceptedRideId = ride.id;
    clearPendingRideMemory(acceptedRideId);
    setNewRideAlertOpen(false);
    setCachedAlertRide(null);
    setNewRideAlertRideId(null);
    newRideAlertOpenRef.current = false;
    newRideAlertRideIdRef.current = null;
    setRecoveredCountdown(null);
    setBusyAction('accept');

    // Mark notification as read so recovery doesn't re-find it
    if (acceptedRideId && user) {
      supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('ride_id', acceptedRideId)
        .eq('user_id', user.id)
        .eq('type', 'new_ride')
        .then(() => {});
    }

    try {
      // Calculate acceptance time for priority driver reward
      const acceptanceTimeSeconds = alertStartTimeRef.current 
        ? Math.floor((Date.now() - alertStartTimeRef.current) / 1000)
        : null;

      console.log('[AcceptRide] Calling RPC accept_ride with:', {
        p_ride_id: ride.id,
        p_driver_id: user.id,
        p_acceptance_time_seconds: acceptanceTimeSeconds,
      });

      // Use atomic direct update as primary method (bypasses RPC issues)
      const { data: updatedRows, error } = await withTimeout(
        supabase
          .from('rides')
          .update({
            driver_id: user.id,
            status: 'driver_assigned' as const,
            accepted_at: new Date().toISOString(),
            acceptance_time_seconds: acceptanceTimeSeconds,
          })
          .eq('id', ride.id)
          .eq('status', 'searching')
          .is('driver_id', null)
          .select('id, status, driver_id')
          .then(r => r),
        7000,
        'Accept ride'
      );

      console.log('[AcceptRide] Update result:', JSON.stringify({ data: updatedRows, error }));

      // If direct update failed (error or 0 rows due to RLS), use RPC fallback
      const directSuccess = !error && updatedRows && updatedRows.length > 0;
      
      if (!directSuccess) {
        console.log('[AcceptRide] Direct update did not succeed, trying RPC fallback...',
          JSON.stringify({ error, rowCount: updatedRows?.length }));
        
        const { data: rpcResult, error: rpcError } = await withTimeout(
          supabase.rpc('accept_ride', {
            p_ride_id: ride.id,
            p_driver_id: user.id,
            p_acceptance_time_seconds: acceptanceTimeSeconds,
          }),
          7000,
          'Accept ride RPC'
        );
        
        console.log('[AcceptRide] RPC result:', JSON.stringify({ rpcResult, rpcError }));
        
        if (rpcError || !rpcResult) {
          toast({
            title: 'Error',
            description: 'This ride is no longer available',
            variant: 'destructive',
          });
          return;
        }
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

      // Hard-reset GPS: force the browser to re-acquire a lock, clearing any stale 'denied' state
      resetLocationError();
      try {
        navigator.geolocation.getCurrentPosition(
          (pos) => console.log('[AcceptRide] GPS re-acquired after acceptance:', pos.coords.latitude, pos.coords.longitude),
          (err) => console.warn('[AcceptRide] GPS refresh after acceptance failed (non-blocking):', err.message),
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
      } catch (e) { /* ignore */ }

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

  const clearPendingRideMemory = useCallback((handledRideId?: string | null) => {
    if (handledRideId) {
      lastHandledOfferIdRef.current = handledRideId;
    }

    try {
      localStorage.removeItem('pendingRideFromPush');
      localStorage.removeItem('last_notified_ride');
      delete (window as any).__FAST_PATH_RIDE_ID;
    } catch {
      // ignore storage errors
    }
  }, []);

  // Shared cleanup function for accept/decline/timeout
  const cleanupOffer = (markRead: boolean = true) => {
    const rideId = newRideAlertRideIdRef.current || newRideAlertRideId;
    clearPendingRideMemory(rideId);

    // Clear BOTH state AND refs immediately to prevent race conditions
    setNewRideAlertOpen(false);
    setCachedAlertRide(null);
    setNewRideAlertRideId(null);
    newRideAlertOpenRef.current = false;
    newRideAlertRideIdRef.current = null;
    alertStartTimeRef.current = null;
    setRecoveredCountdown(null);

    if (markRead && rideId && user) {
      supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('ride_id', rideId)
        .eq('user_id', user.id)
        .eq('type', 'new_ride')
        .then(() => {});
    }
  };

  // CRITICAL: RideOfferModal + DriverBeepFix are rendered ONCE here, above all early returns,
  // so they are always mounted regardless of loading/reconnecting state.
  // Wrapped in a fixed container with z-[99999] and pointer-events:auto so it floats above
  // any "Reconnecting", "GPS Denied", or loading overlays.
  const globalModalLayer = (
    <div className="fixed inset-0 pointer-events-none" style={{ isolation: 'isolate', zIndex: 2147483647 }}>
      <DriverBeepFix
        incomingRide={newRideAlertOpen && newRideAlertRideId ? { id: newRideAlertRideId } : null}
        onTimeout={() => cleanupOffer(true)}
        timeoutSeconds={25}
      />
      <RideOfferModal
        open={newRideAlertOpen}
        ride={alertRide}
        countdownSeconds={recoveredCountdown ?? COUNTDOWN_SECONDS}
        driverLocation={driverLocation}
        onDecline={() => cleanupOffer(true)}
        onAccept={() => {
          setRecoveredCountdown(null);
          const rideToAccept = cachedAlertRide;
          if (!rideToAccept) return;
          cleanupOffer(false);
          acceptRide(rideToAccept);
        }}
      />
    </div>
  );

  // Loading states: never redirect while we are still restoring session/profile on iOS.
  const waitingForIdentity = !!session && profileLoading;

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        {globalModalLayer}
        <div className="animate-pulse text-muted-foreground">{t('common.loading')}</div>
      </div>
    );
  }

  if (waitingForIdentity) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        {globalModalLayer}
        {showReconnect ? (
          <Card className="w-full max-w-sm p-6 text-center">
            <div className="font-medium">Reconnecting…</div>
            <div className="mt-2 text-sm text-muted-foreground">
              We're keeping you signed in while we reload your driver account.
            </div>
            <div className="mt-5 flex flex-col gap-3">
              <Button onClick={async () => { await refreshSession(); await refreshDriverProfile(); }}>Retry now</Button>
              <Button variant="outline" onClick={() => window.location.reload()}>Reload page</Button>
            </div>
          </Card>
        ) : (
          <div className="animate-pulse text-muted-foreground">{t('common.loading')}</div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {globalModalLayer}
      <Navbar />
      
      <div className="pt-16 h-screen flex flex-col lg:flex-row">
        {/* Map - takes 65% on mobile, flex-[2] on desktop */}
        <div className="flex-[2] min-h-[60vh] lg:min-h-0 relative">
          <MapComponent
            key={currentRide?.id ?? 'idle'}
            pickup={currentRide ? { lat: currentRide.pickup_lat, lng: currentRide.pickup_lng } : null}
            dropoff={currentRide ? { lat: currentRide.dropoff_lat, lng: currentRide.dropoff_lng } : null}
            driverLocation={driverLocation}
              routeMode={
                currentRide
                  ? currentRide.status === 'in_progress'
                    ? 'driver-to-dropoff'
                    : 'driver-to-pickup'
                  : undefined
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
             {/* Banner stack — ONLY shown when idle (no active ride, no ride offer) */}
             {!currentRide && !newRideAlertOpen && (
               <div className="pt-4">
                 <DriverWakeLockBanner isOnline={isOnline} hasActiveRide={false} />
               </div>
             )}

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
                setShowGPSNavigation(false);
                void refreshDriverProfile();
              }}
              onRideUpdated={(ride) => {
                // Only sync if the ride is actually active — never restore completed/cancelled
                const activeStatuses = ['driver_assigned', 'driver_en_route', 'arrived', 'in_progress'];
                if (ride && activeStatuses.includes((ride as any).status)) {
                  setCurrentRide(ride as RideRequest);
                }
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