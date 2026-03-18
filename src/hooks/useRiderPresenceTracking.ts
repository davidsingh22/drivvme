import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

const HEARTBEAT_MS = 15_000;

type RiderScreen = 'home' | 'searching' | 'booking';

function detectRiderScreen(): RiderScreen {
  try {
    const pathname = window.location.pathname || '/';
    if (pathname.startsWith('/search')) return 'searching';
    if (pathname.startsWith('/ride')) return 'booking';
    return 'home';
  } catch {
    return 'home';
  }
}

async function fireInstantRiderPresence(userId: string, displayName?: string) {
  const now = new Date().toISOString();
  console.log('RIDER PRESENCE FIRED', userId, now);

  const { error } = await supabase.from('presence').upsert(
    {
      user_id: userId,
      role: 'RIDER',
      display_name: displayName || userId.slice(0, 8),
      source: detectRiderScreen(),
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

  const isDriverRoute = (() => {
    try {
      return window.location.pathname.startsWith('/driver');
    } catch {
      return false;
    }
  })();

  const shouldTrackRider = !!user?.id && !isDriver && !isDriverRoute;
  const displayName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || user?.email || user?.id || '';

  useEffect(() => {
    if (!user?.id) {
      instantFiredRef.current = null;
      return;
    }
    if (!shouldTrackRider) return;
    if (instantFiredRef.current === user.id) return;

    instantFiredRef.current = user.id;
    void fireInstantRiderPresence(user.id, displayName);
  }, [user?.id, shouldTrackRider, displayName]);

  useEffect(() => {
    if (!user?.id || !shouldTrackRider) return;

    const fireNow = () => {
      void fireInstantRiderPresence(user.id, displayName);
    };

    const onResume = () => {
      if (document.visibilityState === 'visible') {
        fireNow();
      }
    };

    document.addEventListener('visibilitychange', onResume);
    window.addEventListener('focus', fireNow);
    window.addEventListener('pageshow', fireNow);

    return () => {
      document.removeEventListener('visibilitychange', onResume);
      window.removeEventListener('focus', fireNow);
      window.removeEventListener('pageshow', fireNow);
    };
  }, [user?.id, shouldTrackRider, displayName]);

  useEffect(() => {
    if (!user?.id || !shouldTrackRider) return;

    intervalRef.current = setInterval(() => {
      void fireInstantRiderPresence(user.id, displayName);
    }, HEARTBEAT_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [user?.id, shouldTrackRider, displayName]);

  useEffect(() => {
    if (!user?.id || !shouldTrackRider) return;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== 'SIGNED_IN' && event !== 'TOKEN_REFRESHED') return;
      if (!session?.user?.id || session.user.id !== user.id) return;

      void fireInstantRiderPresence(session.user.id, displayName || session.user.email || session.user.id);
    });

    return () => subscription.unsubscribe();
  }, [user?.id, shouldTrackRider, displayName]);
}
