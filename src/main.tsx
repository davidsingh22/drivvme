import { createRoot } from "react-dom/client";
import OneSignal from "react-onesignal";
import App from "./App.tsx";
import "./index.css";
import { setPendingRideFromNotification } from "@/lib/pendingRideStore";

// === FAST-PATH: Check localStorage for pending ride from notification tap ===
// This runs BEFORE React renders, so the app can skip loading animations.
try {
  const pendingRide = localStorage.getItem('pendingRideFromPush') || localStorage.getItem('last_notified_ride');
  if (pendingRide) {
    console.log('[FastPath] 🚀 Found pending_ride from notification tap:', pendingRide);
    (window as any).__FAST_PATH_RIDE_ID = pendingRide;
    setPendingRideFromNotification(pendingRide);

    // Pre-warm: fetch ride data NOW, before React even mounts
    import('@/integrations/supabase/client').then(({ supabase }) => {
      supabase.from('rides')
        .select('id, pickup_address, dropoff_address, estimated_fare, distance_km, estimated_duration_minutes, pickup_lat, pickup_lng, status')
        .eq('id', pendingRide)
        .maybeSingle()
        .then(({ data }) => {
          if (data) (window as any).__PREFETCHED_RIDE = data;
        });
    });
  }
} catch { /* ignore */ }

// Prefetch mapbox token immediately on app load for faster map rendering
import { prefetchMapboxToken } from "@/hooks/useMapboxToken";
prefetchMapboxToken();

// Initialize OneSignal push notifications
OneSignal.init({
  appId: "5a6c4131-8faa-4969-b5c4-5a09033c8e2a",
  allowLocalhostAsSecureOrigin: true,
  promptOptions: {
    slidedown: {
      prompts: [{
        type: "push" as const,
        autoPrompt: true,
        delay: { pageViews: 1, timeDelay: 3 },
      }]
    }
  }
}).then(async () => {
  console.log("[OneSignal] Initialized");
  try {
    await OneSignal.Notifications.requestPermission();
    const permission = await OneSignal.Notifications.permission;
    console.log("🔔 Permission:", permission);
  } catch (err) {
    console.warn("[OneSignal] Permission request failed:", err);
  }
}).catch((err) => {
  console.warn("[OneSignal] Init failed:", err);
});

// PWA service worker is auto-registered by vite-plugin-pwa
// Firebase messaging service worker for push notifications
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/firebase-messaging-sw.js')
    .then((registration) => {
      console.log('Firebase SW registered:', registration.scope);
    })
    .catch((error) => {
      console.error('Firebase SW registration failed:', error);
    });
}

createRoot(document.getElementById("root")!).render(<App />);
