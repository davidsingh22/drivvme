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

interface DriverInfo {
  first_name: string;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_color: string | null;
  license_plate: string | null;
}

function getSupabase() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

async function getDriverInfo(driverId: string): Promise<DriverInfo> {
  const supabase = getSupabase();

  const [profileRes, driverRes] = await Promise.all([
    supabase.from("profiles").select("first_name").eq("user_id", driverId).single(),
    supabase.from("driver_profiles").select("vehicle_make, vehicle_model, vehicle_color, license_plate, current_lat, current_lng").eq("user_id", driverId).single(),
  ]);

  return {
    first_name: profileRes.data?.first_name || "Your driver",
    vehicle_make: driverRes.data?.vehicle_make || null,
    vehicle_model: driverRes.data?.vehicle_model || null,
    vehicle_color: driverRes.data?.vehicle_color || null,
    license_plate: driverRes.data?.license_plate || null,
  };
}

function estimateEtaMinutes(lat1: number, lng1: number, lat2: number, lng2: number): number | null {
  if (!lat1 || !lng1 || !lat2 || !lng2) return null;
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  const km = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.max(1, Math.round((km / 25) * 60));
}

async function getDriverEta(driverId: string, pickupLat: number, pickupLng: number): Promise<number | null> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("driver_profiles")
    .select("current_lat, current_lng")
    .eq("user_id", driverId)
    .single();

  if (!data?.current_lat || !data?.current_lng) return null;
  return estimateEtaMinutes(data.current_lat, data.current_lng, pickupLat, pickupLng);
}

function buildVehicleString(info: DriverInfo): string {
  const parts: string[] = [];
  if (info.license_plate) parts.push(info.license_plate);
  const car = [info.vehicle_color, info.vehicle_make, info.vehicle_model].filter(Boolean).join(" ");
  if (car) parts.push(car);
  return parts.join(" · ");
}

function getNotificationConfig(payload: RidePayload, driverInfo?: DriverInfo, etaMinutes?: number | null) {
  const { new_status, rider_id, driver_id } = payload;
  const name = driverInfo?.first_name || "Your driver";
  const vehicleStr = driverInfo ? buildVehicleString(driverInfo) : "";

  switch (new_status) {
    case "driver_assigned": {
      const etaText = etaMinutes ? `Pick up in ${etaMinutes} min` : `${name} is on the way`;
      const body = vehicleStr ? `${vehicleStr}` : `${name} has accepted your ride!`;
      return { targetUserId: rider_id, title: `🚗 ${etaText}`, message: body };
    }
    case "driver_en_route": {
      const etaText = etaMinutes ? `Pick up in ${etaMinutes} min` : `${name} is on the way`;
      const body = vehicleStr ? `${vehicleStr}` : `${name} is heading to you.`;
      return { targetUserId: rider_id, title: `🚗 ${etaText}`, message: body };
    }
    case "arrived":
      return {
        targetUserId: rider_id,
        title: `${name} Has Arrived 📍`,
        message: vehicleStr
          ? `Look for ${vehicleStr}`
          : `${name} is at the pickup. Head outside!`,
      };
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

/** Multi-channel push: tries player_id first, then external_user_id, then tag-based */
async function sendPush(
  targetUserId: string,
  title: string,
  message: string,
  data: Record<string, string>,
) {
  const restApiKey = Deno.env.get("ONESIGNAL_REST_API_KEY");
  if (!restApiKey) throw new Error("ONESIGNAL_REST_API_KEY not configured");

  console.log("[ride-status-push] target:", targetUserId, "title:", title);

  // Look up stored player_id from profiles table
  const supabase = getSupabase();
  const { data: profile } = await supabase
    .from("profiles")
    .select("onesignal_player_id")
    .eq("user_id", targetUserId)
    .single();

  const playerId = profile?.onesignal_player_id;
  console.log("[ride-status-push] player_id from DB:", playerId || "none");

  const basePayload = {
    app_id: ONESIGNAL_APP_ID,
    headings: { en: String(title) },
    contents: { en: String(message) },
    priority: 10,
    content_available: true,
    mutable_content: true,
    ios_sound: "default",
    thread_id: `ride_${data.ride_id}`,
    collapse_id: `ride_status_${data.ride_id}`,
    android_group: `ride_${data.ride_id}`,
    data,
  };

  const sendToOneSignal = async (targeting: Record<string, unknown>, label: string) => {
    const payload = { ...basePayload, ...targeting };
    const res = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Basic ${restApiKey}`,
      },
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    console.log(`[ride-status-push] ${label} response:`, res.status, JSON.stringify(body));
    // Check if notification actually reached someone
    const recipients = body?.recipients || 0;
    return { ok: res.ok, status: res.status, data: body, delivered: recipients > 0 };
  };

  // Strategy 1: player_id (most reliable if stored)
  if (playerId) {
    const r1 = await sendToOneSignal({ include_player_ids: [playerId] }, "player_id");
    if (r1.delivered) return r1;
    console.log("[ride-status-push] player_id didn't deliver, trying fallbacks...");
  }

  // Strategy 2: tag-based (uid tag — works if device has tag set)
  const r2 = await sendToOneSignal({
    filters: [{ field: "tag", key: "uid", relation: "=", value: targetUserId }],
  }, "tag_uid");
  if (r2.delivered) return r2;

  // Strategy 3: external_user_id (last resort)
  const r3 = await sendToOneSignal({ include_external_user_ids: [targetUserId] }, "external_id");
  return r3;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const rawBody = await req.text();
    console.log("[ride-status-push] body:", rawBody);
    const payload: RidePayload = JSON.parse(rawBody);

    let driverInfo: DriverInfo | undefined;
    let etaMinutes: number | null = null;

    if (payload.driver_id && ["driver_assigned", "driver_en_route", "arrived"].includes(payload.new_status)) {
      const supabase = getSupabase();
      const [info, rideRes] = await Promise.all([
        getDriverInfo(payload.driver_id),
        supabase.from("rides").select("pickup_lat, pickup_lng").eq("id", payload.ride_id).single(),
      ]);
      driverInfo = info;
      if (rideRes.data && ["driver_assigned", "driver_en_route"].includes(payload.new_status)) {
        etaMinutes = await getDriverEta(payload.driver_id, rideRes.data.pickup_lat, rideRes.data.pickup_lng);
      }
    }

    const config = getNotificationConfig(payload, driverInfo, etaMinutes);
    if (!config || !config.targetUserId) {
      return new Response(JSON.stringify({ skipped: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const pushData: Record<string, string> = { ride_id: payload.ride_id, status: payload.new_status };
    if (etaMinutes) pushData.eta_minutes = String(etaMinutes);
    if (driverInfo?.license_plate) pushData.license_plate = driverInfo.license_plate;
    if (driverInfo?.vehicle_color) pushData.vehicle_color = driverInfo.vehicle_color;

    const result = await sendPush(config.targetUserId, config.title, config.message, pushData);

    // For cancelled rides, create in-app notification for the driver AND notify the rider
    if (payload.new_status === "cancelled") {
      // Insert a ride_cancelled notification for the driver so their realtime listener clears the ride instantly
      if (payload.driver_id) {
        const supabase = getSupabase();
        const { error: notifErr } = await supabase.from("notifications").insert({
          user_id: payload.driver_id,
          ride_id: payload.ride_id,
          type: "ride_cancelled",
          title: "Ride Cancelled ❌",
          message: "The rider has cancelled the ride.",
        });
        if (notifErr) {
          console.error("[ride-status-push] Failed to insert ride_cancelled notification for driver:", notifErr.message);
        } else {
          console.log("[ride-status-push] Inserted ride_cancelled notification for driver:", payload.driver_id);
        }
      }

      // Also push-notify the rider
      if (payload.rider_id) {
        await sendPush(
          payload.rider_id,
          "Ride Cancelled ❌",
          "Your ride has been cancelled.",
          { ride_id: payload.ride_id, status: "cancelled" },
        );
      }
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
