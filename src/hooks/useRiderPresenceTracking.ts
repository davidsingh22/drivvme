import { useCallback, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { ensureSupabaseSession } from '@/lib/sessionRecovery';

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
      console.error('RIDER PRESENCE FAILED', error);
      return false;
    }

    console.log('RIDER PRESENCE SENT', userId, detectRiderScreen(pathname), now);
    return true;
  } catch (error) {
    console.error('RIDER PRESENCE FAILED', error);
    return false;
  }
}

export function useRiderPresenceTracking() {
  const { user, profile } = useAuth();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const instantFiredRef = useRef<string | null>(null);

  const displayName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || user?.email || user?.id || '';

  const fireFromSession = useCallback(async (reason: string) => {
    const pathname = getPathname();
    if (shouldSkipRiderPresence(pathname)) return true;

    const session = await ensureSupabaseSession();
    if (!session?.user?.id) {
      console.warn(`[RiderPresence] No session, cannot send rider presence (${reason})`);
      return false;
    }

    const activeDisplayName = displayName || session.user.email || session.user.id;
    const ok = await writeRiderPresence(session.user.id, activeDisplayName, pathname);

    if (ok) {
      instantFiredRef.current = session.user.id;
    }

    return ok;
  }, [displayName]);

  const queueRetry = useCallback((reason: string) => {
    if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);

    retryTimeoutRef.current = setTimeout(() => {
      void fireFromSession(reason);
    }, FAST_RETRY_MS);
  }, [fireFromSession]);

  useEffect(() => {
    if (!user?.id) {
      instantFiredRef.current = null;
    }
  }, [user?.id]);

  useEffect(() => {
    void fireFromSession('app_open').then((ok) => {
      if (!ok) queueRetry('app_open_retry');
    });
  }, [fireFromSession, queueRetry]);

  useEffect(() => {
    if (!user?.id) return;
    if (instantFiredRef.current === user.id) return;

    void fireFromSession('user_ready').then((ok) => {
      if (!ok) queueRetry('user_ready_retry');
    });
  }, [user?.id, fireFromSession, queueRetry]);

  useEffect(() => {
    const runPresenceFire = (reason: string) => {
      void fireFromSession(reason).then((ok) => {
        if (!ok) queueRetry(`${reason}_retry`);
      });
    };

    const onResume = () => {
      if (document.visibilityState === 'visible') {
        runPresenceFire('app_resume');
      }
    };

    const onFocus = () => {
      runPresenceFire('window_focus');
    };

    document.addEventListener('visibilitychange', onResume);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onFocus);

    return () => {
      document.removeEventListener('visibilitychange', onResume);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onFocus);
    };
  }, [fireFromSession, queueRetry]);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      void fireFromSession('heartbeat');
    }, HEARTBEAT_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fireFromSession]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== 'SIGNED_IN' && event !== 'TOKEN_REFRESHED') return;

      if (!session?.user?.id) {
        console.warn(`[RiderPresence] No session, cannot send rider presence (${event})`);
        queueRetry(`auth_${event.toLowerCase()}_retry`);
        return;
      }

      if (shouldSkipRiderPresence()) return;

      const activeDisplayName = displayName || session.user.email || session.user.id;

      window.setTimeout(() => {
        void writeRiderPresence(session.user.id, activeDisplayName).then((ok) => {
          if (!ok) {
            queueRetry(`auth_${event.toLowerCase()}_retry`);
            return;
          }

          instantFiredRef.current = session.user.id;
        });
      }, 0);
    });

    return () => subscription.unsubscribe();
  }, [displayName, queueRetry]);

  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
    };
  }, []);
}
