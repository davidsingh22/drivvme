import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { externalUserIds, playerIds, title, message, url } = await req.json();

    if ((!externalUserIds?.length && !playerIds?.length) || !title || !message) {
      return new Response(JSON.stringify({ error: "Missing required fields: (externalUserIds or playerIds), title, message" }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const restApiKey = Deno.env.get("ONESIGNAL_REST_API_KEY");
    if (!restApiKey) {
      throw new Error("ONESIGNAL_REST_API_KEY not configured");
    }

    console.log("[send-onesignal] target playerIds:", playerIds || "none", "| externalUserIds:", externalUserIds || "none");

    const payload: Record<string, unknown> = {
      app_id: "5a6c4131-8faa-4969-b5c4-5a09033c8e2a",
      headings: { en: title },
      contents: { en: message },
      url: url || undefined,
      priority: 10,
      content_available: true,
      ios_sound: "default",
    };

    // Prefer player IDs (most reliable for native iOS)
    if (playerIds?.length) {
      payload.include_player_ids = playerIds;
    } else if (externalUserIds?.length) {
      payload.include_external_user_ids = externalUserIds;
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
    console.log("[send-onesignal] onesignal response status:", res.status, JSON.stringify(data));

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
