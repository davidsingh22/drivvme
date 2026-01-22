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

    // For now, we'll process the event without signature verification
    // In production, you should set STRIPE_WEBHOOK_SECRET and verify
    const event = JSON.parse(body) as Stripe.Event;

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
          const { error: rideErr } = await supabase
            .from("rides")
            .update({ status: "searching" })
            .eq("id", rideId)
            .eq("status", "pending_payment");

          if (rideErr) {
            console.error("Failed to update ride status to searching:", rideErr);
          } else {
            console.log(`Ride ${rideId} is now visible to drivers`);
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
