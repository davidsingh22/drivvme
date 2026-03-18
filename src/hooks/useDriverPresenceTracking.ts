import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

const HEARTBEAT_MS = 15_000;
const OFFLINE_AFTER_MS = 60_000;

/**
 * Fires a single, minimal upsert into driver_presence the INSTANT a user id
 * is available — no GPS, no session validation, no profile enrichment.
 * This is the "first packet" that makes the driver appear online in MSN < 1s.
 */
async function fireInstantPresence(userId: string) {
  console.log("DRIVER PRESENCE SENT", new Date().toISOString());

  const now = new Date().toISOString();
  // Fire all 3 tables in parallel — minimal payload, no blocking deps
  // presence table uses DB trigger for timestamps; other tables still use client time
  const [dpRes, pRes, dlRes] = await Promise.all([
    supabase.from('driver_presence').upsert(
      {
        driver_id: userId,
        status: 'available',
        last_seen: now,
        updated_at: now,
        current_screen: 'dashboard',
      },
      { onConflict: 'driver_id' }
    ),
    supabase.from('presence').upsert(
      {
        user_id: userId,
        role: 'DRIVER',
        source: 'web',
      },
      { onConflict: 'user_id' }
    ),
    supabase.from('driver_locations').upsert(
      {
        driver_id: userId,
        user_id: userId,
        lat: 45.5017,
        lng: -73.5673,
        is_online: true,
        updated_at: now,
      },
      { onConflict: 'driver_id' }
    ),
  ]);

  if (dpRes.error) console.warn('[DriverPresence] driver_presence error:', dpRes.error.message);
  if (pRes.error) console.warn('[DriverPresence] presence error:', pRes.error.message);
  if (dlRes.error) console.warn('[DriverPresence] driver_locations error:', dlRes.error.message);
}

/**
 * Global driver presence tracker — runs at App level.
 * Priority #1: fire instant presence the moment user.id is known.
 * Priority #2: enrich with profile data on subsequent heartbeats.
 */
export function useDriverPresenceTracking() {
  const { user, profile, roles, authLoading, driverProfile } = useAuth();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const offlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const instantFiredRef = useRef<string | null>(null);

  const isDriver = !!user?.id && (roles.includes('driver') || (() => {
    try { return localStorage.getItem('last_route') === '/driver'; } catch { return false; }
  })());

  // ── INSTANT FIRE: runs the moment user.id + isDriver are truthy ──
  // No waiting for authLoading, profile, GPS, session validation — nothing.
  useEffect(() => {
    if (!user?.id || !isDriver) return;
    // Only fire once per user per mount cycle
    if (instantFiredRef.current === user.id) return;
    instantFiredRef.current = user.id;

    void fireInstantPresence(user.id);
  }, [user?.id, isDriver]);

  // ── VISIBILITY / FOCUS: re-fire instantly on app resume ──
  useEffect(() => {
    if (!user?.id || !isDriver) return;

    const onResume = () => {
      if (document.visibilityState === 'visible') {
        if (offlineTimerRef.current) {
          clearTimeout(offlineTimerRef.current);
          offlineTimerRef.current = null;
        }
        void fireInstantPresence(user.id);
      }
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') {
        offlineTimerRef.current = setTimeout(() => {
          const now = new Date().toISOString();
          void supabase.from('driver_presence').upsert(
            { driver_id: user.id, status: 'offline', last_seen: now, updated_at: now, current_screen: 'dashboard' },
            { onConflict: 'driver_id' }
          );
          void supabase.from('presence').upsert(
            { user_id: user.id, role: 'DRIVER', source: 'web', last_seen_at: now, updated_at: now },
            { onConflict: 'user_id' }
          );
          void supabase.from('driver_locations').update({ is_online: false, updated_at: now }).eq('driver_id', user.id);
        }, OFFLINE_AFTER_MS);
      }
    };
    const onFocus = () => void fireInstantPresence(user.id);

    document.addEventListener('visibilitychange', onResume);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onFocus);

    return () => {
      document.removeEventListener('visibilitychange', onResume);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onFocus);
      if (offlineTimerRef.current) clearTimeout(offlineTimerRef.current);
    };
  }, [user?.id, isDriver]);

  // ── AUTH STATE: fire on SIGNED_IN ──
  useEffect(() => {
    if (!isDriver) return;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session?.user?.id) {
        void fireInstantPresence(session.user.id);
      }
    });

    return () => subscription.unsubscribe();
  }, [isDriver]);

  // ── ENRICHED HEARTBEAT: runs every 15s with full profile data ──
  const enrichedHeartbeat = useCallback(async () => {
    if (!user?.id || authLoading) return;

    const now = new Date().toISOString();
    const displayName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || user.email || user.id;
    const lat = driverProfile?.current_lat ?? 45.5017;
    const lng = driverProfile?.current_lng ?? -73.5673;
    const status = driverProfile?.is_online === false ? 'offline' : 'available';
    const isOnline = status !== 'offline';

    await Promise.all([
      supabase.from('driver_presence').upsert(
        { driver_id: user.id, last_seen: now, updated_at: now, status, current_screen: 'dashboard', display_name: displayName, lat, lng },
        { onConflict: 'driver_id' }
      ),
      supabase.from('presence').upsert(
        { user_id: user.id, role: 'DRIVER', display_name: displayName, source: 'web', last_seen_at: now, updated_at: now },
        { onConflict: 'user_id' }
      ),
      supabase.from('driver_locations').upsert(
        { driver_id: user.id, user_id: user.id, lat, lng, is_online: isOnline, updated_at: now },
        { onConflict: 'driver_id' }
      ),
    ]);
  }, [user?.id, user?.email, authLoading, profile?.first_name, profile?.last_name, driverProfile?.current_lat, driverProfile?.current_lng, driverProfile?.is_online]);

  useEffect(() => {
    if (!user?.id || !isDriver) return;

    intervalRef.current = setInterval(enrichedHeartbeat, HEARTBEAT_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [user?.id, isDriver, enrichedHeartbeat]);
}
