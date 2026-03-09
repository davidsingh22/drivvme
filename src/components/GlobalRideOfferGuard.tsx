/**
 * GlobalRideOfferGuard — v3 "Total Reset"
 *
 * Mounted at App.tsx root ABOVE all route guards and Suspense.
 * NOTHING can block this from rendering — no auth wait, no loading gates.
 *
 * Hard-resets:
 * 1. Force-clear localStorage on every new beep before setting new ride_id
 * 2. Show modal IMMEDIATELY even if session is null (fetch ride without auth)
 * 3. z-index: 2147483647, position: fixed — nothing on top
 * 4. BroadcastChannel for cross-component instant sync
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { RideOfferModal } from '@/components/RideOfferModal';
import DriverBeepFix from '@/components/DriverBeepFix';
import { consumePendingRide, onPendingRide, setPendingRideFromNotification } from '@/lib/pendingRideStore';
import { onRideBroadcast, broadcastNewRide } from '@/lib/rideBroadcast';

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

/** Force-clear all stale state, then set new ride */
function forceInjectRide(rideId: string) {
  try {
    localStorage.removeItem('pendingRideFromPush');
    localStorage.removeItem('last_notified_ride');
    delete (window as any).__FAST_PATH_RIDE_ID;
  } catch {}
  try {
    localStorage.setItem('pendingRideFromPush', rideId);
    localStorage.setItem('last_notified_ride', rideId);
  } catch {}
  setPendingRideFromNotification(rideId);
}

/** Accept ride_id from multiple payload shapes (OneSignal web/native/realtime) */
function extractRideId(payload: any): string | null {
  if (!payload) return null;
  return (
    payload?.ride_id ||
    payload?.rideId ||
    payload?.data?.ride_id ||
    payload?.data?.rideId ||
    payload?.additionalData?.ride_id ||
    payload?.additionalData?.rideId ||
    null
  );
}

export function GlobalRideOfferGuard() {
  // Immediately check for a pending ride — no useEffect delay
  const [rideId, setRideId] = useState<string | null>(() => {
    const id = readPendingRideId() || consumePendingRide();
    if (id) console.log('[GlobalGuard] 🚀 Instant rideId on mount:', id);
    return id;
  });

  const [ride, setRide] = useState<RideSummary | null>(null);
  const [open, setOpen] = useState<boolean>(() => !!readPendingRideId());

  const lastHandledRef = useRef<string | null>(null);
  const lastSettledRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const foregroundListenerRef = useRef(false);
  const fetchCancelRef = useRef<(() => void) | null>(null);
  const openRef = useRef(open);
  const activeRideIdRef = useRef<string | null>(rideId);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    activeRideIdRef.current = rideId;
  }, [rideId]);

  /** Core handler: receives a new ride_id from ANY source */
  const handleNewRide = useCallback((id: string) => {
    if (!mountedRef.current || !id) return;

    if (id === lastSettledRef.current) {
      console.log('[GlobalGuard] ♻️ Ignoring settled ride replay:', id);
      return;
    }

    if (id === lastHandledRef.current && openRef.current) {
      return; // same ride already visible
    }

    console.log('[GlobalGuard] 🆕 New ride event:', id);
    lastHandledRef.current = id;

    // Cancel any in-flight fetch for a previous ride
    fetchCancelRef.current?.();

    // Force-clear + set
    forceInjectRide(id);

    const replacingRide =
      !!openRef.current &&
      !!activeRideIdRef.current &&
      activeRideIdRef.current !== id;

    // Reset all state for the new ride
    setRide(null);

    if (replacingRide) {
      setOpen(false);
      openRef.current = false;
      setRideId(null);
      activeRideIdRef.current = null;

      // Force remount for stale-state resistant transition
      setTimeout(() => {
        if (!mountedRef.current) return;
        setRideId(id);
        activeRideIdRef.current = id;
        setOpen(true);
        openRef.current = true;
      }, 0);
      return;
    }

    setRideId(id);
    activeRideIdRef.current = id;
    setOpen(true);
    openRef.current = true;
  }, []);

  // === PERSISTENT LISTENERS ===
  useEffect(() => {
    // Source 1: Global store listener (push click)
    const unsub1 = onPendingRide((id) => handleNewRide(id));

    // Source 2: BroadcastChannel (cross-component sync)
    const unsub2 = onRideBroadcast((id) => handleNewRide(id));

    // Source 3: OneSignal foreground listener
    const setupForegroundListener = () => {
      if (foregroundListenerRef.current) return;
      try {
        const OS = (window as any).OneSignal;
        if (OS?.Notifications?.addEventListener) {
          OS.Notifications.addEventListener('foregroundWillDisplay', (event: any) => {
            const notification = event?.notification || event?.result?.notification || event;
            const rideId = extractRideId(notification);
            if (rideId) {
              console.log('[GlobalGuard] 🔔 Foreground notification:', rideId);
              handleNewRide(rideId);
              broadcastNewRide(rideId);
            }
          });
          foregroundListenerRef.current = true;
          console.log('[GlobalGuard] ✅ Foreground listener registered');
        }
      } catch {}
    };
    setupForegroundListener();
    const t1 = setTimeout(setupForegroundListener, 1000);
    const t2 = setTimeout(setupForegroundListener, 3000);
    const t3 = setTimeout(setupForegroundListener, 6000);

    // Source 4: Visibility change — re-check on app resume
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && mountedRef.current) {
        const id = readPendingRideId();
        if (id) handleNewRide(id);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleVisibility);

    // Source 5: Auth state — re-check on SIGNED_IN
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' && mountedRef.current) {
        const id = readPendingRideId();
        if (id) handleNewRide(id);
      }
    });

    return () => {
      unsub1();
      unsub2();
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleVisibility);
      subscription.unsubscribe();
    };
  }, [handleNewRide]);

  // === ASYNC DATA ENRICHMENT — does NOT block modal display ===
  useEffect(() => {
    if (!rideId) return;

    let cancelled = false;
    fetchCancelRef.current = () => { cancelled = true; };

    let attempts = 0;
    const MAX_ATTEMPTS = 20;

    const tryFetch = async () => {
      if (cancelled) return;
      attempts++;

      try {
        // Try to get session, but DON'T block if it fails
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (!session) await supabase.auth.refreshSession();
        } catch {
          // Auth not ready — still try the query (RLS may allow it)
        }

        if (cancelled) return;

        const { data, error } = await supabase
          .from('rides')
          .select('id, pickup_address, dropoff_address, estimated_fare, distance_km, estimated_duration_minutes, pickup_lat, pickup_lng, status, requested_at, created_at')
          .eq('id', rideId)
          .eq('status', 'searching')
          .maybeSingle();

        if (cancelled) return;

        if (data) {
          const age = (Date.now() - new Date(data.requested_at || data.created_at).getTime()) / 1000;
          if (age > 90) {
            console.log('[GlobalGuard] ⏰ Ride too old:', Math.round(age), 's');
            cleanup();
            return;
          }

          console.log('[GlobalGuard] ✅ Ride enriched on attempt', attempts);
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
    const settledRideId = activeRideIdRef.current || rideId || lastHandledRef.current;
    if (settledRideId) {
      lastSettledRef.current = settledRideId;
    }

    try {
      localStorage.removeItem('pendingRideFromPush');
      localStorage.removeItem('last_notified_ride');
      delete (window as any).__FAST_PATH_RIDE_ID;
    } catch {}

    setOpen(false);
    openRef.current = false;
    setRide(null);
    setRideId(null);
    activeRideIdRef.current = null;
    fetchCancelRef.current = null;
  }, [rideId]);

  const handleAccept = useCallback(async () => {
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
      let accepted = false;
      try {
        const { data: rpcResult } = await supabase.rpc('accept_ride', {
          p_ride_id: targetId,
          p_driver_id: userId,
        });
        accepted = rpcResult === 'accepted' || rpcResult === targetId;
      } catch {
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

      supabase.from('notifications')
        .update({ is_read: true })
        .eq('ride_id', targetId)
        .eq('user_id', userId)
        .eq('type', 'new_ride')
        .then(() => {});

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
  }, [rideId, cleanup]);

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

  // === RENDER ===
  if (!rideId && !open) return null;

  const displayRide = ride || (rideId ? {
    id: rideId,
    pickup_address: 'Loading pickup…',
    dropoff_address: 'Loading destination…',
    estimated_fare: 0,
  } : null);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2147483647,
        isolation: 'isolate',
        pointerEvents: 'none',
      }}
    >
      {/* Dark backdrop while data loads */}
      {open && !ride && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.92)',
            zIndex: 2147483646,
            pointerEvents: 'auto',
          }}
        />
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
