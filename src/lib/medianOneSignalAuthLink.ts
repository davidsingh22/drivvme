import { supabase } from "@/integrations/supabase/client";
import { setPendingRideFromNotification } from "@/lib/pendingRideStore";
import { broadcastNewRide } from "@/lib/rideBroadcast";

let lastId: string | null = null;

function extractRideId(payload: any): string | null {
  const data = payload?.additionalData || payload?.custom?.a || payload?.data || {};
  return data?.ride_id || data?.rideId || null;
}

function forceSetNewRide(rideId: string) {
  try {
    localStorage.removeItem('pendingRideFromPush');
    localStorage.removeItem('last_notified_ride');
    delete (window as any).__FAST_PATH_RIDE_ID;
  } catch {
    // ignore storage issues
  }

  try {
    localStorage.setItem('pendingRideFromPush', rideId);
    localStorage.setItem('last_notified_ride', rideId);
    (window as any).__FAST_PATH_RIDE_ID = rideId;
  } catch {
    // ignore storage issues
  }

  setPendingRideFromNotification(rideId);
  broadcastNewRide(rideId);
  console.log("🔔 Median push: force-set new ride:", rideId);
}

function routeAfterRideNotification() {
  try {
    const lastRoute = localStorage.getItem('last_route');
    window.location.href = lastRoute === '/driver' ? '/driver' : '/ride';
  } catch {
    window.location.href = '/driver';
  }
}

function handleRideNotificationOpen(payload: any) {
  const rideId = extractRideId(payload);
  if (!rideId) return;

  forceSetNewRide(rideId);
  routeAfterRideNotification();
}

/**
 * Median-native OneSignal auth linker.
 * Registers a `median_library_ready` callback so the bridge is guaranteed
 * to be available, then uses `median.onesignal.externalUserId.set()`.
 * Falls back to the gonative:// deep-link scheme if the JS bridge throws.
 */
export function initMedianOneSignalAuthLink() {
  // Queue: auth changes that arrive before the bridge is ready
  let pendingUid: string | null | undefined = undefined;

  const applyExternalId = (uid: string | null) => {
    try {
      const median = (window as any).median;
      if (!median?.onesignal) {
        console.log("Median OneSignal bridge not available (not in app).");
        return;
      }

      if (uid) {
        if (lastId === uid) return;
        try {
          median.onesignal.externalUserId.set({ externalId: uid });
        } catch {
          // Nuclear fallback: deep-link scheme
          window.location.href = `gonative://onesignal/externalUserId/set?externalId=${uid}`;
        }
        lastId = uid;
        console.log("✅ Median Bridge: External ID set to", uid);
      } else {
        lastId = null;
        try {
          median.onesignal.externalUserId.remove();
        } catch {
          // ignore
        }
        console.log("✅ Median OneSignal external ID removed");
      }
    } catch (e) {
      console.log("❌ Median OneSignal error:", e);
    }
  };

  // Register the Median library-ready callback
  (window as any).median_library_ready = () => {
    console.log("✅ Median library ready");
    if (pendingUid !== undefined) {
      applyExternalId(pendingUid);
      pendingUid = undefined;
    }

    // Register Median native notification open handler
    try {
      const median = (window as any).median;
      if (median?.oneSignalPushOpened) {
        // Median v2+ callback
        (window as any).gonative_onesignal_push_opened = (payload: any) => {
          console.log("🔔 Median push opened, payload:", payload);
          handleRideNotificationOpen(payload);
        };
        console.log("✅ Median push open handler registered");
      }
    } catch (e) {
      console.log("Median push open handler failed (non-fatal):", e);
    }
  };

  // Also register the global handler for Median GoNative push opens
  (window as any).gonative_onesignal_push_opened = (payload: any) => {
    console.log("🔔 Median push opened (early), payload:", payload);
    handleRideNotificationOpen(payload);
  };

  supabase.auth.onAuthStateChange((_event, session) => {
    const uid = session?.user?.id ?? null;

    if ((window as any).median?.onesignal) {
      applyExternalId(uid);
    } else {
      // Bridge not ready yet — queue for median_library_ready
      pendingUid = uid;
    }
  });
}
