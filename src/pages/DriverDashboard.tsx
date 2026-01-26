import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Power, MapPin, Navigation, DollarSign, Clock, Star, User, Phone, CheckCircle, XCircle, UserCircle, Bell, Map } from 'lucide-react';
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
  const [showGPSNavigation, setShowGPSNavigation] = useState(false);

  const [newRideAlertOpen, setNewRideAlertOpen] = useState(false);
  const [newRideAlertRideId, setNewRideAlertRideId] = useState<string | null>(null);
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

  const alertRide = useMemo(() => {
    try {
      if (!newRideAlertRideId) return null;
      const ride = availableRides.find((r) => r.id === newRideAlertRideId);
      if (!ride) return null;
      
      // Defensive: validate ride has required fields
      if (!ride.pickup_address || !ride.dropoff_address) {
        console.warn('[DriverDashboard] Ride missing address fields:', ride.id);
        return null;
      }
      
      // Calculate pickup ETA based on driver location
      let pickupEtaMinutes: number | undefined;
      if (driverLocation && typeof ride.pickup_lat === 'number' && typeof ride.pickup_lng === 'number') {
        const distanceKm = calculateDistanceKm(
          driverLocation.lat, driverLocation.lng,
          ride.pickup_lat, ride.pickup_lng
        );
        pickupEtaMinutes = Math.ceil((distanceKm / 30) * 60); // 30km/h average
      }
      
      return {
        id: ride.id,
        pickup_address: ride.pickup_address || 'Unknown pickup',
        dropoff_address: ride.dropoff_address || 'Unknown destination',
        estimated_fare: ride.estimated_fare,
        distance_km: ride.distance_km,
        estimated_duration_minutes: ride.estimated_duration_minutes,
        pickup_eta_minutes: pickupEtaMinutes,
        is_priority: false,
      };
    } catch (err) {
      console.error('[DriverDashboard] Error computing alertRide:', err);
      return null;
    }
  }, [availableRides, newRideAlertRideId, driverLocation]);

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

  // Fetch available rides when online
  useEffect(() => {
    if (!isOnline || !user || !session) return;

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

          const newlyAdded = validRides.find((r) => !prevIds.has(r.id));
          prevRideIdsRef.current = nextIds;

          setAvailableRides(validRides);

          if (newlyAdded && !currentRide) {
            setNewRideAlertRideId(newlyAdded.id);
            setNewRideAlertOpen(true);
            alertStartTimeRef.current = Date.now();
            void playAlertSound();
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

  const sendPushNotification = async (userId: string, title: string, body: string, url?: string) => {
    try {
      await supabase.functions.invoke('send-push-notification', {
        body: { userId, title, body, url }
      });
    } catch (error) {
      console.error('Failed to send push notification:', error);
    }
  };

  const acceptRide = async (ride: RideRequest) => {
    if (!user) return;

    // Stop the alert sound immediately
    stopAlertSound();
    setNewRideAlertOpen(false);

    // Calculate acceptance time for priority driver reward
    const acceptanceTimeSeconds = alertStartTimeRef.current 
      ? Math.floor((Date.now() - alertStartTimeRef.current) / 1000)
      : null;

    const { error } = await supabase
      .from('rides')
      .update({
        driver_id: user.id,
        status: 'driver_assigned',
        accepted_at: new Date().toISOString(),
        acceptance_time_seconds: acceptanceTimeSeconds,
      })
      .eq('id', ride.id)
      .eq('status', 'searching');

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
      const priorityUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 minutes
      await supabase
        .from('driver_profiles')
        .update({ priority_driver_until: priorityUntil })
        .eq('user_id', user.id);

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

    sendPushNotification(
      ride.rider_id,
      'Driver Found! 🚗',
      'Your driver is on the way to pick you up.',
      '/ride'
    );
  };

  const updateRideStatus = async (status: string) => {
    if (!currentRide || !user) return;

    const updates: any = { status };

    if (status === 'driver_en_route') {
      // Already set when accepting
    } else if (status === 'arrived') {
      // Driver arrived at pickup
    } else if (status === 'in_progress') {
      updates.pickup_at = new Date().toISOString();
    } else if (status === 'completed') {
      updates.dropoff_at = new Date().toISOString();
      updates.actual_fare = currentRide.estimated_fare;
      const fee = calculatePlatformFee(currentRide.estimated_fare);
      updates.platform_fee = fee;
      updates.driver_earnings = currentRide.estimated_fare - fee;
    }

    const { error } = await supabase
      .from('rides')
      .update(updates)
      .eq('id', currentRide.id);

    if (error) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }

    // Send push notification to rider based on status
    const notifications: Record<string, { title: string; body: string }> = {
      driver_en_route: { title: 'Driver On The Way 🚗', body: 'Your driver is heading to your pickup location.' },
      arrived: { title: 'Driver Has Arrived! 📍', body: 'Your driver is waiting at the pickup location.' },
      in_progress: { title: 'Ride Started 🎉', body: 'Enjoy your trip!' },
      completed: { title: 'Ride Completed ✅', body: 'Thanks for riding with DrivvMe!' },
    };

    if (notifications[status]) {
      await sendPushNotification(
        currentRide.rider_id,
        notifications[status].title,
        notifications[status].body,
        '/ride'
      );
    }

    if (status === 'completed') {
      const fee = calculatePlatformFee(currentRide.estimated_fare);
      toast({
        title: 'Ride completed!',
        description: `You earned ${formatCurrency(currentRide.estimated_fare - fee, language)}`,
      });
      setCurrentRide(null);
      setRiderInfo(null);
      await refreshDriverProfile();
    } else {
      setCurrentRide((prev) => prev ? { ...prev, status } : null);
    }
  };

  const cancelRide = async () => {
    if (!currentRide || !user) return;

    const { error } = await supabase
      .from('rides')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancelled_by: user.id,
        cancellation_reason: 'Cancelled by driver',
        driver_id: null,
      })
      .eq('id', currentRide.id);

    if (error) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }

    toast({ title: 'Ride cancelled' });
    setCurrentRide(null);
    setRiderInfo(null);
  };

  const currentRideFee = currentRide ? calculatePlatformFee(currentRide.estimated_fare) : 0;
  const driverEarnings = currentRide ? currentRide.estimated_fare - currentRideFee : 0;

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
            We’re keeping you signed in while we reload your driver account.
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

      <RideOfferModal
        open={newRideAlertOpen}
        ride={alertRide}
        countdownSeconds={20}
        onDecline={() => {
          setNewRideAlertOpen(false);
          stopAlertSound();
          alertStartTimeRef.current = null;
        }}
        onAccept={() => {
          if (alertRide) {
            const ride = availableRides.find((r) => r.id === alertRide.id);
            if (ride) {
              acceptRide(ride);
            }
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

        {/* Driver Panel */}
        <motion.div
          initial={{ x: 100, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          className="w-full lg:w-[420px] bg-card border-l border-border flex flex-col"
        >
          {/* Wake Lock Banner - Keep screen awake while driving */}
          <div className="pt-4">
            <DriverWakeLockBanner isOnline={isOnline} hasActiveRide={!!currentRide} />
            
            {/* GPS Status Indicator - Always visible during trip/online (DB is source-of-truth) */}
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
              <Button
                className="w-full mb-4 py-6 text-lg font-bold bg-primary hover:bg-primary/90"
                onClick={() => setShowGPSNavigation(true)}
              >
                <Map className="h-6 w-6 mr-3" />
                {language === 'fr' ? 'Ouvrir Navigation GPS' : 'Open GPS Navigation'}
              </Button>
            )}

            {/* Profile and Inbox Buttons */}
            <div className="flex gap-2 mb-4">
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
                        if (!ok) return;

                        const { data, error } = await supabase.functions.invoke('send-push-notification', {
                          body: {
                            userId: user?.id,
                            title: 'Driver alerts enabled',
                            body: 'You will receive new ride request notifications.',
                            url: '/driver',
                          },
                        });

                        if (error) {
                          toast({ title: 'Test notification failed', description: error.message, variant: 'destructive' });
                          return;
                        }

                        if (!data?.sent) {
                          toast({
                            title: 'Not subscribed yet',
                            description: 'No subscription found for this device. Try enabling again.',
                            variant: 'destructive',
                          });
                          return;
                        }

                        toast({ title: 'Test notification sent' });
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

            {/* Current Active Ride - Always shown at top when exists */}
            <AnimatePresence>
              {currentRide && (
                <motion.div
                  key="active"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="space-y-6"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
                    <h2 className="font-display text-xl font-bold">
                      {currentRide.status === 'driver_assigned' && 'Go to pickup'}
                      {currentRide.status === 'driver_en_route' && 'On the way'}
                      {currentRide.status === 'arrived' && 'Waiting for rider'}
                      {currentRide.status === 'in_progress' && 'Ride in progress'}
                    </h2>
                  </div>

                  {/* Rider Info */}
                  {riderInfo && (
                    <Card className="p-4">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                          {riderInfo.avatar_url ? (
                            <img
                              src={riderInfo.avatar_url}
                              alt="Rider"
                              className="w-12 h-12 rounded-full object-cover"
                            />
                          ) : (
                            <User className="h-6 w-6 text-primary" />
                          )}
                        </div>
                        <div className="flex-1">
                          <h3 className="font-semibold">
                            {riderInfo.first_name} {riderInfo.last_name?.[0]}.
                          </h3>
                          {riderInfo.phone_number && (
                            <a
                              href={`tel:${riderInfo.phone_number}`}
                              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"
                            >
                              <Phone className="h-3 w-3" />
                              {riderInfo.phone_number}
                            </a>
                          )}
                        </div>
                      </div>
                    </Card>
                  )}

                  {/* Route Details */}
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <MapPin className="h-5 w-5 text-primary mt-0.5" />
                      <div>
                        <p className="text-sm text-muted-foreground">Pickup</p>
                        <p className="font-medium">{currentRide.pickup_address}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Navigation className="h-5 w-5 text-accent mt-0.5" />
                      <div>
                        <p className="text-sm text-muted-foreground">Destination</p>
                        <p className="font-medium">{currentRide.dropoff_address}</p>
                      </div>
                    </div>
                  </div>

                  {/* Earnings */}
                  <Card className="p-4 bg-muted/50">
                    <div className="flex justify-between text-sm mb-1">
                      <span>Fare</span>
                      <span>{formatCurrency(Number(currentRide.estimated_fare), language)}</span>
                    </div>
                    <div className="flex justify-between text-sm text-destructive mb-1">
                      <span>{t('driver.platformFee')}</span>
                      <span>-{formatCurrency(currentRideFee, language)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-accent pt-2 border-t border-border">
                      <span>{t('driver.yourEarnings')}</span>
                      <span>{formatCurrency(driverEarnings, language)}</span>
                    </div>
                  </Card>

                  {/* Action Buttons */}
                  <div className="space-y-3">
                    {currentRide.status === 'driver_assigned' && (
                      <Button
                        className="w-full gradient-primary shadow-button py-6"
                        onClick={() => updateRideStatus('driver_en_route')}
                      >
                        Start Navigation
                      </Button>
                    )}
                    {currentRide.status === 'driver_en_route' && (
                      <Button
                        className="w-full gradient-primary shadow-button py-6"
                        onClick={() => updateRideStatus('arrived')}
                      >
                        {t('driver.arrived')}
                      </Button>
                    )}
                    {currentRide.status === 'arrived' && (
                      <Button
                        className="w-full gradient-primary shadow-button py-6"
                        onClick={() => updateRideStatus('in_progress')}
                      >
                        {t('driver.startRide')}
                      </Button>
                    )}
                    
                    {/* End Ride Button - Always visible during any active ride */}
                    {['driver_assigned', 'driver_en_route', 'arrived', 'in_progress'].includes(currentRide.status) && (
                      <Button
                        className="w-full bg-success hover:bg-success/90 shadow-button py-6 text-lg font-bold"
                        onClick={() => updateRideStatus('completed')}
                      >
                        <CheckCircle className="h-6 w-6 mr-2" />
                        {t('driver.completeRide')}
                      </Button>
                    )}

                    {(currentRide.status === 'driver_assigned' || currentRide.status === 'driver_en_route') && (
                      <Button
                        variant="outline"
                        className="w-full text-destructive border-destructive/50"
                        onClick={cancelRide}
                      >
                        Cancel Ride
                      </Button>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Available Rides Section - Always visible when online */}
            {isOnline && (
              <div className={currentRide ? 'mt-8 pt-6 border-t border-border' : ''}>
                <h2 className="font-display text-xl font-bold mb-4">
                  {currentRide ? 'Other Available Rides' : 'Available Rides'}
                </h2>

                {availableRides.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    <Navigation className="h-10 w-10 mx-auto mb-3 opacity-50" />
                    <p>No rides available nearby</p>
                    <p className="text-sm">New requests will appear here</p>
                  </div>
                )}

                <div className="space-y-4">
                  {availableRides.map((ride) => (
                    <motion.div
                      key={ride.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                    >
                      <Card className="p-4 border-primary/20 hover:border-primary/50 transition-colors">
                        <div className="space-y-3 mb-4">
                          <div className="flex items-start gap-2">
                            <MapPin className="h-4 w-4 text-primary mt-1" />
                            <p className="text-sm line-clamp-1">{ride.pickup_address}</p>
                          </div>
                          <div className="flex items-start gap-2">
                            <Navigation className="h-4 w-4 text-accent mt-1" />
                            <p className="text-sm line-clamp-1">{ride.dropoff_address}</p>
                          </div>
                        </div>

                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-4 text-sm text-muted-foreground">
                            <span>{formatDistance(Number(ride.distance_km), language)}</span>
                            <span>{formatDuration(ride.estimated_duration_minutes, language)}</span>
                          </div>
                        </div>

                        {/* Earnings breakdown */}
                        <div className="p-3 bg-muted/50 rounded-lg mb-4">
                          <div className="flex justify-between text-sm mb-1">
                            <span>Fare</span>
                            <span>{formatCurrency(Number(ride.estimated_fare), language)}</span>
                          </div>
                          <div className="flex justify-between text-sm text-destructive mb-1">
                            <span>{t('driver.platformFee')}</span>
                            <span>-{formatCurrency(calculatePlatformFee(Number(ride.estimated_fare)), language)}</span>
                          </div>
                          <div className="flex justify-between font-bold text-accent pt-2 border-t border-border">
                            <span>{t('driver.yourEarnings')}</span>
                            <span>{formatCurrency(Number(ride.estimated_fare) - calculatePlatformFee(Number(ride.estimated_fare)), language)}</span>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            variant="outline"
                            className="text-destructive border-destructive/50"
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
                  ))}
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
        </motion.div>
      </div>

      {/* Profile Edit Modal */}
      <DriverProfileModal 
        open={isProfileModalOpen} 
        onOpenChange={setIsProfileModalOpen} 
      />

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
          onClose={() => setShowGPSNavigation(false)}
        />
      )}
    </div>
  );
};

export default DriverDashboard;