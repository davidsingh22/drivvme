import { initializeApp, getApps, getApp, deleteApp, FirebaseApp } from 'firebase/app';
import { getMessaging, getToken, onMessage, Messaging } from 'firebase/messaging';
import { supabase } from '@/integrations/supabase/client';

let app: FirebaseApp | null = null;
let messaging: Messaging | null = null;
let cachedConfig: { config: Record<string, string>; vapidKey: string } | null = null;
let lastConfigHash: string | null = null;

function normalizeBase64Url(input: string): string {
  // Firebase expects the Web Push (VAPID) public key in URL-safe base64.
  // We defensively normalize the string to avoid atob() failures caused by
  // whitespace/padding issues.
  const trimmed = (input || '').trim();
  const withoutWhitespace = trimmed.replace(/\s+/g, '');
  // Convert base64url -> base64 for validation/compat (some browsers/SDK internals call atob)
  const base64 = withoutWhitespace.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (base64.length % 4)) % 4;
  return base64 + '='.repeat(padLen);
}

function hashConfig(config: Record<string, string>): string {
  return JSON.stringify(config);
}

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
  const { config } = await getFirebaseConfig();
  const configHash = hashConfig(config);
  
  // If config changed, we need to reinitialize
  if (app && lastConfigHash && lastConfigHash !== configHash) {
    console.log('[Firebase] Config changed, reinitializing...');
    try {
      await deleteApp(app);
    } catch (e) {
      console.warn('[Firebase] Failed to delete old app:', e);
    }
    app = null;
    messaging = null;
  }
  
  if (app && messaging) {
    return { app, messaging };
  }
  
  // Check if a default app already exists (e.g., from HMR or previous init)
  const existingApps = getApps();
  if (existingApps.length > 0) {
    // Use existing app if config matches, otherwise delete and recreate
    const existingApp = getApp();
    try {
      app = existingApp;
      messaging = getMessaging(app);
      lastConfigHash = configHash;
      return { app, messaging };
    } catch (e) {
      console.warn('[Firebase] Existing app incompatible, recreating...', e);
      try {
        await deleteApp(existingApp);
      } catch (delErr) {
        console.warn('[Firebase] Could not delete existing app:', delErr);
      }
    }
  }
  
  app = initializeApp(config);
  messaging = getMessaging(app);
  lastConfigHash = configHash;
  
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
  
  // 1) Try with provided VAPID key (normalized)
  // 2) If the SDK throws (notably atob/base64 errors), retry without vapidKey.
  //    Some setups have a default key configured and don't require passing it.
  let token: string | null = null;
  try {
    const normalizedForAtob = normalizeBase64Url(vapidKey);
    // getToken expects base64url, but normalizing for atob() can help on some platforms.
    // Convert back to base64url (no padding) for the SDK call.
    const normalizedForSdk = normalizedForAtob
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');

    token = await getToken(messaging, {
      vapidKey: normalizedForSdk,
      serviceWorkerRegistration: registration,
    });
  } catch (err) {
    console.warn('[Firebase] getToken failed with vapidKey; retrying without vapidKey', err);
    token = await getToken(messaging, {
      serviceWorkerRegistration: registration,
    } as any);
  }
  
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
    
    // Show a system notification while the app is open
    if (Notification.permission === 'granted') {
      const title = payload?.notification?.title || 'DrivvMe';
      const body = payload?.notification?.body || 'New notification';
      new Notification(title, { body });
    }
    
    callback(payload);
  });
}

export { app, messaging };
