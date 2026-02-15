import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { driver_id, pickup, dropoff } = await req.json();

    if (!driver_id || !pickup || !dropoff) {
      return new Response(JSON.stringify({ error: "Missing required fields: driver_id, pickup, dropoff" }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const restApiKey = Deno.env.get("ONESIGNAL_REST_API_KEY");
    if (!restApiKey) throw new Error("ONESIGNAL_REST_API_KEY not configured");

    // Look up player ID from profiles
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    console.log("[notify-driver] target user id:", driver_id);

    const { data: profile } = await supabase
      .from("profiles")
      .select("onesignal_player_id")
      .eq("user_id", driver_id)
      .single();

    const playerId = profile?.onesignal_player_id;
    console.log("[notify-driver] onesignal_player_id", playerId ? `found: ${playerId}` : "missing");

    const payload: Record<string, unknown> = {
      app_id: "5a6c4131-8faa-4969-b5c4-5a09033c8e2a",
      headings: { en: "🚗 New Ride Request" },
      contents: { en: `Pickup: ${pickup} → Dropoff: ${dropoff}` },
      priority: 10,
      content_available: true,
      ios_sound: "default",
    };

    if (playerId) {
      payload.include_player_ids = [playerId];
    } else {
      payload.include_external_user_ids = [driver_id];
    }

    const res = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Authorization": `Basic ${restApiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    console.log("[notify-driver] onesignal response status:", res.status, JSON.stringify(data));

    if (!res.ok) {
      return new Response(JSON.stringify({ error: `OneSignal error: ${res.status}`, details: data }), {
        status: res.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
