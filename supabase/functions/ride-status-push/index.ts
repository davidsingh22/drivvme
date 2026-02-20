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

async function getDriverFirstName(driverId: string): Promise<string> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data } = await supabase
    .from("profiles")
    .select("first_name")
    .eq("user_id", driverId)
    .single();

  return data?.first_name || "Your driver";
}

function getNotificationConfig(payload: RidePayload, driverName?: string) {
  const { new_status, rider_id, driver_id } = payload;
  const name = driverName || "Your driver";

  switch (new_status) {
    case "driver_assigned":
      return { targetUserId: rider_id, title: `${name} Is On The Way 🚗`, message: `${name} has accepted your ride and is heading to pick you up!` };
    case "driver_en_route":
      return { targetUserId: rider_id, title: `${name} Is On The Way 🚗`, message: `${name} is on the way to pick you up.` };
    case "arrived":
      return { targetUserId: rider_id, title: `${name} Has Arrived 📍`, message: `${name} has arrived! Please meet them at the pickup location.` };
    case "in_progress":
      return { targetUserId: rider_id, title: "Ride Started 🛣️", message: "Your ride has started. Enjoy the trip!" };
    case "completed":
      return { targetUserId: rider_id, title: "Ride Completed ✅", message: "You've arrived at your destination. Thanks for riding!" };
    case "cancelled":
      return { targetUserId: driver_id, title: "Ride Cancelled ❌", message: "The ride has been cancelled." };
    default:
      return null;
  }
}

/**
 * Look up the user's onesignal_player_id from profiles.
 * Returns null if not found.
 */
async function getPlayerIdFromProfiles(userId: string): Promise<string | null> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data } = await supabase
    .from("profiles")
    .select("onesignal_player_id")
    .eq("user_id", userId)
    .single();

  return data?.onesignal_player_id || null;
}

async function sendPush(
  targetUserId: string,
  title: string,
  message: string,
  data: Record<string, string>
) {
  const restApiKey = Deno.env.get("ONESIGNAL_REST_API_KEY");
  if (!restApiKey) throw new Error("ONESIGNAL_REST_API_KEY not configured");

  console.log("[ride-status-push] target external user id:", targetUserId);

  const osPayload: Record<string, unknown> = {
    app_id: ONESIGNAL_APP_ID,
    include_external_user_ids: [targetUserId],
    headings: { en: String(title) },
    contents: { en: String(message) },
    priority: 10,
    content_available: true,
    mutable_content: true,
    ios_sound: "default",
    data,
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
  console.log("[ride-status-push] onesignal response status:", osRes.status, JSON.stringify(osData));

  return { ok: osRes.ok, status: osRes.status, data: osData };
}

async function sendPushByPlayerId(
  playerId: string,
  title: string,
  message: string,
  data: Record<string, string>
) {
  const restApiKey = Deno.env.get("ONESIGNAL_REST_API_KEY");
  if (!restApiKey) throw new Error("ONESIGNAL_REST_API_KEY not configured");

  console.log("[ride-status-push] sending via player_id:", playerId);

  const osPayload: Record<string, unknown> = {
    app_id: ONESIGNAL_APP_ID,
    include_player_ids: [playerId],
    headings: { en: String(title) },
    contents: { en: String(message) },
    priority: 10,
    content_available: true,
    mutable_content: true,
    ios_sound: "default",
    data,
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
  console.log("[ride-status-push] player_id response:", osRes.status, JSON.stringify(osData));

  return { ok: osRes.ok, status: osRes.status, data: osData };
}

serve(async (req) => {
  console.log("Function ride-status-push was called!");
  console.log("[ride-status-push] method:", req.method, "url:", req.url);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const rawBody = await req.text();
    console.log("[ride-status-push] Raw body:", rawBody);
    const payload: RidePayload = JSON.parse(rawBody);
    console.log("[ride-status-push] Parsed payload:", JSON.stringify(payload));

    // Fetch driver name for personalized notifications
    let driverName: string | undefined;
    if (["driver_assigned", "driver_en_route", "arrived"].includes(payload.new_status) && payload.driver_id) {
      driverName = await getDriverFirstName(payload.driver_id);
      console.log("[ride-status-push] Driver name:", driverName);
    }

    const config = getNotificationConfig(payload, driverName);
    if (!config || !config.targetUserId) {
      console.log("[ride-status-push] No notification needed for status:", payload.new_status);
      return new Response(JSON.stringify({ skipped: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const pushData = { ride_id: payload.ride_id, status: payload.new_status, targetUrl: '/ride' };
    let result = await sendPush(config.targetUserId, config.title, config.message, pushData);

    // If external_user_id delivery had unsubscribed warnings, retry with player_id
    const hasUnsubWarning = result.data?.warnings?.invalid_external_user_ids;
    if (hasUnsubWarning) {
      console.log("[ride-status-push] External ID unsubscribed, trying player_id fallback for:", config.targetUserId);
      const playerId = await getPlayerIdFromProfiles(config.targetUserId);
      if (playerId) {
        console.log("[ride-status-push] Found player_id:", playerId, "- retrying with include_player_ids");
        result = await sendPushByPlayerId(playerId, config.title, config.message, pushData);
      } else {
        console.log("[ride-status-push] No player_id found in profiles for fallback");
      }
    }

    if (!result.ok) {
      return new Response(
        JSON.stringify({ error: "OneSignal error", details: result.data }),
        { status: result.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
