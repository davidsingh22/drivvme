// Ensure OneSignal External ID is set on BOTH web and Median iOS/Android
// using the Supabase user id (session.user.id)

import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

function waitForOneSignal(maxMs = 10000): Promise<any> {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      if ((window as any).OneSignal) return resolve((window as any).OneSignal);

      if ((window as any).OneSignalDeferred) {
        (window as any).OneSignalDeferred.push((OneSignal: any) => resolve(OneSignal));
        return;
      }

      if (Date.now() - start > maxMs) return resolve(null);
      setTimeout(tick, 250);
    };
    tick();
  });
}

export function useOneSignalLinking() {
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    (async () => {
      const OneSignal = await waitForOneSignal();
      if (!OneSignal) {
        console.log("⚠️ OneSignal SDK not available after timeout");
        return;
      }

      const { data } = supabase.auth.onAuthStateChange(async (_event, session) => {
        try {
          if (session?.user?.id) {
            await OneSignal.login(session.user.id); // Sets External ID
            console.log("✅ OneSignal External ID set:", session.user.id);
            try {
              await OneSignal.User.addTag("role", "authed");
            } catch {}
          } else {
            await OneSignal.logout();
            console.log("✅ OneSignal logout");
          }
        } catch (e) {
          console.log("OneSignal link error:", e);
        }
      });

      unsubscribe = data?.subscription?.unsubscribe;
    })();

    return () => unsubscribe?.();
  }, []);
}
