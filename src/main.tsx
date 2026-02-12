import { createRoot } from "react-dom/client";
import OneSignal from "react-onesignal";
import App from "./App.tsx";
import "./index.css";

// Prefetch mapbox token immediately on app load for faster map rendering
import { prefetchMapboxToken } from "@/hooks/useMapboxToken";
prefetchMapboxToken();

// Initialize OneSignal push notifications
OneSignal.init({
  appId: "5a6c4131-8faa-4969-b5c4-5a09033c8e2a",
  allowLocalhostAsSecureOrigin: true,
}).then(() => {
  console.log("[OneSignal] Initialized");
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
