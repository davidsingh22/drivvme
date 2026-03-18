import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { getValidAccessToken } from '@/lib/sessionRecovery';

const HEARTBEAT_INTERVAL_MS = 20_000; // 20 seconds

function detectPlatformSource(): string {
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream) return 'ios';
  if (/android/i.test(ua)) return 'android';
  return 'web';
}

function detectRiderScreen(): 'home' | 'searching' | 'booking' {
  try {
    const pathname = window.location.pathname || '/';
    if (pathname.startsWith('/search')) return 'searching';
    if (pathname.startsWith('/ride')) return 'booking';
    return 'home';
  } catch {
    return 'home';
  }
}

/**
 * Upserts presence for the current authenticated user and sends a heartbeat every 20s.
 * On sign-in, also logs a SIGNED_IN activity event.
 */
export function usePresenceHeartbeat() {
  const { user, profile, roles } = useAuth();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const signedInLoggedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!user?.id) {
      signedInLoggedRef.current = null;
      return;
    }

    const isDriver = roles.includes('driver');
    const role = isDriver ? 'DRIVER' : 'RIDER';
    const displayName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || user.email || user.id;

    const upsertPresence = async () => {
      try {
        const token = await getValidAccessToken().catch(() => null);
        if (!token) {
          console.warn('[Presence] No valid session token for heartbeat');
          return;
        }

        const now = new Date().toISOString();
        const source = isDriver ? detectPlatformSource() : detectRiderScreen();
        const { error } = await supabase.from('presence').upsert(
          {
            user_id: user.id,
            role,
            display_name: displayName,
            source,
            last_seen_at: now,
            updated_at: now,
          },
          { onConflict: 'user_id' }
        );
        if (error) console.error('[Presence] upsert error:', error.message);
      } catch (e: any) {
        console.error('[Presence] upsert exception:', e.message);
      }
    };

    const logSignedIn = async () => {
      if (signedInLoggedRef.current === user.id) return;
      signedInLoggedRef.current = user.id;
      try {
        const source = isDriver ? detectPlatformSource() : detectRiderScreen();
        const { error } = await supabase.from('activity_events').insert({
          user_id: user.id,
          role,
          event_type: 'SIGNED_IN',
          message: `${displayName} signed in`,
          source,
        });
        if (error) console.error('[Activity] SIGNED_IN insert error:', error.message);
      } catch (e: any) {
        console.error('[Activity] SIGNED_IN exception:', e.message);
      }
    };

    upsertPresence();
    logSignedIn();

    intervalRef.current = setInterval(upsertPresence, HEARTBEAT_INTERVAL_MS);

    const handleVisibility = async () => {
      if (document.visibilityState === 'visible') {
        const token = await getValidAccessToken().catch(() => null);
        if (!token) {
          console.warn('[Presence] Session recovery failed on visibility resume');
          return;
        }
      }
      upsertPresence();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener('visibilitychange', handleVisibility);
      upsertPresence();
    };
  }, [user?.id, roles.length, profile?.first_name, profile?.last_name]);
}
