import { useCallback, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { getValidAccessToken } from '@/lib/sessionRecovery';

const HEARTBEAT_MS = 15_000;
const FAST_RETRY_MS = 1_200;

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
  return pathname.startsWith('/driver') || pathname.startsWith('/admin');
}

async function writeRiderPresence(userId: string, displayName?: string, pathname = getPathname()) {
  if (shouldSkipRiderPresence(pathname)) return true;

  const now = new Date().toISOString();
  try {
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

    if (error) {
      console.error('[RiderPresence] FAILED', error.message);
      return false;
    }

    return true;
  } catch (error: any) {
    console.error('[RiderPresence] FAILED', error?.message || error);
    return false;
  }
}

export function useRiderPresenceTracking() {
  const { user, profile, isDriver, isAdmin } = useAuth();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef(false);

  const skip = isDriver || isAdmin;
  const displayName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || user?.email || '';

  const fire = useCallback(async (reason: string) => {
    const pathname = getPathname();
    if (skip || shouldSkipRiderPresence(pathname)) return true;

    const session = await ensureSupabaseSession();
    if (!session?.user?.id) {
      console.error(`[RiderPresence] No recoverable session (${reason})`);
      return false;
    }

    const name = displayName || session.user.email || session.user.id;
    return writeRiderPresence(session.user.id, name, pathname);
  }, [displayName, skip]);

  const queueRetry = useCallback((reason: string) => {
    if (skip || shouldSkipRiderPresence()) return;
    if (retryTimeoutRef.current) return;

    retryTimeoutRef.current = setTimeout(() => {
      retryTimeoutRef.current = null;
      void fire(`${reason}:retry`);
    }, FAST_RETRY_MS);
  }, [fire, skip]);

  useEffect(() => {
    if (skip || firedRef.current) return;
    firedRef.current = true;
    void fire('app_open').then((ok) => {
      if (!ok) queueRetry('app_open');
    });
  }, [fire, queueRetry, skip]);

  useEffect(() => {
    if (!user?.id || skip) return;
    void fire('user_ready').then((ok) => {
      if (!ok) queueRetry('user_ready');
    });
  }, [user?.id, skip, fire, queueRetry]);

  useEffect(() => {
    if (skip) return;

    const onResume = () => {
      if (document.visibilityState !== 'visible') return;
      void fire('resume').then((ok) => {
        if (!ok) queueRetry('resume');
      });
    };

    const onFocus = () => {
      void fire('focus').then((ok) => {
        if (!ok) queueRetry('focus');
      });
    };

    document.addEventListener('visibilitychange', onResume);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onFocus);

    return () => {
      document.removeEventListener('visibilitychange', onResume);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onFocus);
    };
  }, [fire, queueRetry, skip]);

  useEffect(() => {
    if (skip) return;

    intervalRef.current = setInterval(() => {
      void fire('heartbeat').then((ok) => {
        if (!ok) queueRetry('heartbeat');
      });
    }, HEARTBEAT_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fire, queueRetry, skip]);

  useEffect(() => {
    if (skip) return;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== 'SIGNED_IN') return;
      if (shouldSkipRiderPresence()) return;

      if (!session?.user?.id) {
        queueRetry('signed_in_missing_session');
        return;
      }

      const name = displayName || session.user.email || session.user.id;
      void writeRiderPresence(session.user.id, name).then((ok) => {
        if (!ok) queueRetry('signed_in');
      });
    });

    return () => subscription.unsubscribe();
  }, [displayName, queueRetry, skip]);

  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
    };
  }, []);
}
