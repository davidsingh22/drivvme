import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

const HEARTBEAT_MS = 15_000;
const DEBOUNCE_MS = 2_000;

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

async function firePresence(userId: string, displayName?: string) {
  if (isDriverOrAdminRoute()) return;

  const screen = detectScreen();
  const name = displayName || userId.slice(0, 8);

  const { error } = await supabase.from('presence').upsert(
    {
      user_id: userId,
      role: 'RIDER',
      display_name: name,
      source: screen,
    },
    { onConflict: 'user_id' }
  );

  if (error) console.warn('[RiderPresence] upsert error:', error.message);
}

/**
 * Single global rider presence hook — mount once at App root.
 *
 * Uses a lock + debounce to prevent overlapping writes.
 * Primary updater is the 15s heartbeat; initial fire + resume are debounced.
 */
export function useRiderPresenceTracking() {
  const { user, profile, roles } = useAuth();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lockRef = useRef(false);
  const lastFireRef = useRef(0);

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

  /** Locked + debounced writer — prevents overlapping upserts */
  const safeFire = useCallback(
    async (userId: string, displayName?: string, label?: string) => {
      if (lockRef.current) return;

      const now = Date.now();
      if (now - lastFireRef.current < DEBOUNCE_MS) return;

      lockRef.current = true;
      lastFireRef.current = now;
      try {
        if (label) console.log(`[RiderPresence] ${label}`, userId);
        await firePresence(userId, displayName);
      } finally {
        lockRef.current = false;
      }
    },
    []
  );

  // ── INITIAL: fire from existing session on mount ──
  useEffect(() => {
    if (skip) return;

    const init = async () => {
      // Try auth context first
      if (user?.id) {
        void safeFire(user.id, getName(user.email, user.id), 'INITIAL (auth)');
        return;
      }
      // Fallback: check raw session
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.id) {
        void safeFire(session.user.id, getName(session.user.email, session.user.id), 'INITIAL (session)');
      }
    };
    void init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skip, user?.id]);

  // ── AUTH STATE CHANGE (catches SIGNED_IN for fresh logins) ──
  useEffect(() => {
    if (skip) return;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user?.id && event === 'SIGNED_IN') {
        void safeFire(session.user.id, getName(session.user.email, session.user.id), 'AUTH SIGNED_IN');
      }
    });

    return () => subscription.unsubscribe();
  }, [skip, getName, safeFire]);

  // ── RESUME: debounced visibility/focus (lightweight, won't collide with heartbeat) ──
  useEffect(() => {
    if (!user?.id || skip) return;

    const fire = () => void safeFire(user.id, getName(user.email, user.id), 'RESUME');

    const onVisible = () => {
      if (document.visibilityState === 'visible') fire();
    };

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', fire);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', fire);
    };
  }, [user?.id, skip, getName, safeFire]);

  // ── HEARTBEAT (15s) — primary updater ──
  useEffect(() => {
    if (skip) return;

    const tick = () => {
      const uid = user?.id;
      if (!uid || isDriverOrAdminRoute()) return;
      console.log('[RiderPresence] HEARTBEAT', uid);
      // Heartbeat bypasses debounce — reset lastFire so it always goes through
      lastFireRef.current = 0;
      void safeFire(uid, getName(user?.email, uid));
    };

    tick();
    intervalRef.current = setInterval(tick, HEARTBEAT_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skip, user?.id, getName, safeFire]);
}
