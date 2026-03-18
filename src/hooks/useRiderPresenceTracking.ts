import { useCallback, useEffect, useRef } from 'react';
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

async function sendPresence(userId: string, displayName?: string) {
  if (isDriverOrAdminRoute()) return;

  const now = new Date().toISOString();
  console.log('RIDER PRESENCE GLOBAL', userId);

  try {
    const { error } = await supabase.from('presence').upsert(
      {
        user_id: userId,
        role: 'RIDER',
        display_name: displayName || userId.slice(0, 8),
        source: detectScreen(),
        last_seen_at: now,
        updated_at: now,
      },
      { onConflict: 'user_id' }
    );
    if (error) console.error('[RiderPresence] upsert failed:', error.message);
  } catch (e: any) {
    console.error('[RiderPresence] upsert error:', e?.message || e);
  }
}

/**
 * Global rider presence — mount once at app root.
 * Fires on: user ready, SIGNED_IN, focus, visibilitychange, pageshow, heartbeat.
 * Does NOT depend on any page or booking component.
 */
export function useRiderPresenceTracking() {
  const { user, profile, isDriver, isAdmin } = useAuth();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const skip = isDriver || isAdmin;

  const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ')
    || user?.email || '';

  const fire = useCallback(() => {
    if (!user?.id || skip) return;
    void sendPresence(user.id, name || user.email || user.id);
  }, [user?.id, user?.email, name, skip]);

  // 1. Trigger on user ready (app mount + auth hydration)
  useEffect(() => {
    if (!user?.id || skip) return;
    fire();
  }, [user?.id, skip, fire]);

  // 2. Trigger on resume / focus / pageshow
  useEffect(() => {
    if (!user?.id || skip) return;

    const onVisible = () => {
      if (document.visibilityState === 'visible') fire();
    };
    const onFocus = () => fire();

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onFocus);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onFocus);
    };
  }, [user?.id, skip, fire]);

  // 3. Heartbeat every 15s
  useEffect(() => {
    if (!user?.id || skip) return;

    intervalRef.current = setInterval(fire, HEARTBEAT_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [user?.id, skip, fire]);

  // 4. SIGNED_IN auth event
  useEffect(() => {
    if (skip) return;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== 'SIGNED_IN' || !session?.user?.id) return;
      if (isDriverOrAdminRoute()) return;
      void sendPresence(session.user.id, name || session.user.email || session.user.id);
    });

    return () => subscription.unsubscribe();
  }, [name, skip]);
}
