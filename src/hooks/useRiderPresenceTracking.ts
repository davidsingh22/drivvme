import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

const HEARTBEAT_MS = 15_000;

function detectSource(): 'web' | 'ios' | 'android' {
  const ua = (navigator.userAgent || '').toLowerCase();
  if (ua.includes('android')) return 'android';
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) return 'ios';
  return 'web';
}

async function fireInstantRiderPresence(userId: string, displayName?: string) {
  const now = new Date().toISOString();
  console.log('RIDER PRESENCE FIRED', userId, now);

  const { error } = await supabase.from('presence').upsert(
    {
      user_id: userId,
      role: 'RIDER',
      display_name: displayName || userId.slice(0, 8),
      source: detectSource(),
      last_seen_at: now,
      updated_at: now,
    },
    { onConflict: 'user_id' }
  );

  if (error) console.warn('[RiderPresence] presence error:', error.message);
}

export function useRiderPresenceTracking() {
  const { user, profile, roles } = useAuth();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isDriver = !!user?.id && (roles.includes('driver') || (() => {
    try {
      return localStorage.getItem('last_route') === '/driver';
    } catch {
      return false;
    }
  })());

  const displayName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || user?.email || user?.id || '';

  useEffect(() => {
    if (!user?.id || isDriver) return;
    void fireInstantRiderPresence(user.id, displayName);
  }, [user?.id, isDriver, displayName]);

  useEffect(() => {
    if (!user?.id || isDriver) return;

    const onResume = () => {
      if (document.visibilityState === 'visible') {
        void fireInstantRiderPresence(user.id, displayName);
      }
    };

    const onFocus = () => {
      void fireInstantRiderPresence(user.id, displayName);
    };

    document.addEventListener('visibilitychange', onResume);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onFocus);

    return () => {
      document.removeEventListener('visibilitychange', onResume);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onFocus);
    };
  }, [user?.id, isDriver, displayName]);

  useEffect(() => {
    if (!user?.id || isDriver) return;

    intervalRef.current = setInterval(() => {
      void fireInstantRiderPresence(user.id, displayName);
    }, HEARTBEAT_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [user?.id, isDriver, displayName]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== 'SIGNED_IN' && event !== 'TOKEN_REFRESHED') return;
      if (!session?.user?.id) return;

      try {
        if (localStorage.getItem('last_route') === '/driver') return;
      } catch {
        // ignore storage errors
      }

      void fireInstantRiderPresence(session.user.id, session.user.email || '');
    });

    return () => subscription.unsubscribe();
  }, []);
}
