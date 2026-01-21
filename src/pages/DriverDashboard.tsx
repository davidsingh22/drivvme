import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Power, MapPin, Navigation, DollarSign, Clock, Star, User, Phone, CheckCircle, XCircle, UserCircle, Bell } from 'lucide-react';
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

const PLATFORM_FEE = 5.00;

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
  const { user, session, roles, isDriver, driverProfile, refreshDriverProfile, isLoading: authLoading } = useAuth();
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
  const [driverLocation, setDriverLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);

  // Redirect if not logged in as driver
  useEffect(() => {
    if (authLoading) return;

    // Not authenticated
    if (!user) {
      navigate('/login', { replace: true });
      return;
    }

    // Wait until roles are loaded before deciding access
    if (roles.length === 0) return;

    if (!isDriver) {
      navigate('/', { replace: true });
    }
  }, [user, isDriver, roles.length, authLoading, navigate]);

  // Initialize driver status
  useEffect(() => {
    if (driverProfile) {
      setIsOnline(driverProfile.is_online);
    }
  }, [driverProfile]);

  // Get driver location
  useEffect(() => {
    if (!isOnline || !session) return;

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const location = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        setDriverLocation(location);
        
        // Update location in database
        if (user) {
          supabase
            .from('driver_profiles')
            .update({
              current_lat: location.lat,
              current_lng: location.lng,
            })
            .eq('user_id', user.id);
        }
      },
      (error) => console.error('Location error:', error),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [isOnline, user, session, currentRide, toast]);

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
        setAvailableRides(data);
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
        () => {
          // Reliable in-app fallback alert (works even when system push is flaky on mobile browsers)
          if (!currentRide) {
            toast({
              title: 'New ride request',
              description: 'A rider is looking for a driver now.',
            });

            if ('vibrate' in navigator) {
              // best-effort
              (navigator as any).vibrate?.([200, 100, 200]);
            }
          }
          fetchRides();
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

  const fetchRiderInfo = async (riderId: string) => {
    const { data } = await supabase
      .from('profiles')
      .select('first_name, last_name, phone_number, avatar_url')
      .eq('user_id', riderId)
      .single();

    if (data) {
      setRiderInfo(data);
    }
  };

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

    const { error } = await supabase
      .from('rides')
      .update({
        driver_id: user.id,
        status: 'driver_assigned',
        accepted_at: new Date().toISOString(),
      })
      .eq('id', ride.id)
      .eq('status', 'searching'); // Ensure ride is still available

    if (error) {
      toast({
        title: 'Error',
        description: 'This ride is no longer available',
        variant: 'destructive',
      });
      return;
    }

    setCurrentRide({ ...ride, status: 'driver_assigned' });
    await fetchRiderInfo(ride.rider_id);
    setAvailableRides((prev) => prev.filter((r) => r.id !== ride.id));

    // Insert in-app notification for rider (triggers real-time UI update)
    await supabase.from('notifications').insert({
      user_id: ride.rider_id,
      ride_id: ride.id,
      type: 'driver_assigned',
      title: 'Driver Found! 🚗',
      message: 'Your driver is on the way to pick you up.',
    });

    // Also send push notification to rider
    await sendPushNotification(
      ride.rider_id,
      'Driver Found! 🚗',
      'Your driver is on the way to pick you up.',
      '/ride'
    );

    toast({
      title: 'Ride accepted!',
      description: 'Navigate to pickup location',
    });
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
      updates.driver_earnings = currentRide.estimated_fare - PLATFORM_FEE;
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
      toast({
        title: 'Ride completed!',
        description: `You earned ${formatCurrency(currentRide.estimated_fare - PLATFORM_FEE, language)}`,
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

  const driverEarnings = currentRide ? currentRide.estimated_fare - PLATFORM_FEE : 0;

  // Only block on truly initial load - never block if we already have driver profile from cache
  // This prevents the loading screen from showing when drivers reopen the app
  if (!user && authLoading) {
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
            pickup={currentRide ? { lat: currentRide.pickup_lat, lng: currentRide.pickup_lng } : null}
            dropoff={currentRide ? { lat: currentRide.dropoff_lat, lng: currentRide.dropoff_lng } : null}
            driverLocation={driverLocation}
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
                onCheckedChange={toggleOnlineStatus}
                className="data-[state=checked]:bg-success"
              />
            </Card>
          </div>
        </div>

        {/* Driver Panel */}
        <motion.div
          initial={{ x: 100, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          className="w-full lg:w-[420px] bg-card border-l border-border flex flex-col"
        >
          <div className="p-6 flex-1 overflow-y-auto">
            {/* Profile Button */}
            <Button
              variant="outline"
              className="w-full mb-4"
              onClick={() => setIsProfileModalOpen(true)}
            >
              <UserCircle className="h-5 w-5 mr-2" />
              Edit Profile
            </Button>

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
              onClick={toggleOnlineStatus}
              className={`w-full h-16 text-lg font-bold mb-6 transition-all ${
                isOnline 
                  ? 'bg-destructive hover:bg-destructive/90 text-destructive-foreground' 
                  : 'gradient-primary'
              }`}
            >
              <Power className={`h-6 w-6 mr-3 ${isOnline ? '' : 'animate-pulse'}`} />
              {isOnline ? 'Go Offline' : 'Go Online'}
            </Button>

            {/* Today's Stats */}
            <div className="grid grid-cols-2 gap-4 mb-6">
              <Card className="p-4 bg-muted/50">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <DollarSign className="h-4 w-4" />
                  <span className="text-sm">{t('driver.earnings')}</span>
                </div>
                <p className="text-2xl font-bold text-accent">
                  {formatCurrency(todayEarnings, language)}
                </p>
              </Card>
              <Card className="p-4 bg-muted/50">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Navigation className="h-4 w-4" />
                  <span className="text-sm">{t('driver.totalRides')}</span>
                </div>
                <p className="text-2xl font-bold">{todayRides}</p>
              </Card>
            </div>

            <AnimatePresence mode="wait">
              {/* No Active Ride - Show Available Rides */}
              {!currentRide && (
                <motion.div
                  key="available"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <h2 className="font-display text-xl font-bold mb-4">
                    {isOnline ? 'Available Rides' : 'Go online to see rides'}
                  </h2>

                  {isOnline && availableRides.length === 0 && (
                    <div className="text-center py-12 text-muted-foreground">
                      <Navigation className="h-12 w-12 mx-auto mb-4 opacity-50" />
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
                              <span>-{formatCurrency(PLATFORM_FEE, language)}</span>
                            </div>
                            <div className="flex justify-between font-bold text-accent pt-2 border-t border-border">
                              <span>{t('driver.yourEarnings')}</span>
                              <span>{formatCurrency(Number(ride.estimated_fare) - PLATFORM_FEE, language)}</span>
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
                            >
                              <CheckCircle className="h-4 w-4 mr-2" />
                              {t('driver.accept')}
                            </Button>
                          </div>
                        </Card>
                      </motion.div>
                    ))}
                  </div>
                </motion.div>
              )}

              {/* Active Ride */}
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
                      <span>-{formatCurrency(PLATFORM_FEE, language)}</span>
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
                    {currentRide.status === 'in_progress' && (
                      <Button
                        className="w-full bg-success hover:bg-success/90 shadow-button py-6"
                        onClick={() => updateRideStatus('completed')}
                      >
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
          </div>
        </motion.div>
      </div>

      {/* Profile Edit Modal */}
      <DriverProfileModal 
        open={isProfileModalOpen} 
        onOpenChange={setIsProfileModalOpen} 
      />
    </div>
  );
};

export default DriverDashboard;