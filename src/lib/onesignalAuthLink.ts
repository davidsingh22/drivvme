import { supabase } from "@/integrations/supabase/client";

let lastExternalId: string | null = null;

/**
 * Standalone OneSignal ↔ Supabase auth linker.
 * Calls OneSignal.login(uid) on sign-in and OneSignal.logout() on sign-out.
 * Deduplicates so repeated auth events don't re-trigger login().
 */
export function initOneSignalAuthLink() {
  if (!window.OneSignal) {
    console.log("[OneSignalAuthLink] OneSignal not ready yet");
    return;
  }

  supabase.auth.onAuthStateChange(async (_event, session) => {
    try {
      const uid = session?.user?.id;
      if (uid) {
        if (lastExternalId === uid) return;
        await window.OneSignal.login(uid);
        lastExternalId = uid;
        console.log("✅ OneSignal External ID linked:", uid);
      } else {
        lastExternalId = null;
        await window.OneSignal.logout();
        console.log("✅ OneSignal logged out");
      }
    } catch (e) {
      console.log("❌ OneSignal login/logout error:", e);
    }
  });
}
