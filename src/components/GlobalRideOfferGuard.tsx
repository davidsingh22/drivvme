/**
 * GlobalRideOfferGuard
 * 
 * Mounted at the App.tsx root level (ABOVE all route guards and Suspense boundaries).
 * Detects a pending ride from a notification tap during cold start and immediately
 * shows the RideOfferModal — bypassing auth loading, GPS guards, and lazy-loaded routes.
 *
 * Flow:
 * 1. On mount, checks localStorage for 'pendingRideFromPush' or 'last_notified_ride'
 * 2. Retries fetching the ride from DB every 500ms for up to 10s (auth may not be ready)
 * 3. Shows RideOfferModal the instant ride data is available
 * 4. On accept → navigates to /driver; on decline → clears state
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { RideOfferModal } from '@/components/RideOfferModal';
import DriverBeepFix from '@/components/DriverBeepFix';
import { consumePendingRide, onPendingRide } from '@/lib/pendingRideStore';

interface RideSummary {
  id: string;
  pickup_address: string;
  dropoff_address: string;
  estimated_fare: number;
  distance_km?: number;
  estimated_duration_minutes?: number;
  pickup_lat?: number;
  pickup_lng?: number;
}

export function GlobalRideOfferGuard() {
  const [rideId, setRideId] = useState<string | null>(null);
  const [ride, setRide] = useState<RideSummary | null>(null);
  const [open, setOpen] = useState(false);
  const resolvedRef = useRef(false);
  const mountedRef = useRef(true);

  // Check localStorage for pending ride on mount
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Detect pending ride from multiple sources
  useEffect(() => {
    // Source 1: localStorage signals
    const checkLocalStorage = () => {
      try {
        const id = localStorage.getItem('pendingRideFromPush') || 
                   localStorage.getItem('last_notified_ride');
        if (id && !resolvedRef.current) {
          console.log('[GlobalGuard] 🚀 Found pending ride in localStorage:', id);
          setRideId(id);
        }
      } catch { /* ignore */ }
    };

    checkLocalStorage();

    // Source 2: Global store (from OneSignal click handler)
    const globalId = consumePendingRide();
    if (globalId && !resolvedRef.current) {
      console.log('[GlobalGuard] 🌐 Found pending ride in global store:', globalId);
      setRideId(globalId);
    }

    // Source 3: Listen for future push clicks while mounted
    const unsub = onPendingRide((id) => {
      if (!resolvedRef.current && mountedRef.current) {
        console.log('[GlobalGuard] 📩 Live push click received:', id);
        setRideId(id);
      }
    });

    // Source 4: OneSignal foreground notification listener
    const setupForegroundListener = async () => {
      try {
        const OS = (window as any).OneSignal;
        if (OS?.Notifications?.addEventListener) {
          OS.Notifications.addEventListener('foregroundWillDisplay', (event: any) => {
            const data = event?.notification?.additionalData || {};
            console.log('[GlobalGuard] 🔔 Foreground notification:', data);
            if (data.ride_id && !resolvedRef.current && mountedRef.current) {
              try {
                localStorage.setItem('pendingRideFromPush', data.ride_id);
                localStorage.setItem('last_notified_ride', data.ride_id);
              } catch { /* ignore */ }
              setRideId(data.ride_id);
            }
          });
          console.log('[GlobalGuard] ✅ Foreground listener registered');
        }
      } catch (e) {
        console.log('[GlobalGuard] Foreground listener setup failed (non-fatal):', e);
      }
    };

    // Retry setting up foreground listener (SDK may not be ready yet)
    setupForegroundListener();
    const retryTimer = setTimeout(setupForegroundListener, 3000);

    return () => {
      unsub();
      clearTimeout(retryTimer);
    };
  }, []);

  // When we have a rideId, retry fetching ride data every 500ms for up to 10s
  useEffect(() => {
    if (!rideId || resolvedRef.current) return;

    let cancelled = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 20; // 20 * 500ms = 10s

    const tryFetch = async () => {
      if (cancelled || resolvedRef.current) return;
      attempts++;

      try {
        // Ensure auth session is available
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          // Try refresh
          await supabase.auth.refreshSession();
        }

        const { data, error } = await supabase
          .from('rides')
          .select('id, pickup_address, dropoff_address, estimated_fare, distance_km, estimated_duration_minutes, pickup_lat, pickup_lng, status, requested_at, created_at')
          .eq('id', rideId)
          .eq('status', 'searching')
          .maybeSingle();

        if (cancelled || resolvedRef.current) return;

        if (data) {
          // Check age — reject if > 90s old
          const age = (Date.now() - new Date(data.requested_at || data.created_at).getTime()) / 1000;
          if (age > 90) {
            console.log('[GlobalGuard] ⏰ Ride too old:', Math.round(age), 's — clearing');
            cleanup();
            return;
          }

          console.log('[GlobalGuard] ✅ Ride fetched on attempt', attempts, ':', data.id);
          resolvedRef.current = true;
          setRide({
            id: data.id,
            pickup_address: data.pickup_address,
            dropoff_address: data.dropoff_address,
            estimated_fare: data.estimated_fare,
            distance_km: data.distance_km ?? undefined,
            estimated_duration_minutes: data.estimated_duration_minutes ?? undefined,
            pickup_lat: data.pickup_lat ?? undefined,
            pickup_lng: data.pickup_lng ?? undefined,
          });
          setOpen(true);
          return;
        }

        if (error) {
          console.log(`[GlobalGuard] Attempt ${attempts} error:`, error.message);
        } else {
          console.log(`[GlobalGuard] Attempt ${attempts}: ride not found or not searching`);
        }
      } catch (e) {
        console.log(`[GlobalGuard] Attempt ${attempts} exception:`, e);
      }

      // Schedule next retry
      if (attempts < MAX_ATTEMPTS && !cancelled) {
        setTimeout(tryFetch, 500);
      } else if (!cancelled) {
        console.log('[GlobalGuard] ❌ Max retries reached — clearing pending ride');
        cleanup();
      }
    };

    tryFetch();

    return () => { cancelled = true; };
  }, [rideId]);

  const cleanup = useCallback(() => {
    try {
      localStorage.removeItem('pendingRideFromPush');
      localStorage.removeItem('last_notified_ride');
    } catch { /* ignore */ }
    setOpen(false);
    setRide(null);
    setRideId(null);
    resolvedRef.current = false;
  }, []);

  const handleAccept = useCallback(async () => {
    if (!ride) return;

    // Get current user
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) {
      console.error('[GlobalGuard] Cannot accept — no auth session');
      cleanup();
      return;
    }

    try {
      const { data: updatedRows, error } = await supabase
        .from('rides')
        .update({
          driver_id: userId,
          status: 'driver_assigned' as const,
          accepted_at: new Date().toISOString(),
        })
        .eq('id', ride.id)
        .eq('status', 'searching')
        .is('driver_id', null)
        .select('id')
        .then(r => r);

      if (error || !updatedRows?.length) {
        console.log('[GlobalGuard] Accept failed:', error?.message || 'ride taken');
      } else {
        console.log('[GlobalGuard] ✅ Ride accepted:', ride.id);
        // Store accepted ride for DriverDashboard to pick up
        try { localStorage.setItem('last_accepted_driver', userId); } catch {}
      }

      // Mark notification read
      supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('ride_id', ride.id)
        .eq('user_id', userId)
        .eq('type', 'new_ride')
        .then(() => {});

      // Hardware GPS wake-up
      try {
        navigator.geolocation.getCurrentPosition(() => {}, () => {}, {
          enableHighAccuracy: true, timeout: 10000, maximumAge: 0
        });
      } catch {}

    } catch (e) {
      console.error('[GlobalGuard] Accept error:', e);
    }

    cleanup();
    // Navigate to driver dashboard
    window.location.href = '/driver';
  }, [ride, cleanup]);

  const handleDecline = useCallback(() => {
    if (ride) {
      // Mark notification read
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.user?.id) {
          supabase
            .from('notifications')
            .update({ is_read: true })
            .eq('ride_id', ride.id)
            .eq('user_id', session.user.id)
            .eq('type', 'new_ride')
            .then(() => {});
        }
      });
    }
    cleanup();
  }, [ride, cleanup]);

  // Don't render anything if no pending ride
  if (!rideId && !open) return null;

  return (
    <div className="fixed inset-0 pointer-events-none" style={{ isolation: 'isolate', zIndex: 2147483647 }}>
      <DriverBeepFix
        incomingRide={open && ride ? { id: ride.id } : null}
        onTimeout={handleDecline}
        timeoutSeconds={25}
      />
      <RideOfferModal
        open={open}
        ride={ride ? {
          id: ride.id,
          pickup_address: ride.pickup_address,
          dropoff_address: ride.dropoff_address,
          estimated_fare: ride.estimated_fare,
          distance_km: ride.distance_km,
          estimated_duration_minutes: ride.estimated_duration_minutes,
          pickup_lat: ride.pickup_lat,
          pickup_lng: ride.pickup_lng,
        } : null}
        countdownSeconds={25}
        driverLocation={null}
        onDecline={handleDecline}
        onAccept={handleAccept}
      />
    </div>
  );
}
