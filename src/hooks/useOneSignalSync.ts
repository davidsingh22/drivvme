// Robust OneSignal sync for web + Median iOS/Android
// 1. Sets External ID via login() or setExternalUserId() fallback
// 2. Reads player ID and persists to profiles.onesignal_player_id

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

async function setExternalId(OneSignal: any, userId: string) {
  // Try modern login() first, fall back to legacy setExternalUserId()
  try {
    if (typeof OneSignal.login === "function") {
      await OneSignal.login(userId);
      console.log("✅ OneSignal.login() set External ID:", userId);
      return;
    }
  } catch (e) {
    console.log("OneSignal.login() failed, trying fallback:", e);
  }

  try {
    if (typeof OneSignal.setExternalUserId === "function") {
      await OneSignal.setExternalUserId(userId);
      console.log("✅ OneSignal.setExternalUserId() set:", userId);
      return;
    }
  } catch (e) {
    console.log("OneSignal.setExternalUserId() also failed:", e);
  }
}

async function getPlayerId(OneSignal: any): Promise<string | null> {
  // Try newer API first: OneSignal.User.PushSubscription.id
  try {
    const subId = OneSignal?.User?.PushSubscription?.id;
    if (subId) return subId;
  } catch {}

  // Try legacy getUserId()
  try {
    if (typeof OneSignal.getUserId === "function") {
      const id = await OneSignal.getUserId();
      if (id) return id;
    }
  } catch {}

  // Try getDeviceState() (React Native / Median bridge)
  try {
    if (typeof OneSignal.getDeviceState === "function") {
      const state = await OneSignal.getDeviceState();
      if (state?.userId) return state.userId;
    }
  } catch {}

  return null;
}

async function persistPlayerId(userId: string, playerId: string) {
  const { error } = await supabase
    .from("profiles")
    .update({ onesignal_player_id: playerId })
    .eq("user_id", userId);

  if (error) {
    console.log("Failed to persist OneSignal player ID:", error.message);
  } else {
    console.log("✅ OneSignal player ID saved:", playerId);
  }
}

export function useOneSignalSync() {
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
            const userId = session.user.id;

            // 1. Set External ID
            await setExternalId(OneSignal, userId);

            // 2. Tag as authed
            try {
              await OneSignal.User?.addTag?.("role", "authed");
            } catch {}

            // 3. Read player ID (with retry — may not be ready immediately)
            let playerId: string | null = null;
            for (let attempt = 0; attempt < 5; attempt++) {
              playerId = await getPlayerId(OneSignal);
              if (playerId) break;
              await new Promise((r) => setTimeout(r, 1500));
            }

            // 4. Persist to Supabase profiles
            if (playerId) {
              await persistPlayerId(userId, playerId);
            } else {
              console.log("⚠️ Could not retrieve OneSignal player ID after retries");
            }
          } else {
            try {
              if (typeof OneSignal.logout === "function") {
                await OneSignal.logout();
              }
            } catch {}
            console.log("✅ OneSignal logout");
          }
        } catch (e) {
          console.log("OneSignal sync error:", e);
        }
      });

      unsubscribe = data?.subscription?.unsubscribe;
    })();

    return () => unsubscribe?.();
  }, []);
}
