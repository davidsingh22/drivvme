import { initializeApp, FirebaseApp } from 'firebase/app';
import { getMessaging, getToken, onMessage, Messaging } from 'firebase/messaging';
import { supabase } from '@/integrations/supabase/client';

let app: FirebaseApp | null = null;
let messaging: Messaging | null = null;
let cachedConfig: { config: Record<string, string>; vapidKey: string } | null = null;

export async function getFirebaseConfig() {
  if (cachedConfig) return cachedConfig;
  
  const { data, error } = await supabase.functions.invoke('get-firebase-config');
  
  if (error) {
    throw new Error(`Failed to fetch Firebase config: ${error.message}`);
  }
  
  if (!data?.config) {
    throw new Error('Invalid Firebase configuration');
  }
  
  cachedConfig = data;
  return cachedConfig;
}

export async function initializeFirebase(): Promise<{ app: FirebaseApp; messaging: Messaging }> {
  if (app && messaging) {
    return { app, messaging };
  }
  
  const { config } = await getFirebaseConfig();
  
  app = initializeApp(config);
  messaging = getMessaging(app);
  
  return { app, messaging };
}

export async function registerServiceWorkerWithConfig(): Promise<ServiceWorkerRegistration> {
  const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
  await navigator.serviceWorker.ready;
  
  // Send Firebase config to service worker
  const { config } = await getFirebaseConfig();
  
  if (registration.active) {
    registration.active.postMessage({
      type: 'FIREBASE_CONFIG',
      config,
    });
  }
  
  return registration;
}

export async function getFCMToken(registration: ServiceWorkerRegistration): Promise<string> {
  const { messaging } = await initializeFirebase();
  const { vapidKey } = await getFirebaseConfig();
  
  if (!vapidKey) {
    throw new Error('VAPID key not configured');
  }
  
  const token = await getToken(messaging, {
    vapidKey,
    serviceWorkerRegistration: registration,
  });
  
  if (!token) {
    throw new Error('Failed to get FCM token');
  }
  
  return token;
}

export function setupForegroundMessageHandler(callback: (payload: any) => void) {
  if (!messaging) {
    console.warn('Firebase messaging not initialized');
    return;
  }
  
  return onMessage(messaging, (payload) => {
    console.log('[Firebase] Foreground message received:', payload);
    callback(payload);
  });
}

export { app, messaging };
