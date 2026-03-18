import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Single global rider presence hook — mount once OUTSIDE routes.
 * Uses ref-persisted setInterval so React re-renders never duplicate or kill the loop.
 */
export function useRiderPresenceTracking() {
  const { user, profile, roles } = useAuth();

  const displayNameRef = useRef('');
  displayNameRef.current =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') ||
    user?.email ||
    '';

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isRider = roles.includes('rider');
  const skip = !isRider || roles.includes('driver') || roles.includes('admin');

  useEffect(() => {
    if (!user?.id || skip) return;

    if (intervalRef.current) return;

    const uid = user.id;

    const sendHeartbeat = async () => {
      console.log('RIDER HEARTBEAT', uid);
      await supabase.from('presence').upsert(
        {
          user_id: uid,
          role: 'RIDER',
          display_name: displayNameRef.current || uid.slice(0, 8),
          source: 'web',
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );
    };

    void sendHeartbeat();
    intervalRef.current = setInterval(() => {
      void sendHeartbeat();
    }, 15000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id || skip) return;

    const uid = user.id;

    const sendHeartbeat = async () => {
      console.log('RIDER RESUME FIRE', uid);
      await supabase.from('presence').upsert(
        {
          user_id: uid,
          role: 'RIDER',
          display_name: displayNameRef.current || uid.slice(0, 8),
          source: 'web',
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void sendHeartbeat();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [user?.id]);
}
