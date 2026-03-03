import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

const HEARTBEAT_INTERVAL_MS = 20_000; // 20 seconds

function detectSource(): string {
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream) return 'ios';
  if (/android/i.test(ua)) return 'android';
  return 'web';
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
    const source = detectSource();

    const upsertPresence = async () => {
      try {
        const { error } = await supabase.from('presence' as any).upsert(
          {
            user_id: user.id,
            role,
            display_name: displayName,
            source,
            last_seen_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
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
        const { error } = await supabase.from('activity_events' as any).insert({
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

    // Initial upsert + sign-in event
    upsertPresence();
    logSignedIn();

    // Heartbeat
    intervalRef.current = setInterval(upsertPresence, HEARTBEAT_INTERVAL_MS);

    // Visibility change: send heartbeat on background and on return
    const handleVisibility = () => {
      upsertPresence();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // Cleanup
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener('visibilitychange', handleVisibility);
      // One last heartbeat on unmount
      upsertPresence();
    };
  }, [user?.id, roles.length, profile?.first_name, profile?.last_name]);
}
