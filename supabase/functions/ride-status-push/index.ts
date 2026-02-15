import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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
      return {
        targetUserId: rider_id,
        title: "Ride Completed ✅",
        message: "You've arrived at your destination. Thanks for riding!",
      };
    case "cancelled":
      return {
        targetUserId: driver_id,
        title: "Ride Cancelled ❌",
        message: "The ride has been cancelled.",
      };
    default:
      return null;
  }
}

/**
 * Send a OneSignal push via External User ID (Supabase auth UID).
 * This works reliably for both foreground web and background native iOS.
 */
async function sendPush(
  targetUserId: string,
  title: string,
  message: string,
  data: Record<string, string>
) {
  const restApiKey = Deno.env.get("ONESIGNAL_REST_API_KEY");
  if (!restApiKey) throw new Error("ONESIGNAL_REST_API_KEY not configured");

  const osPayload = {
    app_id: ONESIGNAL_APP_ID,
    include_external_user_ids: [targetUserId],
    headings: { en: title },
    contents: { en: message },
    content_available: true,
    ios_sound: "default",
    data,
  };

  console.log("[ride-status-push] Sending via external_user_id:", targetUserId);

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

  return { ok: osRes.ok, status: osRes.status, data: osData };
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

    const pushData = {
      ride_id: payload.ride_id,
      status: payload.new_status,
    };

    const result = await sendPush(config.targetUserId, config.title, config.message, pushData);

    if (!result.ok) {
      return new Response(
        JSON.stringify({ error: "OneSignal error", details: result.data }),
        {
          status: result.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // For cancelled rides, also notify the rider
    if (payload.new_status === "cancelled" && payload.rider_id) {
      await sendPush(
        payload.rider_id,
        "Ride Cancelled ❌",
        "Your ride has been cancelled.",
        { ride_id: payload.ride_id, status: "cancelled" }
      );
    }

    return new Response(JSON.stringify({ success: true, onesignal: result.data }), {
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
