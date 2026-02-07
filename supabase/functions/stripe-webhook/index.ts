import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
    
    if (!stripeKey) {
      throw new Error("Stripe secret key not configured");
    }

    const stripe = new Stripe(stripeKey, {
      apiVersion: "2023-10-16",
    });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.text();
    const signature = req.headers.get("stripe-signature");

    let event: Stripe.Event;

    // Validate webhook signature if secret is configured
    if (webhookSecret) {
      if (!signature) {
        console.error("Missing stripe-signature header");
        return new Response(
          JSON.stringify({ error: "Missing stripe-signature header" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      try {
        event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
        console.log(`Verified Stripe webhook signature for event: ${event.type}`);
      } catch (err) {
        console.error("Webhook signature verification failed:", err);
        return new Response(
          JSON.stringify({ error: "Invalid webhook signature" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else {
      // Fallback for legacy webhooks without secret configured
      // Log warning but still process (will be removed once all envs have secret)
      console.warn("STRIPE_WEBHOOK_SECRET not configured - processing without signature verification");
      event = JSON.parse(body) as Stripe.Event;
    }

    console.log(`Processing Stripe event: ${event.type}`);

    switch (event.type) {
      case "payment_intent.succeeded": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;

        // 1. Mark payment as succeeded
        const { data: updatedPayments, error: paymentErr } = await supabase
          .from("payments")
          .update({ status: "succeeded" })
          .eq("stripe_payment_intent_id", paymentIntent.id)
          .select("ride_id");

        if (paymentErr) {
          console.error("Failed to update payment status:", paymentErr);
        }

        // 2. Transition ride from pending_payment → searching so drivers can see it
        const rideId = updatedPayments?.[0]?.ride_id;
        if (rideId) {
          // Get ride details for notification
          const { data: ride, error: rideErr } = await supabase
            .from("rides")
            .update({ status: "searching" })
            .eq("id", rideId)
            .eq("status", "pending_payment")
            .select("id, pickup_address, dropoff_address, estimated_fare, pickup_lat, pickup_lng")
            .single();

          if (rideErr) {
            console.error("Failed to update ride status to searching:", rideErr);
          } else {
            console.log(`Ride ${rideId} is now searching — dispatching via tiered notifications`);
            
            // Kick off tiered dispatch — starts with tier 1 (3km, 2 drivers)
            // The client-side escalation hook will handle subsequent tiers
            try {
              const dispatchResponse = await fetch(
                `${supabaseUrl}/functions/v1/notify-drivers-tiered`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${supabaseServiceKey}`,
                  },
                  body: JSON.stringify({
                    rideId: ride.id,
                    pickupAddress: ride.pickup_address,
                    dropoffAddress: ride.dropoff_address,
                    estimatedFare: Number(ride.estimated_fare),
                    pickupLat: ride.pickup_lat,
                    pickupLng: ride.pickup_lng,
                    tier: 1,
                    excludeDriverIds: [],
                  }),
                }
              );
              const dispatchResult = await dispatchResponse.json();
              console.log(`Tier 1 dispatch result:`, dispatchResult);
            } catch (notifyErr) {
              console.error("Error dispatching to drivers:", notifyErr);
            }
          }
        }

        console.log(`Payment succeeded for intent: ${paymentIntent.id}`);
        break;
      }

      case "payment_intent.payment_failed": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        
        await supabase
          .from("payments")
          .update({ status: "failed" })
          .eq("stripe_payment_intent_id", paymentIntent.id);

        console.log(`Payment failed for intent: ${paymentIntent.id}`);
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error: any) {
    console.error("Webhook error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      }
    );
  }
});
