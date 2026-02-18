import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const restApiKey = Deno.env.get("ONESIGNAL_REST_API_KEY");
    if (!restApiKey) throw new Error("ONESIGNAL_REST_API_KEY not configured");

    const payload = {
      app_id: "5a6c4131-8faa-4969-b5c4-5a09033c8e2a",
      headings: { en: "🧪 Test Push — Driver Alert" },
      contents: { en: "This is a test notification sent to all drivers. If you see this, push is working!" },
      filters: [
        { field: "tag", key: "role", relation: "=", value: "driver" },
      ],
      priority: 10,
      content_available: true,
      mutable_content: true,
      ios_sound: "default",
      data: { type: "test_push", timestamp: new Date().toISOString() },
    };

    console.log("[test-driver-push] Sending to all role:driver tags...");

    const res = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Authorization": `Basic ${restApiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    console.log("[test-driver-push] OneSignal response:", res.status, JSON.stringify(data));

    return new Response(JSON.stringify({ 
      success: res.ok, 
      recipients: data.recipients ?? 0,
      onesignal_id: data.id ?? null,
      errors: data.errors ?? null,
    }), {
      status: res.ok ? 200 : res.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error("[test-driver-push] Error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
