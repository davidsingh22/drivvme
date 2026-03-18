import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

type ScreenName = 'home' | 'searching' | 'booking';

const HEARTBEAT_MS = 30_000; // 30s heartbeat
const OFFLINE_AFTER_MS = 60_000; // mark offline after 60s inactivity

/**
 * Tracks rider presence in `rider_presence` table.
 * Call with the current screen name. Heartbeats every 30s.
 * Marks offline on unmount / visibility hidden > 60s.
 */
export function useRiderPresence(currentScreen: ScreenName) {
  const { user, profile } = useAuth();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hiddenAtRef = useRef<number | null>(null);
  const offlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const screenRef = useRef(currentScreen);
  screenRef.current = currentScreen;

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

  useEffect(() => {
    if (!user?.id) return;

    // Initial upsert
    upsertPresence('online');

    // Heartbeat
    intervalRef.current = setInterval(() => upsertPresence('online'), HEARTBEAT_MS);

    // Visibility handling
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAtRef.current = Date.now();
        // Start offline timer only when app is actually backgrounded/inactive.
        offlineTimerRef.current = setTimeout(() => {
          upsertPresence('offline');
        }, OFFLINE_AFTER_MS);
      } else {
        // Came back
        if (offlineTimerRef.current) {
          clearTimeout(offlineTimerRef.current);
          offlineTimerRef.current = null;
        }
        upsertPresence('online');
        hiddenAtRef.current = null;
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // Cleanup: do NOT mark offline on route/page transitions.
    // Let the 60s inactivity timer own offline state to avoid false offline/home regressions.
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (offlineTimerRef.current) clearTimeout(offlineTimerRef.current);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [user?.id, upsertPresence]);

  // Update screen when it changes
  useEffect(() => {
    if (!user?.id) return;
    upsertPresence('online', currentScreen);
  }, [currentScreen, user?.id, upsertPresence]);
}

