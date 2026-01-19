import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface PaymentIntentRequest {
  rideId: string;
  amount: number;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      throw new Error("Stripe secret key not configured");
    }

    const stripe = new Stripe(stripeKey, {
      apiVersion: "2023-10-16",
    });

    // Get Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    // Verify the user
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      throw new Error("Unauthorized");
    }

    const { rideId, amount }: PaymentIntentRequest = await req.json();

    if (!rideId || !amount) {
      throw new Error("Missing rideId or amount");
    }

    // Verify the ride belongs to this user
    const { data: ride, error: rideError } = await supabase
      .from("rides")
      .select("*")
      .eq("id", rideId)
      .eq("rider_id", user.id)
      .single();

    if (rideError || !ride) {
      throw new Error("Ride not found or unauthorized");
    }

    // Check if a payment intent already exists for this ride
    const { data: existingPayment } = await supabase
      .from("payments")
      .select("stripe_payment_intent_id")
      .eq("ride_id", rideId)
      .eq("status", "pending")
      .single();

    let paymentIntent;

    if (existingPayment?.stripe_payment_intent_id) {
      // Retrieve existing payment intent
      paymentIntent = await stripe.paymentIntents.retrieve(
        existingPayment.stripe_payment_intent_id
      );
    } else {
      // Create a new payment intent
      paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100), // Convert to cents
        currency: "cad",
        metadata: {
          ride_id: rideId,
          user_id: user.id,
        },
        automatic_payment_methods: {
          enabled: true,
        },
      });

      // Create payment record in database
      await supabase.from("payments").insert({
        ride_id: rideId,
        payer_id: user.id,
        amount: amount,
        currency: "CAD",
        payment_type: "ride_payment",
        status: "pending",
        stripe_payment_intent_id: paymentIntent.id,
      });
    }

    return new Response(
      JSON.stringify({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error: any) {
    console.error("Error creating payment intent:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      }
    );
  }
});
