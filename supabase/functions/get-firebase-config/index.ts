import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("FIREBASE_API_KEY");
    const projectId = Deno.env.get("FIREBASE_PROJECT_ID");
    const messagingSenderId = Deno.env.get("FIREBASE_MESSAGING_SENDER_ID");
    const appId = Deno.env.get("FIREBASE_APP_ID");
    const vapidKey = Deno.env.get("FIREBASE_VAPID_KEY");

    if (!apiKey || !projectId || !messagingSenderId || !appId) {
      return new Response(JSON.stringify({ error: "Firebase configuration not complete" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const config = {
      apiKey,
      authDomain: `${projectId}.firebaseapp.com`,
      projectId,
      storageBucket: `${projectId}.appspot.com`,
      messagingSenderId,
      appId,
    };

    return new Response(JSON.stringify({ config, vapidKey }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
