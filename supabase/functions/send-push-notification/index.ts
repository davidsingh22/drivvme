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

    const { userId, title, body, data, url } = await req.json();

    console.log("Sending push notification to user:", userId);
    console.log("Title:", title, "Body:", body);

    if (!userId || !title) {
      return new Response(JSON.stringify({ error: "userId and title are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: subscriptions, error: subError } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", userId);

    if (subError) {
      console.error("Error fetching subscriptions:", subError);
      return new Response(JSON.stringify({ error: "Failed to fetch subscriptions" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Found subscriptions:", subscriptions?.length || 0);

    if (!subscriptions || subscriptions.length === 0) {
      return new Response(JSON.stringify({ message: "No subscriptions found for user", sent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // VAPID configuration
    const vapid: VapidKeys = {
      subject: "mailto:support@drivvme.app",
      publicKey: vapidPublicKey,
      privateKey: vapidPrivateKey,
    };

    const payload = JSON.stringify({
      title,
      body: body || "",
      icon: "/favicon.ico",
      badge: "/favicon.ico",
      data: { url: url || "/", ...(data || {}) },
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
            ttl: 86400, // 24 hours
          },
        };

        const pushPayload = await buildPushPayload(message, subscription, vapid);

        const response = await fetch(subscription.endpoint, {
          ...pushPayload,
          body: pushPayload.body as BodyInit,
        });

        console.log("Push sent, status:", response.status);

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

    return new Response(JSON.stringify({ sent, total: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in send-push-notification:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
