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
  return pathname.startsWith('/driver') || pathname.startsWith('/admin');
}

async function writeRiderPresence(userId: string, displayName?: string, pathname = getPathname()) {
  if (shouldSkipRiderPresence(pathname)) return true; // skip silently

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
    console.error('[RiderPresence] FAILED', error?.message);
    return false;
  }
}

/**
 * Rider presence tracking — uses getSession() (never forces refresh)
 * to avoid token-refresh cascades that cause "abuse attempt" errors.
 */
export function useRiderPresenceTracking() {
  const { user, profile, isDriver, isAdmin } = useAuth();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const firedRef = useRef(false);

  // Skip entirely for drivers and admins
  const skip = isDriver || isAdmin;

  const displayName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || user?.email || '';

  // Simple fire: just read current session, don't force refresh
  const fire = useCallback(async (reason: string) => {
    if (skip) return;
    if (shouldSkipRiderPresence()) return;

    // Use getSession — does NOT force a token refresh
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) {
      console.warn(`[RiderPresence] No session (${reason})`);
      return;
    }

    const name = displayName || session.user.email || session.user.id;
    await writeRiderPresence(session.user.id, name);
  }, [displayName, skip]);

  // Fire on mount (app open)
  useEffect(() => {
    if (skip || firedRef.current) return;
    firedRef.current = true;
    void fire('app_open');
  }, [fire, skip]);

  // Fire when user becomes available from auth context
  useEffect(() => {
    if (!user?.id || skip) return;
    void fire('user_ready');
  }, [user?.id, skip, fire]);

  // Visibility + focus (app resume)
  useEffect(() => {
    if (skip) return;

    const onResume = () => {
      if (document.visibilityState === 'visible') void fire('resume');
    };
    const onFocus = () => void fire('focus');

    document.addEventListener('visibilitychange', onResume);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onFocus);

    return () => {
      document.removeEventListener('visibilitychange', onResume);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onFocus);
    };
  }, [fire, skip]);

  // Heartbeat
  useEffect(() => {
    if (skip) return;
    intervalRef.current = setInterval(() => void fire('heartbeat'), HEARTBEAT_MS);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fire, skip]);

  // Auth state change — only SIGNED_IN (NOT TOKEN_REFRESHED to avoid cascade)
  useEffect(() => {
    if (skip) return;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== 'SIGNED_IN') return;
      if (!session?.user?.id) return;
      if (shouldSkipRiderPresence()) return;

      const name = displayName || session.user.email || session.user.id;
      void writeRiderPresence(session.user.id, name);
    });

    return () => subscription.unsubscribe();
  }, [displayName, skip]);
}
