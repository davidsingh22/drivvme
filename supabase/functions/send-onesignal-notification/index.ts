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
    const { externalUserIds, playerIds, tagUids, title, message, url, data: extraData } = await req.json();

    if ((!externalUserIds?.length && !playerIds?.length && !tagUids?.length) || !title || !message) {
      return new Response(JSON.stringify({ error: "Missing required fields: (externalUserIds, playerIds, or tagUids), title, message" }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const restApiKey = Deno.env.get("ONESIGNAL_REST_API_KEY");
    if (!restApiKey) {
      throw new Error("ONESIGNAL_REST_API_KEY not configured");
    }

    // Generate unique nonce to prevent iOS/OneSignal deduplication
    const nonce = crypto.randomUUID();

    console.log("[send-onesignal] target playerIds:", playerIds || "none", "| externalUserIds:", externalUserIds || "none", "| tagUids:", tagUids || "none", "| nonce:", nonce);

    const payload: Record<string, unknown> = {
      app_id: "5a6c4131-8faa-4969-b5c4-5a09033c8e2a",
      headings: { en: title },
      contents: { en: message },
      url: url || undefined,
      priority: 10,
      ttl: 0,
      content_available: true,
      ios_sound: "default",
      android_sound: "default",
      mutable_content: true,
      // Force-unique collapse_id prevents OS-level deduplication
      collapse_id: `ride_${nonce}`,
      // Inject nonce into data so each notification is treated as unique
      data: { ...(extraData || {}), _nonce: nonce, _ts: Date.now().toString() },
    };

    // Prefer player IDs > tag filters > external user IDs
    if (playerIds?.length) {
      payload.include_player_ids = playerIds;
    } else if (tagUids?.length === 1) {
      payload.filters = [
        { field: "tag", key: "uid", relation: "=", value: tagUids[0] },
      ];
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

    const responseData = await res.json();
    console.log("[send-onesignal] onesignal response status:", res.status, JSON.stringify(responseData));

    if (!res.ok) {
      return new Response(JSON.stringify({ error: `OneSignal error: ${res.status}`, details: responseData }), {
        status: res.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(responseData), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
