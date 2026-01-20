/// <reference lib="deno.unstable" />

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "https://esm.sh/web-push@3.6.7?target=deno";

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

    // Configure VAPID (required for real Web Push)
    // Subject can be a mailto: or https URL.
    webpush.setVapidDetails("mailto:support@drivvme.app", vapidPublicKey, vapidPrivateKey);

    const payload = JSON.stringify({
      title,
      body: body || "",
      icon: "/favicon.ico",
      badge: "/favicon.ico",
      data: { url: url || "/", ...(data || {}) },
    });

    const results: Array<{ id: string; success: boolean; reason?: string; status?: number }> = [];

    for (const sub of subscriptions) {
      const subscription = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth,
        },
      };

      try {
        const res = await webpush.sendNotification(subscription as any, payload, {
          TTL: 60 * 60 * 24,
        });

        results.push({ id: sub.id, success: true, status: (res as any)?.statusCode });
      } catch (e: any) {
        const statusCode = e?.statusCode;
        const bodyText = e?.body ? String(e.body) : String(e);
        console.error("Push send failed:", statusCode, bodyText);

        // Subscription expired/invalid: clean it up.
        if (statusCode === 404 || statusCode === 410) {
          await supabase.from("push_subscriptions").delete().eq("id", sub.id);
          results.push({ id: sub.id, success: false, reason: "expired", status: statusCode });
        } else {
          results.push({ id: sub.id, success: false, reason: bodyText, status: statusCode });
        }
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
