import { supabase } from "@/integrations/supabase/client";

let lastId: string | null = null;

/**
 * Median-native OneSignal auth linker.
 * Registers a `median_library_ready` callback so the bridge is guaranteed
 * to be available, then uses `median.onesignal.externalUserId.set()`.
 * Falls back to the gonative:// deep-link scheme if the JS bridge throws.
 */
export function initMedianOneSignalAuthLink() {
  // Queue: auth changes that arrive before the bridge is ready
  let pendingUid: string | null | undefined = undefined;

  // --- Native bridge registration ---
  try {
    const median = (window as any).median;
    const gonative = (window as any).gonative;
    console.log("[MedianBridge] median object:", typeof median, median ? Object.keys(median) : "N/A");
    console.log("[MedianBridge] median.onesignal:", typeof median?.onesignal);
    console.log("[MedianBridge] gonative object:", typeof gonative);

    if (median?.onesignal?.register) {
      median.onesignal.register();
      console.log("✅ [MedianBridge] Called median.onesignal.register()");
    } else if ((window as any).despia?.registerpush) {
      (window as any).despia.registerpush();
      console.log("✅ [MedianBridge] Called despia.registerpush()");
    } else if (gonative?.onesignal?.register) {
      gonative.onesignal.register();
      console.log("✅ [MedianBridge] Called gonative.onesignal.register()");
    } else {
      console.log("[MedianBridge] No native register method found (web browser?)");
    }
  } catch (e) {
    console.log("[MedianBridge] Registration attempt error (non-fatal):", e);
  }

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
    console.log("✅ [MedianBridge] median_library_ready fired");
    const median = (window as any).median;
    console.log("[MedianBridge] Bridge keys at ready:", median ? Object.keys(median) : "N/A");
    console.log("[MedianBridge] onesignal keys:", median?.onesignal ? Object.keys(median.onesignal) : "N/A");

    // Attempt registration again now that bridge is ready
    try {
      if (median?.onesignal?.register) {
        median.onesignal.register();
        console.log("✅ [MedianBridge] Called register() on library_ready");
      }
    } catch (e) {
      console.log("[MedianBridge] register() on ready failed:", e);
    }

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
          const data = payload?.additionalData || payload?.custom?.a || {};
          if (data.ride_id) {
            window.location.href = "/ride";
          }
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
    const data = payload?.additionalData || payload?.custom?.a || {};
    if (data.ride_id) {
      window.location.href = "/ride";
    }
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
