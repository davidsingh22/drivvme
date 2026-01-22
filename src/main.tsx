import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Prefetch mapbox token immediately on app load for faster map rendering
import { prefetchMapboxToken } from "@/hooks/useMapboxToken";
prefetchMapboxToken();

// Register service worker for push notifications
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js')
    .then((registration) => {
      console.log('Service Worker registered:', registration.scope);
    })
    .catch((error) => {
      console.error('Service Worker registration failed:', error);
    });
}

createRoot(document.getElementById("root")!).render(<App />);
