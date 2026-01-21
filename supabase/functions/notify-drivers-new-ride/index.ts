import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildPushPayload } from "https://esm.sh/@block65/webcrypto-web-push@1.0.2";
import type { PushSubscription, VapidKeys, PushMessage } from "https://esm.sh/@block65/webcrypto-web-push@1.0.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY")!;
    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY")!;

    const { rideId, pickupAddress, dropoffAddress, estimatedFare } = await req.json();

    console.log("Notifying drivers of new ride:", rideId);

    if (!rideId) {
      return new Response(JSON.stringify({ error: "rideId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get all online drivers
    const { data: onlineDrivers, error: driverError } = await supabase
      .from("driver_profiles")
      .select("user_id")
      .eq("is_online", true)
      .eq("is_verified", true);

    if (driverError) {
      console.error("Error fetching online drivers:", driverError);
      return new Response(JSON.stringify({ error: "Failed to fetch drivers" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Found online drivers:", onlineDrivers?.length || 0);

    if (!onlineDrivers || onlineDrivers.length === 0) {
      return new Response(JSON.stringify({ message: "No online drivers found", sent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const driverUserIds = onlineDrivers.map(d => d.user_id);

    // Get push subscriptions for all online drivers
    const { data: subscriptions, error: subError } = await supabase
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth")
      .in("user_id", driverUserIds);

    if (subError) {
      console.error("Error fetching subscriptions:", subError);
      return new Response(JSON.stringify({ error: "Failed to fetch subscriptions" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Found driver subscriptions:", subscriptions?.length || 0);

    if (!subscriptions || subscriptions.length === 0) {
      return new Response(JSON.stringify({ message: "No driver subscriptions found", sent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // VAPID configuration
    const vapid: VapidKeys = {
      subject: "mailto:support@drivvme.app",
      publicKey: vapidPublicKey,
      privateKey: vapidPrivateKey,
    };

    const fareDisplay = estimatedFare ? `$${Number(estimatedFare).toFixed(2)}` : "";
    const payload = JSON.stringify({
      title: "🚗 New Ride Request!",
      body: `${pickupAddress || "Pickup"} → ${dropoffAddress || "Dropoff"}${fareDisplay ? ` • ${fareDisplay}` : ""}`,
      icon: "/favicon.ico",
      badge: "/favicon.ico",
      data: { url: "/driver", rideId },
    });

    const results: Array<{ id: string; success: boolean; reason?: string; status?: number }> = [];

    for (const sub of subscriptions) {
      try {
        const subscription: PushSubscription = {
          endpoint: sub.endpoint,
          expirationTime: null,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth,
          },
        };

        const message: PushMessage = {
          data: payload,
          options: {
            ttl: 300, // 5 minutes - rides are time-sensitive
            urgency: "high",
          },
        };

        const pushPayload = await buildPushPayload(message, subscription, vapid);

        const response = await fetch(subscription.endpoint, {
          ...pushPayload,
          body: pushPayload.body as BodyInit,
        });

        console.log("Push sent to driver, status:", response.status);

        if (response.ok) {
          results.push({ id: sub.id, success: true, status: response.status });
        } else {
          const errorText = await response.text();
          console.error("Push failed:", response.status, errorText);

          // Subscription expired/invalid: clean it up
          if (response.status === 404 || response.status === 410) {
            await supabase.from("push_subscriptions").delete().eq("id", sub.id);
            results.push({ id: sub.id, success: false, reason: "expired", status: response.status });
          } else {
            results.push({ id: sub.id, success: false, reason: errorText, status: response.status });
          }
        }
      } catch (e: unknown) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        console.error("Push send failed:", errorMessage);
        results.push({ id: sub.id, success: false, reason: errorMessage });
      }
    }

    const sent = results.filter((r) => r.success).length;

    return new Response(JSON.stringify({ sent, total: results.length, driversNotified: driverUserIds.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in notify-drivers-new-ride:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
