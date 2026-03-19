import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { getValidAccessToken } from '@/lib/sessionRecovery';

type ScreenName = 'home' | 'searching' | 'booking';

const HEARTBEAT_MS = 30_000; // 30s heartbeat
const OFFLINE_AFTER_MS = 60_000; // mark offline after 60s inactivity

/**
 * Tracks rider presence in `rider_presence` table.
 * Call with the current screen name. Heartbeats every 30s.
 * Marks offline on unmount / visibility hidden > 60s.
 */
export function useRiderPresence(currentScreen: ScreenName) {
  const { user, profile, roles } = useAuth();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hiddenAtRef = useRef<number | null>(null);
  const offlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const screenRef = useRef(currentScreen);
  const mountedRef = useRef(true);
  // Track generation to prevent stale cleanup from overwriting fresh state
  const generationRef = useRef(0);
  screenRef.current = currentScreen;

  const isRider = roles.includes('rider');
  const userIdRef = useRef(user?.id);
  userIdRef.current = user?.id;

  const displayNameRef = useRef('');
  displayNameRef.current = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || user?.email || '';

  const upsertPresence = useCallback(async (
    status: 'online' | 'offline' = 'online',
    screen?: ScreenName,
    gen?: number
  ) => {
    const uid = userIdRef.current;
    if (!uid) return;

    // If a generation was passed, skip if it's stale (prevents old cleanup from overwriting)
    if (gen !== undefined && gen !== generationRef.current) return;

    try {
      // Recover session if needed (especially after backgrounding)
      if (status === 'online') {
        try { await getValidAccessToken(); } catch { /* proceed anyway */ }
      }

      await supabase.from('rider_presence' as any).upsert(
        {
          user_id: uid,
          role: 'rider',
          status,
          current_screen: screen ?? screenRef.current,
          last_seen: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          display_name: displayNameRef.current,
        },
        { onConflict: 'user_id' }
      );
    } catch (e: any) {
      console.error('[RiderPresence] upsert error:', e.message);
    }
  }, []); // stable callback — uses refs instead of deps

  useEffect(() => {
    if (!user?.id || !isRider) return;
    mountedRef.current = true;
    const gen = ++generationRef.current;

    // Initial upsert
    upsertPresence('online', undefined, gen);

    // Heartbeat
    intervalRef.current = setInterval(() => {
      if (mountedRef.current) upsertPresence('online', undefined, gen);
    }, HEARTBEAT_MS);

    // Visibility handling — recover session on wake
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAtRef.current = Date.now();
        offlineTimerRef.current = setTimeout(() => {
          upsertPresence('offline', undefined, gen);
        }, OFFLINE_AFTER_MS);
      } else {
        // Came back from background
        if (offlineTimerRef.current) {
          clearTimeout(offlineTimerRef.current);
          offlineTimerRef.current = null;
        }
        hiddenAtRef.current = null;
        // Re-mark online (with session recovery built into upsertPresence)
        upsertPresence('online', undefined, gen);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // Cleanup
    return () => {
      mountedRef.current = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (offlineTimerRef.current) clearTimeout(offlineTimerRef.current);
      document.removeEventListener('visibilitychange', handleVisibility);
      // Mark offline on unmount — uses THIS generation so it won't be blocked
      // But if a new generation has already started, the stale check will skip it
      upsertPresence('offline', undefined, gen);
    };
  }, [user?.id, isRider, upsertPresence]);

  // Update screen when it changes
  useEffect(() => {
    if (!user?.id || !isRider) return;
    upsertPresence('online', currentScreen, generationRef.current);
  }, [currentScreen, user?.id, isRider, upsertPresence]);
}
