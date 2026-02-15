import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Robustly syncs the OneSignal device/player ID to profiles.onesignal_player_id.
 * Works on native Median iOS even when External ID is blank.
 * Retries SDK detection for ~5 seconds and polls for player ID for ~8 seconds.
 */
export function useOneSignalPlayerSync() {
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      // 1. Wait for auth session
      const { data } = await supabase.auth.getSession();
      const userId = data?.session?.user?.id;
      if (!userId) {
        console.log("[PlayerSync] No auth session, skipping");
        return;
      }

      // 2. Wait for OneSignal SDK (up to ~5 s)
      const os = await waitForOneSignalSDK();
      if (!os || cancelled) return;
      console.log("[PlayerSync] ✅ OneSignal SDK found");

      // 3. Poll for player / subscription ID (up to ~8 s)
      const playerId = await pollPlayerId(os);
      if (cancelled) return;

      if (!playerId) {
        console.warn("[PlayerSync] ⚠️ Could not obtain player ID after retries");
        return;
      }

      console.log("[PlayerSync] 🆔 OneSignal playerId:", playerId);

      // 4. Upsert into profiles
      const { error } = await supabase
        .from("profiles")
        .update({ onesignal_player_id: playerId })
        .eq("user_id", userId);

      if (error) {
        console.error("[PlayerSync] ❌ Failed to save player ID:", error.message);
      } else {
        console.log("[PlayerSync] ✅ Saved onesignal_player_id to Supabase for", userId);
      }
    };

    run();

    // Also re-run when app resumes from background (iOS)
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        run();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
}

/** Wait for window.OneSignal to be available, polling every 500ms for ~5s */
async function waitForOneSignalSDK(): Promise<any | null> {
  for (let i = 0; i < 10; i++) {
    const os = (window as any).OneSignal;
    if (os) return os;
    await sleep(500);
  }
  console.warn("[PlayerSync] OneSignal SDK not found after 5s");
  return null;
}

/** Try multiple SDK methods to get the device player / subscription ID */
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
    // v16+ SDK: User.PushSubscription.id
    const subId = os?.User?.PushSubscription?.id;
    if (subId) return subId;
  } catch (_) {}

  try {
    // Older SDKs: getUserId
    const legacy = os?.getUserId?.();
    if (typeof legacy === "string" && legacy) return legacy;
  } catch (_) {}

  try {
    // Median / GoNative bridge
    const state = os?.getDeviceState?.();
    if (state?.userId) return state.userId;
  } catch (_) {}

  return null;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
