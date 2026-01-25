import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Prefetch mapbox token immediately on app load for faster map rendering
import { prefetchMapboxToken } from "@/hooks/useMapboxToken";
prefetchMapboxToken();

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
