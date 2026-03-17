import { useEffect, useRef, useCallback, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

type ScreenName = 'home' | 'searching' | 'booking';

const HEARTBEAT_MS = 30_000;
const OFFLINE_AFTER_MS = 60_000;

/**
 * Tracks rider presence in `rider_presence` table.
 * Waits for auth session to be ready before first upsert.
 */
export function useRiderPresence(currentScreen: ScreenName) {
  const { user, profile, roles, isLoading } = useAuth();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hiddenAtRef = useRef<number | null>(null);
  const offlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const screenRef = useRef(currentScreen);
  screenRef.current = currentScreen;

  // Track whether supabase auth session is actually ready
  const [isAuthReady, setIsAuthReady] = useState(false);

  useEffect(() => {
    // Check session immediately
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) setIsAuthReady(true);
    });
    // Also listen for future auth changes (login, token refresh, etc.)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthReady(!!session?.user);
    });
    return () => subscription.unsubscribe();
  }, []);

  const isRider = isLoading ? !!user?.id : roles.includes('rider') || roles.length === 0;

  const displayName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || user?.email || '';

  const upsertPresence = useCallback(async (status: 'online' | 'offline' = 'online', screen?: ScreenName) => {
    if (!user?.id) return;
    try {
      await supabase.from('rider_presence' as any).upsert(
        {
          user_id: user.id,
          role: 'rider',
          status,
          current_screen: screen ?? screenRef.current,
          last_seen: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          display_name: displayName,
        },
        { onConflict: 'user_id' }
      );
    } catch (e: any) {
      console.error('[RiderPresence] upsert error:', e.message);
    }
  }, [user?.id, displayName]);

  // Main effect: gated on BOTH auth ready AND user available
  useEffect(() => {
    if (!isAuthReady || !user?.id || !isRider) return;

    // Initial upsert
    upsertPresence('online');

    // Heartbeat
    intervalRef.current = setInterval(() => upsertPresence('online'), HEARTBEAT_MS);

    // Visibility handling
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAtRef.current = Date.now();
        offlineTimerRef.current = setTimeout(() => {
          upsertPresence('offline');
        }, OFFLINE_AFTER_MS);
      } else {
        if (offlineTimerRef.current) {
          clearTimeout(offlineTimerRef.current);
          offlineTimerRef.current = null;
        }
        upsertPresence('online');
        hiddenAtRef.current = null;
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (offlineTimerRef.current) clearTimeout(offlineTimerRef.current);
      document.removeEventListener('visibilitychange', handleVisibility);
      upsertPresence('offline');
    };
  }, [isAuthReady, user?.id, isRider, upsertPresence]);

  // Update screen when it changes
  useEffect(() => {
    if (!isAuthReady || !user?.id || !isRider) return;
    upsertPresence('online', currentScreen);
  }, [currentScreen, isAuthReady, user?.id, isRider, upsertPresence]);
}
