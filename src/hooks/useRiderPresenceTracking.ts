import { useCallback, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

const HEARTBEAT_MS = 15_000;

type RiderScreen = 'home' | 'searching' | 'booking';

function getPathname() {
  try {
    return window.location.pathname || '/';
  } catch {
    return '/';
  }
}

function detectRiderScreen(pathname = getPathname()): RiderScreen {
  if (pathname.startsWith('/search')) return 'searching';
  if (pathname.startsWith('/ride')) return 'booking';
  return 'home';
}

function shouldSkipRiderPresence(pathname = getPathname()) {
  return pathname.startsWith('/driver') || pathname.startsWith('/admin') || pathname.startsWith('/login') || pathname.startsWith('/signup');
}

async function fireInstantRiderPresence(userId: string, displayName?: string, pathname = getPathname()) {
  const now = new Date().toISOString();
  console.log('RIDER PRESENCE FIRED', userId, now);

  const { error } = await supabase.from('presence').upsert(
    {
      user_id: userId,
      role: 'RIDER',
      display_name: displayName || userId.slice(0, 8),
      source: detectRiderScreen(pathname),
      last_seen_at: now,
      updated_at: now,
    },
    { onConflict: 'user_id' }
  );

  if (error) console.warn('[RiderPresence] presence error:', error.message);
}

export function useRiderPresenceTracking() {
  const { user, profile, isDriver } = useAuth();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const instantFiredRef = useRef<string | null>(null);

  const displayName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || user?.email || user?.id || '';

  const fireFromSession = useCallback(async () => {
    const pathname = getPathname();
    if (shouldSkipRiderPresence(pathname)) return;

    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.warn('[RiderPresence] session lookup error:', error.message);
      return;
    }

    const sessionUser = data.session?.user;
    const activeUserId = sessionUser?.id || user?.id;
    if (!activeUserId) return;
    if (isDriver) return;

    const activeDisplayName = displayName || sessionUser?.email || activeUserId;
    await fireInstantRiderPresence(activeUserId, activeDisplayName, pathname);
    instantFiredRef.current = activeUserId;
  }, [displayName, isDriver, user?.id]);

  useEffect(() => {
    if (!user?.id) {
      instantFiredRef.current = null;
    }
  }, [user?.id]);

  useEffect(() => {
    void fireFromSession();
  }, [fireFromSession]);

  useEffect(() => {
    if (!user?.id || isDriver || shouldSkipRiderPresence()) return;
    if (instantFiredRef.current === user.id) return;

    instantFiredRef.current = user.id;
    void fireInstantRiderPresence(user.id, displayName);
  }, [user?.id, isDriver, displayName]);

  useEffect(() => {
    const onResume = () => {
      if (document.visibilityState === 'visible') {
        void fireFromSession();
      }
    };

    const onFocus = () => {
      void fireFromSession();
    };

    document.addEventListener('visibilitychange', onResume);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onFocus);

    return () => {
      document.removeEventListener('visibilitychange', onResume);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onFocus);
    };
  }, [fireFromSession]);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      void fireFromSession();
    }, HEARTBEAT_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fireFromSession]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== 'SIGNED_IN' && event !== 'TOKEN_REFRESHED') return;
      if (!session?.user?.id) return;
      if (shouldSkipRiderPresence()) return;

      const activeDisplayName = displayName || session.user.email || session.user.id;
      void fireInstantRiderPresence(session.user.id, activeDisplayName);
      instantFiredRef.current = session.user.id;
    });

    return () => subscription.unsubscribe();
  }, [displayName]);
}
