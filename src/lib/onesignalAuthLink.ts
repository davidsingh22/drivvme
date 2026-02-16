import { supabase } from "@/integrations/supabase/client";

let lastExternalId: string | null = null;

/**
 * Standalone OneSignal ↔ Supabase auth linker.
 * Uses OneSignalDeferred queue so it works even if the SDK hasn't loaded yet.
 * Calls OneSignal.login(uid) to set the External ID and merge subscriptions.
 */
export function initOneSignalAuthLink() {
  (window as any).OneSignalDeferred = (window as any).OneSignalDeferred || [];

  supabase.auth.onAuthStateChange((_event, session) => {
    (window as any).OneSignalDeferred.push(async (OneSignal: any) => {
      try {
        const uid = session?.user?.id;
        if (uid) {
          if (lastExternalId === uid) return;
          await OneSignal.login(uid);
          lastExternalId = uid;
          console.log("✅ OneSignal External ID linked:", uid);
        } else {
          lastExternalId = null;
          await OneSignal.logout();
          console.log("✅ OneSignal logged out");
        }
      } catch (e) {
        console.log("❌ OneSignal login/logout error:", e);
      }
    });
  });
}
