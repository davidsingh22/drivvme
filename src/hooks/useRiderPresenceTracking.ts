import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

const HEARTBEAT_MS = 15_000;
const OFFLINE_AFTER_MS = 60_000;

function detectScreen(): string {
  try {
    const p = window.location.pathname || '/';
    if (p.startsWith('/search')) return 'searching';
    if (p.startsWith('/ride')) return 'booking';
    return 'home';
  } catch {
    return 'home';
  }
}

function isDriverOrAdminRoute(): boolean {
  try {
    const p = window.location.pathname || '/';
    return p.startsWith('/driver') || p.startsWith('/admin');
  } catch {
    return false;
  }
}

/**
 * Exact same pattern as driver's fireInstantPresence.
 * Writes to presence + rider_presence + rider_locations in parallel.
 * Zero dependencies — no GPS, no profile, no session check.
 */
async function fireInstantPresence(userId: string, displayName?: string) {
  if (isDriverOrAdminRoute()) return;

  const now = new Date().toISOString();
  const screen = detectScreen();
  const name = displayName || userId.slice(0, 8);

  console.log('RIDER PRESENCE GLOBAL', userId);

  const [pRes, rpRes, rlRes] = await Promise.all([
    supabase.from('presence').upsert(
      {
        user_id: userId,
        role: 'RIDER',
        display_name: name,
        source: screen,
        last_seen_at: now,
        updated_at: now,
      },
      { onConflict: 'user_id' }
    ),
    supabase.from('rider_presence').upsert(
      {
        user_id: userId,
        status: 'online',
        last_seen: now,
        updated_at: now,
        current_screen: screen,
        display_name: name,
        role: 'rider',
      },
      { onConflict: 'user_id' }
    ),
    supabase.from('rider_locations').upsert(
      {
        user_id: userId,
        lat: 45.5017,
        lng: -73.5673,
        is_online: true,
        last_seen_at: now,
        updated_at: now,
      },
      { onConflict: 'user_id' }
    ),
  ]);

  if (pRes.error) console.warn('[RiderPresence] presence error:', pRes.error.message);
  if (rpRes.error) console.warn('[RiderPresence] rider_presence error:', rpRes.error.message);
  if (rlRes.error) console.warn('[RiderPresence] rider_locations error:', rlRes.error.message);
}

/**
 * Global rider presence — mirrors useDriverPresenceTracking exactly.
 * 3 layers: instant fire, resume listeners, auth events + heartbeat.
 * Mount once at App root. NOT tied to any page or booking flow.
 */
export function useRiderPresenceTracking() {
  const { user, profile, roles } = useAuth();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const offlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const instantFiredRef = useRef<string | null>(null);

  const isDriver = roles.includes('driver');
  const isAdmin = roles.includes('admin');
  const skip = isDriver || isAdmin;

  const displayName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ')
    || user?.email || '';

  // ── LAYER 1: INSTANT FIRE — the moment user.id is available ──
  useEffect(() => {
    if (!user?.id || skip) return;
    if (instantFiredRef.current === user.id) return;
    instantFiredRef.current = user.id;

    void fireInstantPresence(user.id, displayName || user.email || user.id);
  }, [user?.id, skip, displayName]);

  // ── LAYER 2: RESUME LISTENERS — visibilitychange, focus, pageshow ──
  useEffect(() => {
    if (!user?.id || skip) return;

    const onResume = () => {
      if (document.visibilityState === 'visible') {
        if (offlineTimerRef.current) {
          clearTimeout(offlineTimerRef.current);
          offlineTimerRef.current = null;
        }
        void fireInstantPresence(user.id, displayName || user.email || user.id);
      }
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') {
        offlineTimerRef.current = setTimeout(() => {
          const now = new Date().toISOString();
          void supabase.from('presence').upsert(
            { user_id: user.id, role: 'RIDER', source: detectScreen(), last_seen_at: now, updated_at: now },
            { onConflict: 'user_id' }
          );
          void supabase.from('rider_presence').upsert(
            { user_id: user.id, status: 'offline', last_seen: now, updated_at: now, current_screen: detectScreen(), role: 'rider' },
            { onConflict: 'user_id' }
          );
          void supabase.from('rider_locations').update({ is_online: false, last_seen_at: now, updated_at: now }).eq('user_id', user.id);
        }, OFFLINE_AFTER_MS);
      }
    };
    const onFocus = () => void fireInstantPresence(user.id, displayName || user.email || user.id);

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
  }, [user?.id, skip, displayName]);

  // ── LAYER 3: AUTH EVENTS — SIGNED_IN + TOKEN_REFRESHED ──
  useEffect(() => {
    if (skip) return;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session?.user?.id) {
        if (isDriverOrAdminRoute()) return;
        void fireInstantPresence(session.user.id, displayName || session.user.email || session.user.id);
      }
    });

    return () => subscription.unsubscribe();
  }, [displayName, skip]);

  // ── LAYER 4: HEARTBEAT every 15s ──
  const enrichedHeartbeat = useCallback(async () => {
    if (!user?.id || skip || isDriverOrAdminRoute()) return;

    const now = new Date().toISOString();
    const screen = detectScreen();
    const name = displayName || user.email || user.id;

    await Promise.all([
      supabase.from('presence').upsert(
        { user_id: user.id, role: 'RIDER', display_name: name, source: screen, last_seen_at: now, updated_at: now },
        { onConflict: 'user_id' }
      ),
      supabase.from('rider_presence').upsert(
        { user_id: user.id, status: 'online', last_seen: now, updated_at: now, current_screen: screen, display_name: name, role: 'rider' },
        { onConflict: 'user_id' }
      ),
      supabase.from('rider_locations').upsert(
        { user_id: user.id, lat: 45.5017, lng: -73.5673, is_online: true, last_seen_at: now, updated_at: now },
        { onConflict: 'user_id' }
      ),
    ]);
  }, [user?.id, user?.email, skip, displayName]);

  useEffect(() => {
    if (!user?.id || skip) return;

    intervalRef.current = setInterval(enrichedHeartbeat, HEARTBEAT_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [user?.id, skip, enrichedHeartbeat]);
}
