/**
 * GlobalRideOfferGuard
 * 
 * Mounted at the App.tsx root level (ABOVE all route guards and Suspense boundaries).
 * Detects a pending ride from a notification tap during cold start OR foreground push
 * and IMMEDIATELY shows the RideOfferModal — no loading screens, no auth wait.
 *
 * Dual-Path approach:
 * Path A (Cold Start): Reads localStorage before React renders → instant modal with skeleton data
 * Path B (Foreground): Persistent OneSignal listener fires setPendingRide → instant modal
 *
 * The modal renders instantly over a dark background. Ride data is enriched async.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { RideOfferModal } from '@/components/RideOfferModal';
import DriverBeepFix from '@/components/DriverBeepFix';
import { consumePendingRide, onPendingRide, setPendingRideFromNotification } from '@/lib/pendingRideStore';

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

/** Read pending ride ID from any source — runs synchronously */
function readPendingRideId(): string | null {
  try {
    return localStorage.getItem('pendingRideFromPush') ||
           localStorage.getItem('last_notified_ride') ||
           (window as any).__FAST_PATH_RIDE_ID || null;
  } catch { return null; }
}

export function GlobalRideOfferGuard() {
  // Immediately check for a pending ride — no useEffect delay
  const [rideId, setRideId] = useState<string | null>(() => {
    const id = readPendingRideId() || consumePendingRide();
    if (id) console.log('[GlobalGuard] 🚀 Instant rideId on mount:', id);
    return id;
  });

  const [ride, setRide] = useState<RideSummary | null>(null);
  // Open the modal IMMEDIATELY when we have a rideId, even before DB fetch
  const [open, setOpen] = useState<boolean>(() => !!readPendingRideId() || !!consumePendingRide());

  const resolvedRef = useRef(false);
  const mountedRef = useRef(true);
  const foregroundListenerRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // === PERSISTENT LISTENERS (never torn down until unmount) ===
  useEffect(() => {
    // --- Source 1: Global store listener (push click handler) ---
    const unsub = onPendingRide((id) => {
      if (!resolvedRef.current && mountedRef.current) {
        console.log('[GlobalGuard] 📩 Live push click received:', id);
        setRideId(id);
        setOpen(true);
      }
    });

    // --- Source 2: OneSignal foreground listener (persistent) ---
    const setupForegroundListener = () => {
      if (foregroundListenerRef.current) return;
      try {
        const OS = (window as any).OneSignal;
        if (OS?.Notifications?.addEventListener) {
          OS.Notifications.addEventListener('foregroundWillDisplay', (event: any) => {
            const data = event?.notification?.additionalData || {};
            console.log('[GlobalGuard] 🔔 Foreground notification:', data);
            if (data.ride_id && mountedRef.current) {
              resolvedRef.current = false; // Reset for new ride
              try {
                localStorage.setItem('pendingRideFromPush', data.ride_id);
                localStorage.setItem('last_notified_ride', data.ride_id);
              } catch { /* ignore */ }
              setPendingRideFromNotification(data.ride_id);
              setRide(null); // Clear stale ride data
              setRideId(data.ride_id);
              setOpen(true); // INSTANT open
            }
          });
          foregroundListenerRef.current = true;
          console.log('[GlobalGuard] ✅ Foreground listener registered');
        }
      } catch (e) {
        console.log('[GlobalGuard] Foreground listener setup deferred:', e);
      }
    };

    // Try immediately, retry at 1s, 3s, 6s (SDK may not be ready)
    setupForegroundListener();
    const t1 = setTimeout(setupForegroundListener, 1000);
    const t2 = setTimeout(setupForegroundListener, 3000);
    const t3 = setTimeout(setupForegroundListener, 6000);

    // --- Source 3: Visibilitychange — re-check localStorage when app resumes ---
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && mountedRef.current && !resolvedRef.current) {
        const id = readPendingRideId();
        if (id) {
          console.log('[GlobalGuard] 👁️ App resumed, found pending ride:', id);
          setRideId(id);
          setOpen(true);
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // --- Source 4: Auth state change — re-check on SIGNED_IN ---
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' && mountedRef.current && !resolvedRef.current) {
        const id = readPendingRideId();
        if (id) {
          console.log('[GlobalGuard] 🔑 Auth ready, found pending ride:', id);
          setRideId(id);
          setOpen(true);
        }
      }
    });

    return () => {
      unsub();
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      document.removeEventListener('visibilitychange', handleVisibility);
      subscription.unsubscribe();
    };
  }, []);

  // === ASYNC DATA ENRICHMENT — fetch ride details once we have a rideId ===
  useEffect(() => {
    if (!rideId || resolvedRef.current) return;

    let cancelled = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 20; // 20 × 500ms = 10s

    const tryFetch = async () => {
      if (cancelled || resolvedRef.current) return;
      attempts++;

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
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
          const age = (Date.now() - new Date(data.requested_at || data.created_at).getTime()) / 1000;
          if (age > 90) {
            console.log('[GlobalGuard] ⏰ Ride too old:', Math.round(age), 's');
            cleanup();
            return;
          }

          console.log('[GlobalGuard] ✅ Ride enriched on attempt', attempts);
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
          // Modal is already open — data will just populate
          return;
        }

        if (error) {
          console.log(`[GlobalGuard] Attempt ${attempts} error:`, error.message);
        }
      } catch (e) {
        console.log(`[GlobalGuard] Attempt ${attempts} exception:`, e);
      }

      if (attempts < MAX_ATTEMPTS && !cancelled) {
        setTimeout(tryFetch, 500);
      } else if (!cancelled) {
        console.log('[GlobalGuard] ❌ Max retries — clearing');
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
      delete (window as any).__FAST_PATH_RIDE_ID;
    } catch { /* ignore */ }
    setOpen(false);
    setRide(null);
    setRideId(null);
    resolvedRef.current = false;
  }, []);

  const handleAccept = useCallback(async () => {
    const targetRide = ride;
    const targetId = rideId;
    if (!targetId) { cleanup(); return; }

    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) {
      console.error('[GlobalGuard] Cannot accept — no auth session');
      cleanup();
      return;
    }

    try {
      // Try RPC first, fallback to direct update
      let accepted = false;
      try {
        const { data: rpcResult } = await supabase.rpc('accept_ride', {
          p_ride_id: targetId,
          p_driver_id: userId,
        });
        accepted = rpcResult === 'accepted' || rpcResult === targetId;
      } catch {
        // RPC unavailable — direct update
        const { data: updatedRows } = await supabase
          .from('rides')
          .update({
            driver_id: userId,
            status: 'driver_assigned' as const,
            accepted_at: new Date().toISOString(),
          })
          .eq('id', targetId)
          .eq('status', 'searching')
          .is('driver_id', null)
          .select('id');
        accepted = !!(updatedRows?.length);
      }

      if (accepted) {
        console.log('[GlobalGuard] ✅ Ride accepted:', targetId);
        try { localStorage.setItem('last_accepted_driver', userId); } catch {}
      } else {
        console.log('[GlobalGuard] Ride already taken');
      }

      // Mark notification read (fire and forget)
      supabase.from('notifications')
        .update({ is_read: true })
        .eq('ride_id', targetId)
        .eq('user_id', userId)
        .eq('type', 'new_ride')
        .then(() => {});

      // GPS wake-up
      try {
        navigator.geolocation.getCurrentPosition(() => {}, () => {}, {
          enableHighAccuracy: true, timeout: 10000, maximumAge: 0
        });
      } catch {}

    } catch (e) {
      console.error('[GlobalGuard] Accept error:', e);
    }

    cleanup();
    window.location.href = '/driver';
  }, [ride, rideId, cleanup]);

  const handleDecline = useCallback(() => {
    if (rideId) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.user?.id) {
          supabase.from('notifications')
            .update({ is_read: true })
            .eq('ride_id', rideId)
            .eq('user_id', session.user.id)
            .eq('type', 'new_ride')
            .then(() => {});
        }
      });
    }
    cleanup();
  }, [rideId, cleanup]);

  // === RENDER: Show immediately when rideId exists, even without enriched data ===
  if (!rideId && !open) return null;

  // Build a skeleton ride for the modal if real data hasn't loaded yet
  const displayRide = ride || (rideId ? {
    id: rideId,
    pickup_address: 'Loading pickup…',
    dropoff_address: 'Loading destination…',
    estimated_fare: 0,
  } : null);

  return (
    <div className="fixed inset-0 pointer-events-none" style={{ isolation: 'isolate', zIndex: 2147483647 }}>
      {/* Dark backdrop while map loads in background */}
      {open && !ride && (
        <div className="fixed inset-0 bg-black/90 pointer-events-auto" style={{ zIndex: 2147483646 }} />
      )}
      <DriverBeepFix
        incomingRide={open && displayRide ? { id: displayRide.id } : null}
        onTimeout={handleDecline}
        timeoutSeconds={25}
      />
      <RideOfferModal
        open={open}
        ride={displayRide}
        countdownSeconds={25}
        driverLocation={null}
        onDecline={handleDecline}
        onAccept={handleAccept}
      />
    </div>
  );
}
