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

  // --- Enable verbose OneSignal native debug logging ---
  try {
    const median = (window as any).median;
    if (median?.onesignal?.setLogLevel) {
      median.onesignal.setLogLevel({ logLevel: 6, visualLevel: 0 });
      console.log("✅ [MedianBridge] OneSignal debug log level set to 6 (VERBOSE)");
    }
  } catch (e) {
    console.log("[MedianBridge] setLogLevel failed (non-fatal):", e);
  }

  // --- Floating status label ---
  const updateStatusLabel = (text: string) => {
    let el = document.getElementById("median-reg-status");
    if (!el) {
      el = document.createElement("div");
      el.id = "median-reg-status";
      el.style.cssText =
        "position:fixed;bottom:8px;left:50%;transform:translateX(-50%);z-index:99999;" +
        "background:rgba(0,0,0,0.85);color:#0f0;padding:6px 16px;border-radius:8px;" +
        "font-size:12px;font-family:monospace;pointer-events:none;";
      document.body.appendChild(el);
    }
    el.textContent = text;
  };

  updateStatusLabel("Registering...");

  // --- Native bridge registration with explicit googleProjectNumber ---
  const attemptNativeRegistration = (source: string) => {
    try {
      const median = (window as any).median;
      const gonative = (window as any).gonative;
      console.log(`[MedianBridge] attemptNativeRegistration (${source})`);

      const regPayload = {
        appId: "5a6c4131-8faa-4969-b5c4-5a09033c8e2a",
        googleProjectNumber: "640478051658",
      };

      if (median?.onesignal?.register) {
        median.onesignal.register(regPayload);
        console.log(`✅ [MedianBridge] Called median.onesignal.register(${JSON.stringify(regPayload)}) [${source}]`);
        updateStatusLabel(`Registration Sent (${source})`);
        return true;
      } else if (gonative?.onesignal?.register) {
        gonative.onesignal.register(regPayload);
        console.log(`✅ [MedianBridge] Called gonative.onesignal.register() [${source}]`);
        updateStatusLabel(`Registration Sent (${source})`);
        return true;
      } else if ((window as any).despia?.registerpush) {
        (window as any).despia.registerpush();
        console.log(`✅ [MedianBridge] Called despia.registerpush() [${source}]`);
        updateStatusLabel(`Registration Sent (${source})`);
        return true;
      } else {
        console.log(`[MedianBridge] No native register method found [${source}]`);
        updateStatusLabel(`No bridge found (${source})`);
        return false;
      }
    } catch (e) {
      console.log(`[MedianBridge] Registration error [${source}]:`, e);
      updateStatusLabel(`Reg error: ${e}`);
      return false;
    }
  };

  // Try immediately in case bridge is already loaded
  attemptNativeRegistration("immediate");

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
    console.log("✅ [MedianBridge] median_library_ready fired — bridge is now available");

    // Set debug log level now that bridge is ready
    try {
      const m = (window as any).median;
      if (m?.onesignal?.setLogLevel) {
        m.onesignal.setLogLevel({ logLevel: 6, visualLevel: 0 });
        console.log("✅ [MedianBridge] Debug log level set to 6 on library_ready");
      }
    } catch (e) { /* ignore */ }

    // Register now that bridge is guaranteed ready
    attemptNativeRegistration("median_library_ready");

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
