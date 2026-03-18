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
 * Fires AFTER auth is ready (user.id exists), not before.
 * Also fires from auth state change events as a fallback.
 *
 * Writes ONLY to: `presence` table (onConflict: 'user_id')
 */
export function useRiderPresenceTracking() {
  const { user, profile, roles } = useAuth();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isDriver = roles.includes('driver');
  const isAdmin = roles.includes('admin');
  const skip = isDriver || isAdmin;

  const displayNameRef = useRef('');
  displayNameRef.current =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') ||
    user?.email ||
    '';

  const getName = useCallback(
    (fallbackEmail?: string | null, fallbackId?: string) =>
      displayNameRef.current || fallbackEmail || fallbackId || '',
    []
  );

  // ── LAYER 1: FIRE WHEN user.id BECOMES AVAILABLE ──
  // No dedup guard — fires every time user.id changes (login, token refresh, etc.)
  useEffect(() => {
    if (!user?.id || skip) return;

    console.log('RIDER FIRE AFTER AUTH', user.id);
    void firePresence(user.id, getName(user.email, user.id));
  }, [user?.id, skip, getName]);

  // ── LAYER 2: AUTH STATE CHANGE (backup — catches SIGNED_IN before useAuth updates) ──
  useEffect(() => {
    if (skip) return;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user?.id && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')) {
        if (isDriverOrAdminRoute()) return;
        console.log('RIDER FIRE FROM AUTH EVENT', event, session.user.id);
        void firePresence(
          session.user.id,
          getName(session.user.email, session.user.id)
        );
      }
    });

    return () => subscription.unsubscribe();
  }, [skip, getName]);

  // ── LAYER 3: RESUME LISTENERS (visibilitychange, focus, pageshow) ──
  useEffect(() => {
    if (!user?.id || skip) return;

    const fire = () => void firePresence(user.id, getName(user.email, user.id));

    const onVisible = () => {
      if (document.visibilityState === 'visible') fire();
    };

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', fire);
    window.addEventListener('pageshow', fire);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', fire);
      window.removeEventListener('pageshow', fire);
    };
  }, [user?.id, skip, getName]);

  // ── LAYER 4: HEARTBEAT (15s) ──
  useEffect(() => {
    if (!user?.id || skip) return;

    const tick = () => {
      if (isDriverOrAdminRoute()) return;
      void firePresence(user.id, getName(user.email, user.id));
    };

    intervalRef.current = setInterval(tick, HEARTBEAT_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [user?.id, skip, getName]);
}
