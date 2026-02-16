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
        await median.onesignal.login(uid);
        lastId = uid;
        const info = await median.onesignal.info();
        console.log("✅ Median OneSignal linked:", info);
      } else {
        lastId = null;
        await median.onesignal.logout();
        console.log("✅ Median OneSignal logged out");
      }
    } catch (e) {
      console.log("❌ Median OneSignal error:", e);
    }
  });
}
