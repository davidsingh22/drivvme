import { supabase } from "@/integrations/supabase/client";
import { setPendingRideFromNotification } from "@/lib/pendingRideStore";
import { broadcastNewRide } from "@/lib/rideBroadcast";

let lastExternalId: string | null = null;

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

/** Hard-reset localStorage and inject new ride_id */
function forceSetNewRide(rideId: string) {
  // FORCE-CLEAR first — every beep is a brand-new event
  localStorage.removeItem('pendingRideFromPush');
  localStorage.removeItem('last_notified_ride');
  // Now set fresh
  localStorage.setItem('pendingRideFromPush', rideId);
  localStorage.setItem('last_notified_ride', rideId);
  setPendingRideFromNotification(rideId);
  broadcastNewRide(rideId);
  console.log('🔔 OneSignal: force-set new ride:', rideId);
}

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

        try {
          if (OneSignal.Notifications?.addEventListener) {
            // --- Click handler (cold start / background tap) ---
            OneSignal.Notifications.addEventListener("click", (event: any) => {
              const data = event?.notification?.additionalData || event?.result?.notification?.additionalData || {};
              console.log("🔔 OneSignal notification clicked, data:", data);
              if (data.ride_id) {
                forceSetNewRide(data.ride_id);
                const lastRoute = localStorage.getItem('last_route');
                window.location.href = lastRoute === '/driver' ? '/driver' : '/ride';
              }
            });

            // --- Foreground handler (app is open) ---
            OneSignal.Notifications.addEventListener("foregroundWillDisplay", (event: any) => {
              const data = event?.notification?.additionalData || {};
              console.log("🔔 OneSignal foreground notification:", data);
              if (data.ride_id) {
                forceSetNewRide(data.ride_id);
              }
            });

            console.log("✅ OneSignal click + foreground handlers registered");
          }
        } catch (e) {
          console.log("OneSignal handler registration failed (non-fatal):", e);
        }
      })
      .catch((e) => {
        console.log("❌ OneSignal External ID error:", (e as any)?.message || e);
      });
  });
}
