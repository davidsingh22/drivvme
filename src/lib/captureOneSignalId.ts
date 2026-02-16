import { supabase } from "@/integrations/supabase/client";

let lastSaved: string | null = null;

async function saveOneSignalIdToProfile(uid: string, oneSignalId: string) {
  const { error } = await supabase
    .from("profiles")
    .update({ onesignal_player_id: oneSignalId })
    .eq("user_id", uid);
  if (error) throw error;
}

/**
 * Captures the OneSignal Player/Subscription ID and saves it to the user's profile.
 * Tries Median native bridge first, then falls back to OneSignal Web SDK.
 */
export function initCaptureOneSignalId() {
  supabase.auth.onAuthStateChange(async (_event, session) => {
    const uid = session?.user?.id;
    if (!uid) return;

    try {
      // A) Try Median bridge first
      if ((window as any).median?.onesignal?.info) {
        const info = await (window as any).median.onesignal.info();
        const id = info?.oneSignalId || info?.subscriptionId || info?.id;
        if (id && lastSaved !== id) {
          await saveOneSignalIdToProfile(uid, id);
          lastSaved = id;
          console.log("✅ Saved OneSignal ID via Median:", id);
          return;
        }
      }

      // B) Try OneSignal Web SDK fallback
      (window as any).OneSignalDeferred = (window as any).OneSignalDeferred || [];
      (window as any).OneSignalDeferred.push(async (OneSignal: any) => {
        const id = OneSignal?.User?.PushSubscription?.id;
        if (id && lastSaved !== id) {
          await saveOneSignalIdToProfile(uid, id);
          lastSaved = id;
          console.log("✅ Saved OneSignal ID via Web SDK:", id);
        } else {
          console.log("❌ Could not read PushSubscription id");
        }
      });
    } catch (e) {
      console.log("❌ initCaptureOneSignalId error:", e);
    }
  });
}
