// Firebase Cloud Messaging Service Worker
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// Firebase config will be passed via messaging.onBackgroundMessage
// Initialize with placeholder - will be configured when first message arrives
let firebaseConfig = null;
let messaging = null;

self.addEventListener('install', (event) => {
  console.log('[FCM SW] Service Worker installed');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[FCM SW] Service Worker activated');
  event.waitUntil(self.clients.claim());
});

// Handle messages from the main app to configure Firebase
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'FIREBASE_CONFIG') {
    console.log('[FCM SW] Received Firebase config');
    firebaseConfig = event.data.config;
    
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
      messaging = firebase.messaging();
      
      messaging.onBackgroundMessage((payload) => {
        console.log('[FCM SW] Received background message:', payload);
        
        const notificationTitle = payload.notification?.title || payload.data?.title || 'DrivvMe';
        const notificationOptions = {
          body: payload.notification?.body || payload.data?.body || 'You have a new notification',
          icon: payload.notification?.icon || '/favicon.ico',
          badge: '/favicon.ico',
          vibrate: [300, 100, 300, 100, 300],
          tag: payload.data?.tag || 'ride-request',
          requireInteraction: true,
          data: payload.data || {},
          actions: [
            { action: 'open', title: 'Open App' },
            { action: 'dismiss', title: 'Dismiss' }
          ]
        };

        return self.registration.showNotification(notificationTitle, notificationOptions);
      });
    }
  }
});

// Fallback for push events if Firebase messaging isn't initialized yet
self.addEventListener('push', (event) => {
  // If Firebase messaging is handling it, skip
  if (messaging) return;
  
  console.log('[FCM SW] Push received (fallback):', event);

  let data = {
    title: 'DrivvMe',
    body: 'You have a new notification',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    data: {}
  };

  try {
    if (event.data) {
      const payload = event.data.json();
      console.log('[FCM SW] Push payload:', payload);
      data = {
        title: payload.notification?.title || payload.data?.title || data.title,
        body: payload.notification?.body || payload.data?.body || data.body,
        icon: payload.notification?.icon || data.icon,
        badge: data.badge,
        data: payload.data || {}
      };
    }
  } catch (e) {
    console.error('[FCM SW] Error parsing push data:', e);
  }

  const options = {
    body: data.body,
    icon: data.icon,
    badge: data.badge,
    vibrate: [300, 100, 300, 100, 300],
    tag: 'ride-request',
    requireInteraction: true,
    data: data.data,
    actions: [
      { action: 'open', title: 'Open App' },
      { action: 'dismiss', title: 'Dismiss' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  console.log('[FCM SW] Notification clicked:', event);
  event.notification.close();

  if (event.action === 'dismiss') {
    return;
  }

  const urlToOpen = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.navigate(urlToOpen);
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(urlToOpen);
        }
      })
  );
});
