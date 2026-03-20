import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  MapPin, 
  Navigation, 
  Clock, 
  DollarSign, 
  User, 
  Phone,
  CheckCircle, 
  PlayCircle, 
  ExternalLink,
  AlertTriangle,
  Map,
  MessageSquare,
  XCircle
} from 'lucide-react';
import DriverNavigationMap from '@/components/DriverNavigationMap';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { formatCurrency, formatDistance, formatDuration } from '@/lib/pricing';
import { withTimeout } from '@/lib/withTimeout';
import { getValidAccessToken, SUPABASE_URL, ANON_KEY } from '@/lib/sessionRecovery';
import { persistRideStatus } from '@/lib/persistRideStatus';
import { fireSessionRefresh } from '@/lib/ensureFreshSession';
import DriverRideActionBar from '@/components/DriverRideActionBar';
/** Fire push notification to rider immediately (don't wait for DB trigger) */
const fireInstantPush = async (
  rideId: string,
  newStatus: string,
  oldStatus: string,
  riderId: string | null,
  driverId: string | null,
) => {
  try {
    const { error } = await supabase.functions.invoke('ride-status-push', {
      body: { ride_id: rideId, new_status: newStatus, old_status: oldStatus, rider_id: riderId, driver_id: driverId },
    });
    if (error) console.warn('[InstantPush] edge fn error:', error);
    else console.log('[InstantPush] sent for', newStatus);
  } catch (e) {
    console.warn('[InstantPush] failed (non-blocking):', e);
  }
};

const PLATFORM_FEE = 5.00;

interface ActiveRide {
  id: string;
  rider_id: string;
  driver_id: string;
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
  pickup_at: string | null;
}

interface RiderInfo {
  first_name: string | null;
  last_name: string | null;
  phone_number: string | null;
  avatar_url: string | null;
}

interface DriverActiveRidePanelProps {
  onRideCompleted?: () => void;
  onRideUpdated?: (ride: ActiveRide) => void;
}

const DriverActiveRidePanel = ({ onRideCompleted, onRideUpdated }: DriverActiveRidePanelProps) => {
  const { user, session } = useAuth();
  const { language } = useLanguage();
  const { toast } = useToast();
  const navigate = useNavigate();
  
  const [activeRide, setActiveRide] = useState<ActiveRide | null>(null);
  const [riderInfo, setRiderInfo] = useState<RiderInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [driverMismatch, setDriverMismatch] = useState<string | null>(null);
  const [showNavigation, setShowNavigation] = useState(false);
  const [driverLocation, setDriverLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [unreadMessages, setUnreadMessages] = useState(0);

  const driverId = session?.user?.id ?? user?.id;

  // Fetch active ride for the current driver
  const fetchActiveRide = useCallback(async () => {
    if (!driverId) {
      setIsLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('rides')
        .select('*')
        .eq('driver_id', driverId)
        .in('status', ['driver_assigned', 'driver_en_route', 'arrived', 'in_progress'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('[DriverActiveRidePanel] Error fetching ride:', error);
        setDriverMismatch(null);
        setActiveRide(null);
        return;
      }

      if (data) {
        // Double-check driver ownership
        if (data.driver_id !== driverId) {
          setDriverMismatch(`Driver mismatch: ride.driver_id=${data.driver_id}, currentDriverId=${driverId}`);
          setActiveRide(null);
          return;
        }

        // Never set completed/cancelled rides as active
        if (data.status === 'completed' || data.status === 'cancelled') {
          setActiveRide(null);
          setRiderInfo(null);
          setDriverMismatch(null);
          return;
        }
        
        setDriverMismatch(null);
        setActiveRide(data);
        onRideUpdated?.(data);

        // Fetch rider info
        const { data: riderData } = await supabase
          .from('profiles')
          .select('first_name, last_name, phone_number, avatar_url')
          .eq('user_id', data.rider_id)
          .single();

        if (riderData) {
          setRiderInfo(riderData);
        }
      } else {
        setActiveRide(null);
        setRiderInfo(null);
        setDriverMismatch(null);
      }
    } catch (err) {
      console.error('[DriverActiveRidePanel] Unexpected error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [driverId, onRideUpdated]);

  // Subscribe to unread messages count
  useEffect(() => {
    if (!activeRide?.id) {
      setUnreadMessages(0);
      return;
    }

    // Fetch initial count
    const fetchCount = async () => {
      const { data, error } = await supabase
        .from('ride_messages')
        .select('id')
        .eq('ride_id', activeRide.id)
        .eq('sender_role', 'rider');

      if (!error && data) {
        setUnreadMessages(data.length);
      }
    };

    fetchCount();

    // Subscribe to new messages
    const channel = supabase
      .channel(`driver-messages-badge-${activeRide.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'ride_messages',
          filter: `ride_id=eq.${activeRide.id}`,
        },
        (payload) => {
          if ((payload.new as any).sender_role === 'rider') {
            setUnreadMessages(prev => prev + 1);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeRide?.id]);

  // Initial fetch
  useEffect(() => {
    fetchActiveRide();
  }, [fetchActiveRide]);

  // Driver location is tracked by the parent (DriverDashboard's useDriverGPSStreaming)
  // No duplicate watchPosition here — use the driverLocation passed or fetched from map

  // Subscribe to ride updates
  useEffect(() => {
    if (!activeRide?.id) return;

    const channel = supabase
      .channel(`active-ride-panel-${activeRide.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'rides',
          filter: `id=eq.${activeRide.id}`,
        },
        (payload) => {
          const updated = payload.new as ActiveRide;
          
          if (updated.status === 'completed' || updated.status === 'cancelled') {
            setActiveRide(null);
            setRiderInfo(null);
            onRideCompleted?.();
          } else {
            setActiveRide(updated);
            onRideUpdated?.(updated);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeRide?.id, onRideCompleted, onRideUpdated]);

  // Start Ride action (transition from arrived -> in_progress)
  const startRide = async () => {
    if (!activeRide || !driverId || busyAction) return;
    fireSessionRefresh(); // non-blocking background refresh
    
    setBusyAction('start');
    const pickupAt = new Date().toISOString();
    setActiveRide({ ...activeRide, status: 'in_progress', pickup_at: pickupAt });
    onRideUpdated?.({ ...activeRide, status: 'in_progress', pickup_at: pickupAt });
    
    toast({
      title: language === 'fr' ? 'Course démarrée!' : 'Ride started!',
      description: language === 'fr' ? 'En route vers la destination.' : 'Heading to the destination.',
    });

    fireInstantPush(activeRide.id, 'in_progress', activeRide.status, activeRide.rider_id, driverId);

    const updates = { status: 'in_progress', pickup_at: pickupAt };

    try {
      const saved = await persistRideStatus({
        rideId: activeRide.id,
        expectedStatus: 'in_progress',
        updates,
        driverId,
        label: 'Start ride',
        maxAttempts: 3,
        baseDelayMs: 400,
        timeoutMs: 6000,
      });

      if (!saved) {
        console.warn('[DriverActiveRidePanel] startRide did not persist immediately, retrying');
        void retryDbWrite(activeRide.id, updates, 'in_progress');
      }
    } catch (err) {
      console.warn('[DriverActiveRidePanel] startRide failed, retrying:', err);
      void retryDbWrite(activeRide.id, updates, 'in_progress');
    } finally {
      setBusyAction(null);
    }
  };

  // Background retry for DB writes
  const retryDbWrite = useCallback(async (rideId: string, updates: Record<string, any>, expectedStatus?: string) => {
    const ok = await persistRideStatus({
      rideId,
      updates,
      expectedStatus: expectedStatus ?? String(updates.status ?? ''),
      driverId,
      label: `Retry status to ${expectedStatus ?? String(updates.status ?? '')}`,
      maxAttempts: 5,
      baseDelayMs: 1000,
      timeoutMs: 12000,
    });

    if (!ok) console.error('[DriverActiveRidePanel] retryDbWrite gave up', { rideId, expectedStatus, updates });
  }, [driverId]);

  // End Ride action (transition to completed)
  const endRide = async () => {
    if (!activeRide || !driverId || busyAction) return;
    
    setBusyAction('complete');
    const driverEarningsCalc = activeRide.estimated_fare - PLATFORM_FEE;
    const rideId = activeRide.id;
    const riderId = activeRide.rider_id;
    const prevStatus = activeRide.status;
    
    setActiveRide(null);
    setRiderInfo(null);
    onRideCompleted?.();
    
    toast({
      title: language === 'fr' ? 'Course terminée!' : 'Ride completed!',
      description: language === 'fr' 
        ? `Vous avez gagné ${formatCurrency(driverEarningsCalc, language)}`
        : `You earned ${formatCurrency(driverEarningsCalc, language)}`,
    });

    fireInstantPush(rideId, 'completed', prevStatus, riderId, driverId);

    const updates = {
      status: 'completed' as const,
      dropoff_at: new Date().toISOString(),
      actual_fare: activeRide.estimated_fare,
      driver_earnings: driverEarningsCalc,
    };

    // First try a fast direct REST update so the rider sees completion immediately on reopen.
    setBusyAction(null);
    getValidAccessToken().then(async (token) => {
      try {
        const response = await fetch(
          `${SUPABASE_URL}/rest/v1/rides?id=eq.${rideId}&driver_id=eq.${driverId}&select=id,status`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              apikey: ANON_KEY,
              Authorization: `Bearer ${token}`,
              Prefer: 'return=representation',
            },
            body: JSON.stringify(updates),
            keepalive: true,
          }
        );

        if (!response.ok) {
          throw new Error(`complete ride patch failed: ${response.status}`);
        }

        const rows = (await response.json().catch(() => [])) as Array<{ status?: string }>;
        if (rows[0]?.status === 'completed') return;

        void retryDbWrite(rideId, updates, 'completed');
      } catch {
        const saved = await persistRideStatus({
          rideId,
          expectedStatus: 'completed',
          updates,
          driverId,
          label: 'Complete ride',
          maxAttempts: 4,
          baseDelayMs: 500,
          timeoutMs: 7000,
        });

        if (!saved) void retryDbWrite(rideId, updates, 'completed');
      }
    }).catch(() => {
      void retryDbWrite(rideId, updates, 'completed');
    });
  };

  // Cancel Ride action
  const cancelRide = async () => {
    if (!activeRide || !driverId || busyAction) return;
    
    setBusyAction('cancel');
    const previousRide = { ...activeRide };
    const riderIdForNotif = activeRide.rider_id;
    const rideIdForNotif = activeRide.id;
    setActiveRide(null);
    setRiderInfo(null);
    onRideCompleted?.();
    
    toast({
      title: language === 'fr' ? 'Course annulée' : 'Ride cancelled',
      description: language === 'fr' ? 'La course a été annulée.' : 'The ride has been cancelled.',
      variant: 'destructive',
    });

    // Fire instant push (non-blocking)
    fireInstantPush(rideIdForNotif, 'cancelled', previousRide.status, riderIdForNotif, driverId);

    // IMPORTANT: Insert cancellation notification for the rider BEFORE updating ride status.
    // RLS policy drivers_can_notify_rider_for_assigned_rides requires ride to still be active.
    if (riderIdForNotif) {
      await supabase.from('notifications').insert({
        user_id: riderIdForNotif,
        ride_id: rideIdForNotif,
        type: 'ride_cancelled',
        title: language === 'fr' ? 'Course annulée ❌' : 'Ride Cancelled ❌',
        message: language === 'fr' ? 'Le chauffeur a annulé cette course.' : 'The driver cancelled this ride.',
      }).then(({ error: notifErr }) => {
        if (notifErr) console.warn('[DriverActiveRidePanel] Failed to insert cancel notification for rider:', notifErr);
        else console.log('[DriverActiveRidePanel] ✅ Cancellation notification inserted for rider');
      });
    }

    try {
      const { error } = await withTimeout(
        supabase
          .from('rides')
          .update({
            status: 'cancelled',
            cancelled_at: new Date().toISOString(),
            cancelled_by: driverId,
            cancellation_reason: 'Driver cancelled',
          })
          .eq('id', rideIdForNotif)
          .eq('driver_id', driverId)
          .then(r => r),
        7000, 'Cancel ride'
      );

      if (error) {
        setActiveRide(previousRide);
        toast({ title: 'Error', description: error.message, variant: 'destructive' });
      }
    } catch (err) {
      setActiveRide(previousRide);
      console.error('[DriverActiveRidePanel] cancelRide error:', err);
      toast({ title: 'Error', description: 'Network slow — try again.', variant: 'destructive' });
    } finally {
      setBusyAction(null);
    }
  };

  // Mark as arrived at pickup
  const markArrived = async () => {
    if (!activeRide || !driverId || busyAction) return;
    
    setBusyAction('arrived');
    setActiveRide({ ...activeRide, status: 'arrived' });
    onRideUpdated?.({ ...activeRide, status: 'arrived' });
    setShowNavigation(false);
    
    toast({
      title: language === 'fr' ? 'Arrivé!' : 'Arrived!',
      description: language === 'fr' 
        ? 'Le passager a été notifié de votre arrivée.' 
        : 'The rider has been notified of your arrival.',
    });

    fireInstantPush(activeRide.id, 'arrived', activeRide.status, activeRide.rider_id, driverId);

    const updates = { status: 'arrived' };

    try {
      const saved = await persistRideStatus({
        rideId: activeRide.id,
        expectedStatus: 'arrived',
        updates,
        driverId,
        label: 'Mark arrived',
        maxAttempts: 3,
        baseDelayMs: 400,
        timeoutMs: 6000,
      });

      if (!saved) {
        console.warn('[DriverActiveRidePanel] markArrived did not persist immediately, retrying');
        void retryDbWrite(activeRide.id, updates, 'arrived');
      }
    } catch (err) {
      console.warn('[DriverActiveRidePanel] markArrived failed, retrying:', err);
      void retryDbWrite(activeRide.id, updates, 'arrived');
    } finally {
      setBusyAction(null);
    }
  };

  // Open in Maps (Google Maps or Apple Maps deep link)
  const openInMaps = (lat: number, lng: number, label: string) => {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const url = isIOS
      ? `maps://maps.apple.com/?daddr=${lat},${lng}&q=${encodeURIComponent(label)}`
      : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    window.open(url, '_blank');
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'driver_assigned':
        return <Badge className="bg-primary/20 text-primary">Assigned</Badge>;
      case 'driver_en_route':
        return <Badge className="bg-warning/20 text-warning">En Route</Badge>;
      case 'arrived':
        return <Badge className="bg-accent/20 text-accent">Arrived</Badge>;
      case 'in_progress':
        return <Badge className="bg-success/20 text-success">In Progress</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const driverEarnings = activeRide ? activeRide.estimated_fare - PLATFORM_FEE : 0;

  // Loading state
  if (isLoading) {
    return null;
  }

  // Debug mismatch (dev only)
  if (driverMismatch && import.meta.env.DEV) {
    return (
      <Card className="p-4 mb-4 border-destructive bg-destructive/10">
        <div className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-5 w-5" />
          <span className="font-mono text-sm">{driverMismatch}</span>
        </div>
      </Card>
    );
  }

  // No active ride
  if (!activeRide) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-6"
    >
      <Card className="p-4 border-2 border-primary/50 bg-gradient-to-br from-primary/5 to-transparent">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-success animate-pulse" />
            <h2 className="font-display text-lg font-bold">
              {language === 'fr' ? 'Course Active' : 'Active Ride'}
            </h2>
          </div>
          {getStatusBadge(activeRide.status)}
        </div>

        {/* Rider Info */}
        {riderInfo && (
          <div className="flex items-center gap-3 mb-4 p-3 bg-muted/50 rounded-lg">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              {riderInfo.avatar_url ? (
                <img
                  src={riderInfo.avatar_url}
                  alt="Rider"
                  className="w-10 h-10 rounded-full object-cover"
                />
              ) : (
                <User className="h-5 w-5 text-primary" />
              )}
            </div>
            <div className="flex-1">
              <p className="font-semibold text-sm">
                {riderInfo.first_name} {riderInfo.last_name?.[0]}.
              </p>
              <p className="text-xs text-muted-foreground">
                {language === 'fr' ? 'Passager' : 'Rider'}
              </p>
            </div>
            {/* Call and Message buttons - phone number hidden */}
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={() => {
                if (riderInfo.phone_number) {
                  toast({
                    title: language === 'fr' 
                      ? `Appel de ${riderInfo.first_name}...` 
                      : `Calling ${riderInfo.first_name}...`,
                  });
                  setTimeout(() => {
                    window.location.href = `tel:${riderInfo.phone_number}`;
                  }, 500);
                }
              }}
              disabled={!riderInfo.phone_number}
            >
              <Phone className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1 relative"
              onClick={() => navigate(`/driver/messages?rideId=${activeRide.id}`)}
            >
              <MessageSquare className="h-4 w-4" />
              {unreadMessages > 0 && (
                <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center">
                  {unreadMessages > 9 ? '9+' : unreadMessages}
                </span>
              )}
            </Button>
          </div>
        )}

        {/* ====== PROMINENT MESSAGES BUTTON ====== */}
        <Button
          className="w-full mb-4 py-5 text-base font-bold bg-primary/10 border-2 border-primary text-primary hover:bg-primary hover:text-primary-foreground transition-all relative"
          onClick={() => navigate(`/driver/messages?rideId=${activeRide.id}`)}
        >
          <MessageSquare className="h-5 w-5 mr-2" />
          {language === 'fr' ? 'Ouvrir les Messages' : 'Open Messages'}
          {unreadMessages > 0 && (
            <Badge className="ml-2 bg-destructive text-destructive-foreground">
              {unreadMessages}
            </Badge>
          )}
        </Button>

        {/* Route Details — destination hidden until ride started */}
        <div className="space-y-2 mb-4">
          <div className="flex items-start gap-2">
            <MapPin className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground">{language === 'fr' ? 'Ramassage' : 'Pickup'}</p>
              <p className="text-sm font-medium truncate">{activeRide.pickup_address}</p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="shrink-0"
              onClick={() => openInMaps(activeRide.pickup_lat, activeRide.pickup_lng, 'Pickup')}
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
          </div>
          {activeRide.status === 'in_progress' && (
            <div className="flex items-start gap-2">
              <Navigation className="h-4 w-4 text-accent mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground">{language === 'fr' ? 'Destination' : 'Dropoff'}</p>
                <p className="text-sm font-medium truncate">{activeRide.dropoff_address}</p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="shrink-0"
                onClick={() => openInMaps(activeRide.dropoff_lat, activeRide.dropoff_lng, 'Dropoff')}
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
            </div>
          )}
          {activeRide.status !== 'in_progress' && (
            <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/30 border border-dashed border-muted-foreground/30">
              <Navigation className="h-4 w-4 text-muted-foreground shrink-0" />
              <p className="text-xs text-muted-foreground italic">
                {language === 'fr' 
                  ? 'Destination révélée après le démarrage de la course'
                  : 'Destination revealed after starting the ride'}
              </p>
            </div>
          )}
        </div>

        {/* Earnings — always visible; distance/duration only after ride started */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
          <span className="flex items-center gap-1 text-accent font-semibold">
            <DollarSign className="h-4 w-4" />
            {formatCurrency(driverEarnings, language)}
          </span>
          {activeRide.status === 'in_progress' && (
            <>
              <span className="flex items-center gap-1">
                <Navigation className="h-4 w-4" />
                {formatDistance(Number(activeRide.distance_km), language)}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-4 w-4" />
                {formatDuration(activeRide.estimated_duration_minutes, language)}
              </span>
            </>
          )}
        </div>

      </Card>

        {/* ===== RIDE ACTION BUTTONS - Outside card, always visible ===== */}
        <div className="mt-4 pb-4 space-y-3">
          {/* GPS Navigation Instruction Banner */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex items-center gap-3 p-4 rounded-xl border-2 border-primary bg-primary/10"
          >
            <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 animate-pulse">
              <Map className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1">
              <p className="font-bold text-sm text-primary">
                {language === 'fr' ? 'Ouvrir la navigation GPS' : 'Open GPS Navigation'}
              </p>
              <p className="text-xs text-muted-foreground">
                {language === 'fr' 
                  ? 'Appuyez ci-dessous pour démarrer la navigation vers le passager' 
                  : 'Tap below to start navigating to the rider'}
              </p>
            </div>
          </motion.div>

          {/* Open GPS Navigation - Always available, capture-phase tap for mobile */}
          <button
            type="button"
            className="w-full py-6 text-lg font-bold bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl flex items-center justify-center gap-2"
            style={{
              touchAction: 'manipulation',
              userSelect: 'none',
              WebkitUserSelect: 'none',
              WebkitTapHighlightColor: 'transparent',
            }}
            onPointerDownCapture={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setShowNavigation(true);
            }}
            onTouchStartCapture={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setShowNavigation(true);
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setShowNavigation(true);
            }}
          >
            <Map className="h-6 w-6" />
            {language === 'fr' ? 'Ouvrir Navigation GPS' : 'Open GPS Navigation'}
          </button>

          {/* All 4 action buttons — always visible, disabled when not applicable */}
          <DriverRideActionBar
            rideStatus={activeRide.status}
            onArrived={markArrived}
            onStartRide={startRide}
            onCompleteRide={endRide}
            onCancelRide={cancelRide}
            isUpdating={!!busyAction}
          />
        </div>

      {/* Fullscreen GPS Navigation Map */}
      {showNavigation && activeRide && (
        <DriverNavigationMap
          driverLocation={driverLocation}
          destination={
            activeRide.status === 'in_progress'
              ? { lat: activeRide.dropoff_lat, lng: activeRide.dropoff_lng, address: activeRide.dropoff_address }
              : { lat: activeRide.pickup_lat, lng: activeRide.pickup_lng, address: activeRide.pickup_address }
          }
          destinationType={activeRide.status === 'in_progress' ? 'dropoff' : 'pickup'}
          rideStatus={activeRide.status}
          hideDestination={activeRide.status !== 'in_progress'}
          isUpdating={!!busyAction}
          onClose={() => setShowNavigation(false)}
          onArrived={markArrived}
          onStartRide={startRide}
          onCompleteRide={endRide}
          onCancelRide={cancelRide}
          hasArrived={activeRide.status === 'arrived'}
        />
      )}

    </motion.div>
  );
};

export default DriverActiveRidePanel;
