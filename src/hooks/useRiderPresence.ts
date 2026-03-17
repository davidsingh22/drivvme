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
  const { user, profile, roles, isLoading } = useAuth();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hiddenAtRef = useRef<number | null>(null);
  const offlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const screenRef = useRef(currentScreen);
  screenRef.current = currentScreen;

  // Fire presence immediately even if roles haven't loaded yet (we're on a rider page).
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

  useEffect(() => {
    if (!user?.id || !isRider) return;

    // Initial upsert
    upsertPresence('online');

    // Heartbeat
    intervalRef.current = setInterval(() => upsertPresence('online'), HEARTBEAT_MS);

    // Visibility handling
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAtRef.current = Date.now();
        // Start offline timer
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

    // Cleanup
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (offlineTimerRef.current) clearTimeout(offlineTimerRef.current);
      document.removeEventListener('visibilitychange', handleVisibility);
      // Mark offline on unmount (best effort)
      upsertPresence('offline');
    };
  }, [user?.id, isRider, upsertPresence]);

  // Update screen when it changes
  useEffect(() => {
    if (!user?.id || !isRider) return;
    upsertPresence('online', currentScreen);
  }, [currentScreen, user?.id, isRider, upsertPresence]);
}
