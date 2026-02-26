import { supabase } from "@/integrations/supabase/client";

let lastExternalId: string | null = null;

/**
 * Wait for OneSignal SDK to be fully ready (login method available).
 * Polls every 300ms, rejects after timeoutMs.
 */
function waitForOneSignal(timeoutMs = 30000): Promise<any> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      const os = (window as any).OneSignal;
      if (os && typeof os.login === "function") {
        clearInterval(timer);
        resolve(os);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        reject(new Error("OneSignal never became available"));
      }
    }, 300);
  });
}

/**
 * Standalone OneSignal ↔ Supabase auth linker.
 * Waits for OneSignal SDK to be ready, then calls OneSignal.login(uid)
 * to set the External ID and merge subscriptions (including iOS devices).
 */
export function initOneSignalAuthLink() {
  supabase.auth.onAuthStateChange((_event, session) => {
    const uid = session?.user?.id;

    waitForOneSignal()
      .then(async (OneSignal) => {
        if (uid) {
          if (lastExternalId === uid) return;
          await OneSignal.login(uid);
          lastExternalId = uid;
          console.log("✅ OneSignal External ID set:", uid);
        } else {
          lastExternalId = null;
          await OneSignal.logout();
          console.log("✅ OneSignal logged out");
        }

        // Register notification click handler (web SDK)
        try {
          if (OneSignal.Notifications?.addEventListener) {
            OneSignal.Notifications.addEventListener("click", (event: any) => {
              const data = event?.notification?.additionalData || event?.result?.notification?.additionalData || {};
              console.log("🔔 OneSignal notification clicked, data:", data);
              if (data.ride_id) {
                // Route drivers to /driver, riders to /ride
                const lastRoute = localStorage.getItem('last_route');
                window.location.href = lastRoute === '/driver' ? '/driver' : '/ride';
              }
            });
            console.log("✅ OneSignal notification click handler registered");
          }
        } catch (e) {
          console.log("OneSignal click handler registration failed (non-fatal):", e);
        }
      })
      .catch((e) => {
        console.log("❌ OneSignal External ID error:", (e as any)?.message || e);
      });
  });
}
