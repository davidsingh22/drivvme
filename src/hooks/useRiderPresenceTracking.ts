import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

const HEARTBEAT_MS = 15_000;

/**
 * Single global rider presence hook — mount once OUTSIDE routes.
 * Fires initial upsert + 15s heartbeat. Nothing else.
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

    const name = displayNameRef.current || user.email || user.id.slice(0, 8);

    // Initial fire
    console.log('RIDER PRESENCE INIT', user.id);
    supabase.from('presence').upsert(
      { user_id: user.id, role: 'RIDER', display_name: name, source: 'web' },
      { onConflict: 'user_id' }
    );

    // Heartbeat
    const interval = setInterval(() => {
      console.log('RIDER HEARTBEAT', user.id);
      supabase.from('presence').upsert(
        { user_id: user.id, role: 'RIDER', display_name: displayNameRef.current || user.email || user.id.slice(0, 8), source: 'web' },
        { onConflict: 'user_id' }
      );
    }, HEARTBEAT_MS);

    return () => clearInterval(interval);
  }, [user?.id, skip]);
}
