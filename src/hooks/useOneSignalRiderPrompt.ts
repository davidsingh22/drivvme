import { useEffect, useRef } from 'react';
import OneSignal from 'react-onesignal';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Auto-prompts OneSignal push permission on the Rider Dashboard
 * and saves the OneSignal player ID to the profiles table.
 */
export function useOneSignalRiderPrompt() {
  const { user } = useAuth();
  const hasRun = useRef(false);

  useEffect(() => {
    if (!user?.id || hasRun.current) return;
    hasRun.current = true;

    const timer = setTimeout(async () => {
      try {
        // Check current permission state
        const permission = Notification?.permission ?? 'default';
        console.log('🔔 OneSignal rider prompt – browser permission:', permission);

        if (permission === 'default') {
          // Not yet asked – show slidedown
          await OneSignal.Slidedown.promptPush();
          console.log('🔔 OneSignal slidedown prompt shown');
        } else if (permission === 'denied') {
          console.log('🔔 Notifications denied by user');
        } else {
          console.log('🔔 Notifications already granted');
        }

        // Bind user and get player ID
        await OneSignal.login(user.id);
        await OneSignal.User.PushSubscription.optIn();

        const playerId = OneSignal.User.PushSubscription.id;
        console.log('🔔 OneSignal player ID:', playerId);

        if (playerId) {
          const { error } = await supabase
            .from('profiles')
            .update({ onesignal_player_id: playerId } as any)
            .eq('user_id', user.id);

          if (error) {
            console.error('❌ Failed to save OneSignal player ID:', error);
          } else {
            console.log('✅ OneSignal player ID saved to profile:', playerId);
          }
        }
      } catch (err) {
        console.error('❌ OneSignal rider prompt error:', err);
      }
    }, 3000);

    return () => clearTimeout(timer);
  }, [user?.id]);
}
