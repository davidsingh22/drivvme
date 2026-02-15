import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. Require auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      console.error("[bind-onesignal-player-id] Missing Authorization header");
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      console.error("[bind-onesignal-player-id] Auth failed:", userError?.message);
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = user.id;
    console.log(`[bind-onesignal-player-id] target user id: ${userId}`);

    // 2. Read player ID from body
    const { playerId } = await req.json();
    if (!playerId || typeof playerId !== "string") {
      console.error("[bind-onesignal-player-id] Missing or invalid playerId");
      return new Response(JSON.stringify({ error: "Missing playerId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[bind-onesignal-player-id] onesignal_player_id received: ${playerId}`);

    // 3. Update profiles — RLS ensures user can only update their own row
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ onesignal_player_id: playerId })
      .eq("user_id", userId);

    if (updateError) {
      console.error(
        `[bind-onesignal-player-id] ❌ Failed to update profile for ${userId}:`,
        updateError.message
      );
      return new Response(JSON.stringify({ error: "Failed to bind player ID" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(
      `[bind-onesignal-player-id] ✅ Saved onesignal_player_id to Supabase for user ${userId}`
    );

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[bind-onesignal-player-id] Unexpected error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
