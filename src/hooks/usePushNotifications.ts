import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { 
  registerServiceWorkerWithConfig, 
  getFCMToken, 
  initializeFirebase, 
  setupForegroundMessageHandler 
} from '@/lib/firebase';

export function usePushNotifications() {
  const { user } = useAuth();
  const [isSupported, setIsSupported] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');

  useEffect(() => {
    // Check if push notifications are supported
    const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    setIsSupported(supported);

    if (supported) {
      setPermission(Notification.permission);
    }
  }, []);

  const checkExistingSubscription = useCallback(async () => {
    if (!user) return;
    try {
      // Check if user has any FCM subscriptions in database
      const { data, error } = await supabase
        .from('push_subscriptions')
        .select('id')
        .eq('user_id', user.id)
        .limit(1);

      if (error) {
        console.error('Error checking subscription in database:', error);
      }

      setIsSubscribed(!!data && data.length > 0);
    } catch (error) {
      console.error('Error checking subscription:', error);
    }
  }, [user]);

  // Auto-register for push on first load (driver role)
  const autoRegisterForPush = useCallback(async () => {
    if (!user || !isSupported) return;
    
    const key = `push_registered_${user.id}`;
    
    // Skip if already registered in this browser
    if (localStorage.getItem(key)) return;
    
    // If permission already granted, register silently
    if (Notification.permission === 'granted') {
      try {
        const registration = await registerServiceWorkerWithConfig();
        const fcmToken = await getFCMToken(registration);
        const endpoint = `https://fcm.googleapis.com/fcm/send/${fcmToken}`;
        
        await supabase
          .from('push_subscriptions')
          .upsert(
            {
              user_id: user.id,
              endpoint: endpoint,
              p256dh: fcmToken,
              auth: 'fcm',
            },
            { onConflict: 'user_id,endpoint' }
          );
        
        localStorage.setItem(key, '1');
        setIsSubscribed(true);
        console.log('[Push] Auto-registered for notifications');
      } catch (err) {
        console.warn('[Push] Auto-registration failed:', err);
      }
    }
  }, [user, isSupported]);

  useEffect(() => {
    if (!isSupported || !user) return;

    // Check if already subscribed
    checkExistingSubscription();
    
    // Auto-register if permission is already granted
    autoRegisterForPush();
    
    // Setup foreground message handler
    initializeFirebase().then(() => {
      setupForegroundMessageHandler((payload) => {
        // Show toast for foreground messages
        toast(payload.notification?.title || 'New notification', {
          description: payload.notification?.body,
        });
      });
    }).catch(console.error);
  }, [isSupported, user, checkExistingSubscription, autoRegisterForPush]);

  const refreshPermission = useCallback(() => {
    if (!isSupported) return;
    setPermission(Notification.permission);
  }, [isSupported]);

  const subscribe = useCallback(async () => {
    if (!isSupported || !user) {
      toast.error('Push notifications are not supported');
      console.error('Push not supported or no user', { isSupported, user: !!user });
      return false;
    }

    setIsLoading(true);

    try {
      // If the user has previously denied, the browser will not show the prompt again.
      if (Notification.permission === 'denied') {
        setPermission('denied');
        toast.error('Notifications are blocked in your browser settings');
        return false;
      }

      // Request permission
      const permissionResult = await Notification.requestPermission();
      setPermission(permissionResult);

      if (permissionResult !== 'granted') {
        toast.error('Notification permission denied');
        return false;
      }

      // Register Firebase service worker
      const registration = await registerServiceWorkerWithConfig();

      // Get FCM token
      const fcmToken = await getFCMToken(registration);

      console.log('FCM Token obtained:', fcmToken.substring(0, 20) + '...');

      // Save FCM token to database
      // We store the token in p256dh field and use a unique endpoint
      const endpoint = `https://fcm.googleapis.com/fcm/send/${fcmToken}`;
      
      const { error: saveError } = await supabase
        .from('push_subscriptions')
        .upsert(
          {
            user_id: user.id,
            endpoint: endpoint,
            p256dh: fcmToken,
            auth: 'fcm', // Marker to identify FCM subscriptions
          },
          {
            onConflict: 'user_id,endpoint',
          }
        );

      if (saveError) {
        throw new Error(`Failed to save subscription: ${saveError.message}`);
      }

      setIsSubscribed(true);
      toast.success('Push notifications enabled!');
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Error subscribing to push:', error);
      toast.error(message);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [isSupported, user]);

  const unsubscribe = useCallback(async () => {
    if (!user) return false;

    setIsLoading(true);

    try {
      // Remove all subscriptions for this user from database
      await supabase
        .from('push_subscriptions')
        .delete()
        .eq('user_id', user.id);

      // Unregister the service worker
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        if (registration.active?.scriptURL.includes('firebase-messaging-sw.js')) {
          await registration.unregister();
        }
      }

      setIsSubscribed(false);
      toast.success('Push notifications disabled');
      return true;
    } catch (error) {
      console.error('Error unsubscribing:', error);
      toast.error('Failed to disable push notifications');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  return {
    isSupported,
    isSubscribed,
    isLoading,
    permission,
    refreshPermission,
    subscribe,
    unsubscribe,
  };
}
