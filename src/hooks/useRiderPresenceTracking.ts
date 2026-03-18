import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Single global rider presence hook — mount once OUTSIDE routes.
 * Uses ref-persisted recursive setTimeout so React re-renders never kill the loop.
 */
export function useRiderPresenceTracking() {
  const { user, profile, roles } = useAuth();

  const displayNameRef = useRef('');
  displayNameRef.current =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') ||
    user?.email ||
    '';

  const heartbeatRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isRider = roles.includes('rider');
  const skip = !isRider || roles.includes('driver') || roles.includes('admin');

  useEffect(() => {
    if (!user?.id || skip) return;

    // Prevent multiple loops
    if (heartbeatRef.current) return;

    const uid = user.id;

    const runHeartbeat = async () => {
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
      heartbeatRef.current = setTimeout(runHeartbeat, 15000);
    };

    runHeartbeat();

    return () => {
      if (heartbeatRef.current) {
        clearTimeout(heartbeatRef.current);
        heartbeatRef.current = null;
      }
    };
  }, [user?.id]);

  // Visibility resume — instant fire when app is foregrounded
  useEffect(() => {
    if (!user?.id || skip) return;

    const uid = user.id;

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        console.log('RIDER RESUME FIRE', uid);
        void supabase.from('presence').upsert(
          {
            user_id: uid,
            role: 'RIDER',
            display_name: displayNameRef.current || uid.slice(0, 8),
            source: 'web',
            last_seen_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        );
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [user?.id]);
}
