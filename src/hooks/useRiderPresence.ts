import { useEffect, useRef, useCallback, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

type ScreenName = 'home' | 'searching' | 'booking';
type SessionUser = { id: string; email: string | null };

const HEARTBEAT_MS = 30_000;
const OFFLINE_AFTER_MS = 60_000;

/**
 * Tracks rider presence in `rider_presence` table.
 * Initializes immediately for existing sessions and continues listening for auth changes.
 */
export function useRiderPresence(currentScreen: ScreenName) {
  const { user, profile } = useAuth();
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hiddenAtRef = useRef<number | null>(null);
  const offlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const screenRef = useRef(currentScreen);
  const sessionUserRef = useRef<SessionUser | null>(null);
  const effectiveUserIdRef = useRef<string | null>(null);
  const effectiveEmailRef = useRef<string | null>(null);
  const displayNameRef = useRef('');

  screenRef.current = currentScreen;

  const effectiveUserId = user?.id ?? sessionUser?.id ?? null;
  const effectiveEmail = user?.email ?? sessionUser?.email ?? null;
  const displayName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || effectiveEmail || '';

  effectiveUserIdRef.current = effectiveUserId;
  effectiveEmailRef.current = effectiveEmail;
  displayNameRef.current = displayName;

  const upsertPresence = useCallback(
    async (
      status: 'online' | 'offline' = 'online',
      screen?: ScreenName,
      userId?: string | null,
      email?: string | null,
    ) => {
      const targetUserId = userId ?? effectiveUserIdRef.current;
      if (!targetUserId) return;

      try {
        await supabase.from('rider_presence').upsert(
          {
            user_id: targetUserId,
            role: 'rider',
            status,
            current_screen: screen ?? screenRef.current,
            last_seen: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            display_name: displayNameRef.current || email || effectiveEmailRef.current || '',
          },
          { onConflict: 'user_id' },
        );
      } catch (e: any) {
        console.error('[RiderPresence] upsert error:', e.message);
      }
    },
    [],
  );

  useEffect(() => {
    let isMounted = true;

    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (!isMounted) return;

      const nextSessionUser = session?.user
        ? { id: session.user.id, email: session.user.email ?? null }
        : null;

      sessionUserRef.current = nextSessionUser;
      setSessionUser(nextSessionUser);

      if (nextSessionUser) {
        void upsertPresence('online', screenRef.current, nextSessionUser.id, nextSessionUser.email);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const previousSessionUser = sessionUserRef.current;
      const nextSessionUser = session?.user
        ? { id: session.user.id, email: session.user.email ?? null }
        : null;

      sessionUserRef.current = nextSessionUser;
      setSessionUser(nextSessionUser);

      if (nextSessionUser) {
        void upsertPresence('online', screenRef.current, nextSessionUser.id, nextSessionUser.email);
      } else if (previousSessionUser?.id) {
        void upsertPresence('offline', screenRef.current, previousSessionUser.id, previousSessionUser.email);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [upsertPresence]);

  useEffect(() => {
    if (!effectiveUserId) return;

    void upsertPresence('online');

    intervalRef.current = setInterval(() => {
      void upsertPresence('online');
    }, HEARTBEAT_MS);

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
  }, [effectiveUserId, upsertPresence]);

  useEffect(() => {
    if (!effectiveUserId) return;
    void upsertPresence('online', currentScreen);
  }, [currentScreen, effectiveUserId, upsertPresence]);
}
