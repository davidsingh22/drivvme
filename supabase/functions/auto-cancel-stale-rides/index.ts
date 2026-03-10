import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Find all rides stuck in 'searching' or 'pending_payment' for more than 3 minutes
    const threeMinAgo = new Date(Date.now() - 3 * 60 * 1000).toISOString();

    const { data: staleRides, error: fetchError } = await supabase
      .from("rides")
      .select("id, status, rider_id, created_at")
      .in("status", ["searching", "pending_payment"])
      .lt("created_at", threeMinAgo)
      .limit(50);

    if (fetchError) {
      console.error("Error fetching stale rides:", fetchError);
      return new Response(JSON.stringify({ error: fetchError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!staleRides || staleRides.length === 0) {
      return new Response(JSON.stringify({ cancelled: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ids = staleRides.map((r) => r.id);
    console.log(`[auto-cancel] Cancelling ${ids.length} stale rides:`, ids);

    const { error: updateError } = await supabase
      .from("rides")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancel_reason: "Auto-cancelled: no driver found within 3 minutes",
      })
      .in("id", ids);

    if (updateError) {
      console.error("Error cancelling stale rides:", updateError);
      return new Response(JSON.stringify({ error: updateError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[auto-cancel] ✅ Cancelled ${ids.length} stale rides`);

    return new Response(
      JSON.stringify({ cancelled: ids.length, ride_ids: ids }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("[auto-cancel] Unexpected error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
