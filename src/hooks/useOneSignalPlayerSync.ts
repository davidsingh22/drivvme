import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Backend-driven OneSignal player ID sync.
 * Polls for the SDK + player ID, then POSTs it to the
 * bind-onesignal-player-id edge function (auth-secured).
 * Re-runs on auth state change and app resume (visibilitychange).
 */
export function useOneSignalPlayerSync() {
  useEffect(() => {
    let cancelled = false;

    const sync = async () => {
      // 1. Get auth session + token
      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData?.session;
      if (!session?.user?.id || !session?.access_token) {
        console.log("[PlayerSync] No auth session, skipping");
        return;
      }
      const userId = session.user.id;

      // 2. Wait for OneSignal SDK (up to ~5s)
      const os = await waitForOneSignalSDK();
      if (!os || cancelled) return;
      console.log("[PlayerSync] ✅ OneSignal SDK found");

      // 3. Poll for player / subscription ID (up to ~8s)
      const playerId = await pollPlayerId(os);
      if (cancelled) return;

      if (!playerId) {
        console.warn("[PlayerSync] ⚠️ Could not obtain player ID after retries");
        return;
      }

      console.log("[PlayerSync] 🆔 OneSignal playerId:", playerId);

      // 4. POST to edge function
      try {
        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bind-onesignal-player-id`;
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ playerId }),
        });

        if (!res.ok) {
          const errBody = await res.text();
          console.error("[PlayerSync] ❌ Edge function error:", res.status, errBody);
        } else {
          console.log("[PlayerSync] ✅ Saved onesignal_player_id via edge function for", userId);
        }
      } catch (err) {
        console.error("[PlayerSync] ❌ Network error calling edge function:", err);
      }
    };

    // Run immediately
    sync();

    // Re-run on auth state change (login)
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) {
        sync();
      }
    });

    // Re-run when app resumes from background (iOS)
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        sync();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      authListener?.subscription.unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
}

/** Wait for window.OneSignal to be available, polling every 500ms for ~5s */
async function waitForOneSignalSDK(): Promise<any | null> {
  for (let i = 0; i < 10; i++) {
    const os = (window as any).OneSignal || (window as any).OneSignalDeferred;
    if (os) return os;
    await sleep(500);
  }
  console.warn("[PlayerSync] OneSignal SDK not found after 5s");
  return null;
}

/** Poll for the player / subscription ID (up to ~8s) */
async function pollPlayerId(os: any): Promise<string | null> {
  for (let i = 0; i < 16; i++) {
    const id = readPlayerId(os);
    if (id) return id;
    await sleep(500);
  }
  return null;
}

function readPlayerId(os: any): string | null {
  try {
    const subId = os?.User?.PushSubscription?.id;
    if (subId) return subId;
  } catch (_) {}

  try {
    const legacy = os?.getUserId?.();
    if (typeof legacy === "string" && legacy) return legacy;
  } catch (_) {}

  try {
    const state = os?.getDeviceState?.();
    if (state?.userId) return state.userId;
  } catch (_) {}

  return null;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
