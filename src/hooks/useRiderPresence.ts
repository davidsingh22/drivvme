import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

type ScreenName = 'home' | 'searching' | 'booking';

const HEARTBEAT_MS = 30_000;
const OFFLINE_AFTER_MS = 60_000;

/**
 * Tracks rider presence ONLY in `rider_presence` table.
 * Does NOT touch driver_presence, driver_locations, or presence tables.
 * Fires instantly on mount/resume — no GPS or async dependency.
 */
export function useRiderPresence(currentScreen: ScreenName) {
  const { user, profile, roles } = useAuth();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const offlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const screenRef = useRef(currentScreen);
  screenRef.current = currentScreen;

  // Guard: only riders use this hook
  const isDriver = roles.includes('driver');

  const displayName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || user?.email || '';

  const upsertPresence = useCallback(async (status: 'online' | 'offline' = 'online', screen?: ScreenName) => {
    if (!user?.id) return;
    if (isDriver) return; // Never write rider presence for driver accounts

    const now = new Date().toISOString();
    console.log("RIDER PRESENCE SENT", user.id);

    try {
      // ONLY write to rider_presence — never driver_presence or driver_locations
      await (supabase.from('rider_presence' as any) as any).upsert(
        {
          user_id: user.id,
          role: 'rider',
          status,
          current_screen: screen ?? screenRef.current,
          last_seen: now,
          updated_at: now,
          display_name: displayName,
        },
        { onConflict: 'user_id' }
      );
    } catch (e: any) {
      console.error('[RiderPresence] upsert error:', e.message);
    }
  }, [user?.id, displayName, isDriver]);

  // Instant fire on mount + heartbeat + visibility
  useEffect(() => {
    if (!user?.id) return;
    if (isDriver) return;

    // Instant fire
    upsertPresence('online');

    // Heartbeat
    intervalRef.current = setInterval(() => upsertPresence('online'), HEARTBEAT_MS);

    // Visibility handling
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        offlineTimerRef.current = setTimeout(() => {
          upsertPresence('offline');
        }, OFFLINE_AFTER_MS);
      } else {
        if (offlineTimerRef.current) {
          clearTimeout(offlineTimerRef.current);
          offlineTimerRef.current = null;
        }
        // Instant re-fire on resume
        upsertPresence('online');
      }
    };

    const onFocus = () => upsertPresence('online');

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onFocus);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (offlineTimerRef.current) clearTimeout(offlineTimerRef.current);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onFocus);
    };
  }, [user?.id, isDriver, upsertPresence]);

  // Update screen when it changes
  useEffect(() => {
    if (!user?.id) return;
    if (isDriver) return;
    upsertPresence('online', currentScreen);
  }, [currentScreen, user?.id, isDriver, upsertPresence]);
}
