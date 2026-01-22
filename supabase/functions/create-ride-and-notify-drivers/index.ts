import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildPushPayload } from "https://esm.sh/@block65/webcrypto-web-push@1.0.2";
import type { PushMessage, PushSubscription, VapidKeys } from "https://esm.sh/@block65/webcrypto-web-push@1.0.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type CreateRidePayload = {
  pickup: { address: string; lat: number; lng: number };
  dropoff: { address: string; lat: number; lng: number };
  distanceKm: number;
  durationMinutes: number;
  estimatedFare: number;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY")!;
    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY")!;

    // Validate JWT (caller must be logged in)
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const payload = (await req.json()) as CreateRidePayload;
    if (!payload?.pickup || !payload?.dropoff || !payload?.estimatedFare) {
      return new Response(JSON.stringify({ error: "Missing ride details" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Enforce rider role
    const { data: isRider } = await userClient.rpc("is_rider", { _user_id: userId });
    if (!isRider) {
      return new Response(JSON.stringify({ error: "Only riders can create rides" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create ride in "pending_payment" status — drivers can't see it yet
    const { data: ride, error: rideErr } = await userClient
      .from("rides")
      .insert({
        rider_id: userId,
        pickup_address: payload.pickup.address,
        pickup_lat: payload.pickup.lat,
        pickup_lng: payload.pickup.lng,
        dropoff_address: payload.dropoff.address,
        dropoff_lat: payload.dropoff.lat,
        dropoff_lng: payload.dropoff.lng,
        distance_km: payload.distanceKm,
        estimated_duration_minutes: Math.round(payload.durationMinutes),
        estimated_fare: payload.estimatedFare,
        status: "pending_payment", // <-- new pre-payment status
      })
      .select()
      .single();

    if (rideErr || !ride) {
      return new Response(JSON.stringify({ error: rideErr?.message || "Ride create failed" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create in-app notification for rider
    await userClient.from("notifications").insert({
      user_id: userId,
      ride_id: ride.id,
      type: "ride_booked",
      title: "Payment required 💳",
      message: "Complete payment to find a driver.",
    });

    // Notify drivers (service role)
    const service = createClient(supabaseUrl, supabaseServiceKey);
    const { data: onlineDrivers } = await service
      .from("driver_profiles")
      .select("user_id")
      .eq("is_online", true);

    const driverUserIds = (onlineDrivers || []).map((d) => d.user_id);

    if (driverUserIds.length > 0) {
      const { data: subscriptions } = await service
        .from("push_subscriptions")
        .select("id, user_id, endpoint, p256dh, auth")
        .in("user_id", driverUserIds);

      if (subscriptions && subscriptions.length > 0) {
        const vapid: VapidKeys = {
          subject: "mailto:support@drivvme.app",
          publicKey: vapidPublicKey,
          privateKey: vapidPrivateKey,
        };

        const fareDisplay = payload.estimatedFare ? `$${Number(payload.estimatedFare).toFixed(2)}` : "";
        const pushBody = JSON.stringify({
          title: "🚗 New Ride Request!",
          body: `${payload.pickup.address} → ${payload.dropoff.address}${fareDisplay ? ` • ${fareDisplay}` : ""}`,
          icon: "/favicon.ico",
          badge: "/favicon.ico",
          data: { url: "/driver", rideId: ride.id },
        });

        for (const sub of subscriptions) {
          try {
            const subscription: PushSubscription = {
              endpoint: sub.endpoint,
              expirationTime: null,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            };

            const message: PushMessage = {
              data: pushBody,
              options: { ttl: 300, urgency: "high" },
            };

            const pushPayload = await buildPushPayload(message, subscription, vapid);
            const resp = await fetch(subscription.endpoint, {
              ...pushPayload,
              body: pushPayload.body as BodyInit,
            });

            // Consume body to avoid leaks
            await resp.text();

            if (!resp.ok && (resp.status === 404 || resp.status === 410)) {
              await service.from("push_subscriptions").delete().eq("id", sub.id);
            }
          } catch (e) {
            console.error("Driver push failed:", e);
          }
        }
      }
    }

    return new Response(JSON.stringify({ ride }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in create-ride-and-notify-drivers:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
