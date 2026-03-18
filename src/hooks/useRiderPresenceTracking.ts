import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

const HEARTBEAT_MS = 15_000;

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
 * Writes ONLY to the unified `presence` table.
 * No rider_presence, no rider_locations — single source of truth.
 */
async function firePresence(userId: string, displayName?: string) {
  if (isDriverOrAdminRoute()) return;

  const now = new Date().toISOString();
  const screen = detectScreen();
  const name = displayName || userId.slice(0, 8);

  console.log('[RiderPresence] FIRE', userId, screen);

  const { error } = await supabase.from('presence').upsert(
    {
      user_id: userId,
      role: 'RIDER',
      display_name: name,
      source: screen,
      last_seen_at: now,
      updated_at: now,
    },
    { onConflict: 'user_id' }
  );

  if (error) console.warn('[RiderPresence] upsert error:', error.message);
}

/**
 * Single global rider presence hook — mount once at App root.
 *
 * Layer 1: Instant fire when user.id is available
 * Layer 2: Resume listeners (visibilitychange, focus, pageshow)
 * Layer 3: Auth events (SIGNED_IN, TOKEN_REFRESHED)
 * Layer 4: 15s heartbeat
 *
 * Writes ONLY to: `presence` table (onConflict: 'user_id')
 */
export function useRiderPresenceTracking() {
  const { user, profile, roles } = useAuth();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const instantFiredRef = useRef<string | null>(null);

  const isDriver = roles.includes('driver');
  const isAdmin = roles.includes('admin');
  const skip = isDriver || isAdmin;

  const displayName =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') ||
    user?.email ||
    '';

  // ── LAYER 1: INSTANT FIRE ──
  useEffect(() => {
    if (!user?.id || skip) return;
    if (instantFiredRef.current === user.id) return;
    instantFiredRef.current = user.id;

    void firePresence(user.id, displayName || user.email || user.id);
  }, [user?.id, skip, displayName]);

  // ── LAYER 2: RESUME LISTENERS ──
  useEffect(() => {
    if (!user?.id || skip) return;

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void firePresence(user.id, displayName || user.email || user.id);
      }
    };
    const onFocus = () =>
      void firePresence(user.id, displayName || user.email || user.id);

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onFocus);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onFocus);
    };
  }, [user?.id, skip, displayName]);

  // ── LAYER 3: AUTH EVENTS ──
  useEffect(() => {
    if (skip) return;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (
        (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') &&
        session?.user?.id
      ) {
        if (isDriverOrAdminRoute()) return;
        void firePresence(
          session.user.id,
          displayName || session.user.email || session.user.id
        );
      }
    });

    return () => subscription.unsubscribe();
  }, [displayName, skip]);

  // ── LAYER 4: HEARTBEAT (15s) ──
  const heartbeat = useCallback(async () => {
    if (!user?.id || skip || isDriverOrAdminRoute()) return;
    void firePresence(user.id, displayName || user.email || user.id);
  }, [user?.id, user?.email, skip, displayName]);

  useEffect(() => {
    if (!user?.id || skip) return;

    intervalRef.current = setInterval(heartbeat, HEARTBEAT_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [user?.id, skip, heartbeat]);
}
