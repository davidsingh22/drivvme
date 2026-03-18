import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

type ScreenName = 'home' | 'searching' | 'booking';

const HEARTBEAT_MS = 15_000;
const OFFLINE_AFTER_MS = 60_000;

/**
 * Tracks rider presence in the unified `presence` table with role='RIDER'.
 * Fires instantly on mount, resume, and focus — no GPS dependency.
 */
export function useRiderPresence(currentScreen: ScreenName) {
  const { user, profile } = useAuth();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const offlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const screenRef = useRef(currentScreen);
  screenRef.current = currentScreen;

  const displayName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || user?.email || '';

  const upsertPresence = useCallback(async (screen?: ScreenName) => {
    if (!user?.id) return;

    const now = new Date().toISOString();
    console.log("RIDER PRESENCE SENT", user.id);

    try {
      await supabase.from('presence').upsert(
        {
          user_id: user.id,
          role: 'RIDER',
          display_name: displayName,
          source: screen ?? screenRef.current,
          last_seen_at: now,
          updated_at: now,
        },
        { onConflict: 'user_id' }
      );
    } catch (e: any) {
      console.error('[RiderPresence] upsert error:', e.message);
    }
  }, [user?.id, displayName]);

  // Instant fire on mount + heartbeat + visibility/focus
  useEffect(() => {
    if (!user?.id) return;

    // Instant fire
    upsertPresence();

    // Heartbeat
    intervalRef.current = setInterval(() => upsertPresence(), HEARTBEAT_MS);

    // Visibility handling
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        offlineTimerRef.current = setTimeout(() => {
          // Don't mark offline — let staleness handle it
        }, OFFLINE_AFTER_MS);
      } else {
        if (offlineTimerRef.current) {
          clearTimeout(offlineTimerRef.current);
          offlineTimerRef.current = null;
        }
        // Instant re-fire on resume
        upsertPresence();
      }
    };

    const onFocus = () => upsertPresence();

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
  }, [user?.id, upsertPresence]);

  // Update screen/source when it changes
  useEffect(() => {
    if (!user?.id) return;
    upsertPresence(currentScreen);
  }, [currentScreen, user?.id, upsertPresence]);
}
