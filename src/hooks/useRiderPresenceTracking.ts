import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

const HEARTBEAT_MS = 15_000;

/**
 * Single global rider presence hook — mount once OUTSIDE routes.
 * Fires initial upsert + self-healing heartbeat + visibility resume fire.
 */
export function useRiderPresenceTracking() {
  const { user, profile, roles } = useAuth();

  const displayNameRef = useRef('');
  displayNameRef.current =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') ||
    user?.email ||
    '';

  const isRider = roles.includes('rider');
  const skip = !isRider || roles.includes('driver') || roles.includes('admin');

  useEffect(() => {
    if (!user?.id || skip) return;

    let isActive = true;
    let timeoutId: number | undefined;

    const heartbeat = async () => {
      if (!isActive || !user?.id) return;

      console.log('RIDER HEARTBEAT', user.id);

      await supabase.from('presence').upsert(
        {
          user_id: user.id,
          role: 'RIDER',
          display_name: displayNameRef.current || user.email || user.id.slice(0, 8),
          source: 'web',
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );

      if (!isActive) return;
      timeoutId = window.setTimeout(heartbeat, HEARTBEAT_MS);
    };

    void heartbeat();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && user?.id) {
        console.log('RIDER RESUME FIRE', user.id);
        void supabase.from('presence').upsert(
          {
            user_id: user.id,
            role: 'RIDER',
            display_name: displayNameRef.current || user.email || user.id.slice(0, 8),
            source: 'web',
            last_seen_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        );
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isActive = false;
      if (timeoutId) window.clearTimeout(timeoutId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [user?.id, user?.email, skip]);
}
