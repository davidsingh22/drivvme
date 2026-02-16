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
      })
      .catch((e) => {
        console.log("❌ OneSignal External ID error:", (e as any)?.message || e);
      });
  });
}
