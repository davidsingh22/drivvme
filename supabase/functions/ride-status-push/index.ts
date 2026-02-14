import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ONESIGNAL_APP_ID = "5a6c4131-8faa-4969-b5c4-5a09033c8e2a";

interface RidePayload {
  ride_id: string;
  new_status: string;
  old_status: string;
  rider_id: string | null;
  driver_id: string | null;
}

/**
 * Determine who should receive the push and what the message should say.
 */
function getNotificationConfig(payload: RidePayload): {
  targetUserId: string | null;
  title: string;
  message: string;
} | null {
  const { new_status, rider_id, driver_id } = payload;

  switch (new_status) {
    case "driver_assigned":
      return {
        targetUserId: rider_id,
        title: "Driver Assigned 🚗",
        message: "A driver has been assigned to your ride!",
      };
    case "driver_en_route":
      return {
        targetUserId: rider_id,
        title: "Driver On The Way 🚗",
        message: "Your driver is on the way to pick you up.",
      };
    case "arrived":
      return {
        targetUserId: rider_id,
        title: "Driver Has Arrived 📍",
        message: "Your driver is here! Head to the pickup point.",
      };
    case "in_progress":
      return {
        targetUserId: rider_id,
        title: "Ride Started 🛣️",
        message: "Your ride has started. Enjoy the trip!",
      };
    case "completed":
      // Notify both rider and driver — we'll handle rider here;
      // driver gets earnings update separately
      return {
        targetUserId: rider_id,
        title: "Ride Completed ✅",
        message: "You've arrived at your destination. Thanks for riding!",
      };
    case "cancelled":
      // Notify the other party. If cancelled by rider → notify driver, vice versa.
      // We don't know who cancelled from just status, so notify both if present.
      // We'll notify the driver if rider cancelled (most common).
      return {
        targetUserId: driver_id,
        title: "Ride Cancelled ❌",
        message: "The ride has been cancelled.",
      };
    default:
      return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const payload: RidePayload = await req.json();
    console.log("[ride-status-push] Received payload:", JSON.stringify(payload));

    const config = getNotificationConfig(payload);
    if (!config || !config.targetUserId) {
      console.log("[ride-status-push] No notification needed for status:", payload.new_status);
      return new Response(JSON.stringify({ skipped: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Look up the target user's OneSignal player ID from profiles
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("onesignal_player_id, first_name")
      .eq("user_id", config.targetUserId)
      .maybeSingle();

    if (profileErr) {
      console.error("[ride-status-push] Profile lookup error:", profileErr);
      throw profileErr;
    }

    const playerId = profile?.onesignal_player_id;
    if (!playerId) {
      console.log("[ride-status-push] No OneSignal player ID for user:", config.targetUserId);
      // Fall back to external_user_id targeting
      return await sendViaExternalUserId(config, payload);
    }

    // Send via player ID (most reliable for native iOS)
    const restApiKey = Deno.env.get("ONESIGNAL_REST_API_KEY");
    if (!restApiKey) throw new Error("ONESIGNAL_REST_API_KEY not configured");

    const osPayload = {
      app_id: ONESIGNAL_APP_ID,
      include_player_ids: [playerId],
      headings: { en: config.title },
      contents: { en: config.message },
      // iOS-specific settings for background delivery
      content_available: true,
      ios_sound: "default",
      data: {
        ride_id: payload.ride_id,
        status: payload.new_status,
      },
    };

    console.log("[ride-status-push] Sending OneSignal push:", JSON.stringify(osPayload));

    const osRes = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Basic ${restApiKey}`,
      },
      body: JSON.stringify(osPayload),
    });

    const osData = await osRes.json();
    console.log("[ride-status-push] OneSignal response:", JSON.stringify(osData));

    if (!osRes.ok) {
      return new Response(
        JSON.stringify({ error: "OneSignal error", details: osData }),
        {
          status: osRes.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // For cancelled rides, also notify the rider if driver was notified
    if (payload.new_status === "cancelled" && payload.rider_id) {
      await sendCancellationToRider(supabase, payload);
    }

    return new Response(JSON.stringify({ success: true, onesignal: osData }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[ride-status-push] Error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function sendViaExternalUserId(
  config: { targetUserId: string; title: string; message: string },
  payload: RidePayload
) {
  const restApiKey = Deno.env.get("ONESIGNAL_REST_API_KEY");
  if (!restApiKey) throw new Error("ONESIGNAL_REST_API_KEY not configured");

  const osPayload = {
    app_id: ONESIGNAL_APP_ID,
    include_external_user_ids: [config.targetUserId],
    headings: { en: config.title },
    contents: { en: config.message },
    content_available: true,
    ios_sound: "default",
    data: {
      ride_id: payload.ride_id,
      status: payload.new_status,
    },
  };

  const osRes = await fetch("https://onesignal.com/api/v1/notifications", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Basic ${restApiKey}`,
    },
    body: JSON.stringify(osPayload),
  });

  const osData = await osRes.json();
  console.log("[ride-status-push] Fallback external_user_id response:", JSON.stringify(osData));

  return new Response(JSON.stringify({ success: true, fallback: true, onesignal: osData }), {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json",
    },
  });
}

async function sendCancellationToRider(supabase: any, payload: RidePayload) {
  try {
    const { data: riderProfile } = await supabase
      .from("profiles")
      .select("onesignal_player_id")
      .eq("user_id", payload.rider_id)
      .maybeSingle();

    const restApiKey = Deno.env.get("ONESIGNAL_REST_API_KEY")!;
    const target = riderProfile?.onesignal_player_id
      ? { include_player_ids: [riderProfile.onesignal_player_id] }
      : { include_external_user_ids: [payload.rider_id] };

    await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Basic ${restApiKey}`,
      },
      body: JSON.stringify({
        app_id: ONESIGNAL_APP_ID,
        ...target,
        headings: { en: "Ride Cancelled ❌" },
        contents: { en: "Your ride has been cancelled." },
        content_available: true,
        ios_sound: "default",
        data: { ride_id: payload.ride_id, status: "cancelled" },
      }),
    });
  } catch (e) {
    console.error("[ride-status-push] Error notifying rider of cancellation:", e);
  }
}
