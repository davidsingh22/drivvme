import { supabase } from "@/integrations/supabase/client";

let lastId: string | null = null;

/**
 * Median-native OneSignal auth linker.
 * Uses window.median.onesignal bridge (only available inside Median/GoNative app).
 * Falls back silently when not running in the native wrapper.
 */
export function initMedianOneSignalAuthLink() {
  supabase.auth.onAuthStateChange(async (_event, session) => {
    try {
      if (!(window as any).median?.onesignal) {
        console.log("Median OneSignal bridge not available (not in app).");
        return;
      }

      const median = (window as any).median;
      const uid = session?.user?.id;

      if (uid) {
        if (lastId === uid) return;
        median.onesignal.externalUserId.set(uid);
        lastId = uid;
        console.log("✅ Median Bridge: External ID set to", uid);
      } else {
        lastId = null;
        median.onesignal.externalUserId.remove();
        console.log("✅ Median OneSignal external ID removed");
      }
    } catch (e) {
      console.log("❌ Median OneSignal error:", e);
    }
  });
}
