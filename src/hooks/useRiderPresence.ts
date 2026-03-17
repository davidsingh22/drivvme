import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

type ScreenName = 'home' | 'searching' | 'booking';

const HEARTBEAT_MS = 30_000;
const OFFLINE_AFTER_MS = 60_000;

/**
 * Tracks rider presence in `rider_presence` table.
 * Relies on useAuth() which already handles session hydration.
 */
export function useRiderPresence(currentScreen: ScreenName) {
  const { user, profile, roles } = useAuth();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hiddenAtRef = useRef<number | null>(null);
  const offlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const screenRef = useRef(currentScreen);

  screenRef.current = currentScreen;

  const isRider = roles.includes('rider');
  const displayName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || user?.email || '';

  const upsertPresence = useCallback(
    async (status: 'online' | 'offline' = 'online', screen?: ScreenName) => {
      if (!user?.id) return;

      try {
        await supabase.from('rider_presence').upsert(
          {
            user_id: user.id,
            role: 'rider',
            status,
            current_screen: screen ?? screenRef.current,
            last_seen: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            display_name: displayName,
          },
          { onConflict: 'user_id' },
        );
      } catch (e: any) {
        console.error('[RiderPresence] upsert error:', e.message);
      }
    },
    [user?.id, displayName],
  );

  // Main presence effect — runs whenever user becomes available
  useEffect(() => {
    if (!user?.id || !isRider) return;

    // Immediately mark online
    void upsertPresence('online');

    // Heartbeat
    intervalRef.current = setInterval(() => {
      void upsertPresence('online');
    }, HEARTBEAT_MS);

    // Visibility handler
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAtRef.current = Date.now();
        offlineTimerRef.current = setTimeout(() => {
          void upsertPresence('offline');
        }, OFFLINE_AFTER_MS);
      } else {
        if (offlineTimerRef.current) {
          clearTimeout(offlineTimerRef.current);
          offlineTimerRef.current = null;
        }
        void upsertPresence('online');
        hiddenAtRef.current = null;
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (offlineTimerRef.current) clearTimeout(offlineTimerRef.current);
      document.removeEventListener('visibilitychange', handleVisibility);
      void upsertPresence('offline');
    };
  }, [user?.id, isRider, upsertPresence]);

  // Screen change updates
  useEffect(() => {
    if (!user?.id || !isRider) return;
    void upsertPresence('online', currentScreen);
  }, [currentScreen, user?.id, isRider, upsertPresence]);
}
