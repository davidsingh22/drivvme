import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("Stripe secret key not configured");

    const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) throw new Error("Unauthorized");

    const { rideId, tipAmount, adminCharge } = await req.json();

    if (!rideId || !tipAmount || tipAmount <= 0) {
      throw new Error("Missing or invalid rideId/tipAmount");
    }

    // If admin is charging, verify admin role
    let riderId: string;
    if (adminCharge) {
      const { data: isAdmin } = await supabase.rpc("is_admin", { _user_id: user.id });
      if (!isAdmin) throw new Error("Only admins can charge tips");

      // Get ride info using service role (admin can see all rides)
      const { data: ride, error: rideError } = await supabase
        .from("rides")
        .select("id, rider_id, driver_id, status, tip_amount, tip_status")
        .eq("id", rideId)
        .single();

      if (rideError || !ride) throw new Error("Ride not found");
      if (ride.status !== "completed") throw new Error("Ride is not completed");
      if (ride.tip_status === "charged") throw new Error("Tip already charged");
      if (!ride.rider_id) throw new Error("No rider associated with this ride");

      riderId = ride.rider_id;
    } else {
      // Rider is submitting their own tip
      const { data: ride, error: rideError } = await supabase
        .from("rides")
        .select("id, rider_id, driver_id, status, tip_amount, tip_status")
        .eq("id", rideId)
        .eq("rider_id", user.id)
        .single();

      if (rideError || !ride) throw new Error("Ride not found or unauthorized");
      if (ride.status !== "completed") throw new Error("Ride is not completed");
      if (ride.tip_status === "charged") throw new Error("Tip already charged");

      riderId = user.id;
    }

    // Get the ride for driver_id
    const { data: rideData } = await supabase
      .from("rides")
      .select("driver_id")
      .eq("id", rideId)
      .single();

    // Get saved card for the rider
    let cardToCharge;

    // Try default card first
    const { data: defaultCard } = await supabase
      .from("saved_cards")
      .select("*")
      .eq("user_id", riderId)
      .eq("is_default", true)
      .single();
    cardToCharge = defaultCard;

    if (!cardToCharge) {
      // Fall back to any card
      const { data: anyCard } = await supabase
        .from("saved_cards")
        .select("*")
        .eq("user_id", riderId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      cardToCharge = anyCard;
    }

    if (!cardToCharge) {
      throw new Error("No saved card found for this rider.");
    }

    // Get the Stripe customer from the payment method
    const paymentMethod = await stripe.paymentMethods.retrieve(
      cardToCharge.stripe_payment_method_id
    );

    if (!paymentMethod.customer) {
      throw new Error("Payment method not attached to a Stripe customer");
    }

    // Create and confirm off-session payment for the tip
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(tipAmount * 100),
      currency: "cad",
      customer: paymentMethod.customer as string,
      payment_method: cardToCharge.stripe_payment_method_id,
      off_session: true,
      confirm: true,
      description: `Drivveme Tip - Ride ${rideId.substring(0, 8)}`,
      metadata: {
        ride_id: rideId,
        rider_id: riderId,
        type: "tip",
        driver_id: rideData?.driver_id || "",
        charged_by: adminCharge ? "admin" : "rider",
      },
    });

    if (paymentIntent.status === "succeeded") {
      // Update ride tip_status to charged
      await supabase
        .from("rides")
        .update({ tip_amount: tipAmount, tip_status: "charged" })
        .eq("id", rideId);

      // Record tip payment
      await supabase.from("payments").insert({
        ride_id: rideId,
        payer_id: riderId,
        amount: tipAmount,
        currency: "CAD",
        payment_type: "tip",
        status: "succeeded",
        stripe_payment_intent_id: paymentIntent.id,
      });

      // Add tip to driver earnings
      if (rideData?.driver_id) {
        const { data: driverProfile } = await supabase
          .from("driver_profiles")
          .select("total_earnings")
          .eq("user_id", rideData.driver_id)
          .single();

        if (driverProfile) {
          await supabase
            .from("driver_profiles")
            .update({
              total_earnings: (driverProfile.total_earnings || 0) + tipAmount,
            })
            .eq("user_id", rideData.driver_id);
        }
      }

      return new Response(
        JSON.stringify({ success: true, paymentIntentId: paymentIntent.id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else {
      throw new Error(`Payment not successful: ${paymentIntent.status}`);
    }
  } catch (error: any) {
    console.error("Error charging tip:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );
  }
});
