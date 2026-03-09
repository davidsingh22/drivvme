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

      // 4. Tag with uid + role (reliable even if login() fails)
      try {
        await tagUser(os, userId);
      } catch (e) {
        console.warn("[PlayerSync] Tagging failed (non-fatal):", e);
      }

      // 5. POST to edge function
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

/** Wait for an actual OneSignal SDK instance (not just the deferred queue) */
async function waitForOneSignalSDK(): Promise<any | null> {
  for (let i = 0; i < 20; i++) {
    const direct = (window as any).OneSignal;
    if (direct && (typeof direct.login === "function" || direct?.User?.PushSubscription)) {
      return direct;
    }

    const deferred = (window as any).OneSignalDeferred;
    if (Array.isArray(deferred)) {
      const resolved = await new Promise<any | null>((resolve) => {
        let done = false;
        deferred.push((os: any) => {
          if (!done) {
            done = true;
            resolve(os || null);
          }
        });
        setTimeout(() => {
          if (!done) {
            done = true;
            resolve(null);
          }
        }, 250);
      });
      if (resolved) return resolved;
    }

    await sleep(500);
  }

  console.warn("[PlayerSync] OneSignal SDK not found after retries");
  return null;
}

/** Poll for the player / subscription ID (up to ~10s) */
async function pollPlayerId(os: any): Promise<string | null> {
  for (let i = 0; i < 20; i++) {
    const id = await readPlayerId(os);
    if (id) return id;
    await sleep(500);
  }
  return null;
}

async function readPlayerId(os: any): Promise<string | null> {
  try {
    const subId = os?.User?.PushSubscription?.id;
    if (subId) return subId;
  } catch (_) {}

  try {
    const legacy = await os?.getUserId?.();
    if (typeof legacy === "string" && legacy) return legacy;
  } catch (_) {}

  try {
    const state = await os?.getDeviceState?.();
    if (state?.userId) return state.userId;
  } catch (_) {}

  return null;
}

async function tagUser(os: any, userId: string) {
  // Determine role from current path
  const role = window.location.pathname.startsWith("/driver") ? "driver" : "rider";

  if (os?.User?.addTag) {
    await os.User.addTag("uid", userId);
    await os.User.addTag("role", role);
    console.log(`[PlayerSync] ✅ Tagged uid=${userId}, role=${role} (modern API)`);
  } else if (typeof os?.sendTag === "function") {
    os.sendTag("uid", userId);
    os.sendTag("role", role);
    console.log(`[PlayerSync] ✅ Tagged uid=${userId}, role=${role} (legacy API)`);
  } else {
    console.warn("[PlayerSync] No tagging API available");
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
