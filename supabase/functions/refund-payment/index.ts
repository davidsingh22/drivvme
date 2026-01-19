import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface RefundRequest {
  paymentId?: string;
  rideId?: string;
  reason?: string;
}

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

    const { paymentId, rideId, reason }: RefundRequest = await req.json();

    if (!paymentId && !rideId) {
      throw new Error("Missing paymentId or rideId");
    }

    // Find the payment
    let query = supabase
      .from("payments")
      .select("*, rides!inner(rider_id, driver_id, status)")
      .eq("status", "succeeded");

    if (paymentId) {
      query = query.eq("id", paymentId);
    } else if (rideId) {
      query = query.eq("ride_id", rideId);
    }

    const { data: payment, error: paymentError } = await query.single();

    if (paymentError || !payment) {
      throw new Error("Payment not found or already refunded");
    }

    // Verify the user is the rider or driver for this ride
    const ride = payment.rides as { rider_id: string; driver_id: string; status: string };
    if (ride.rider_id !== user.id && ride.driver_id !== user.id) {
      throw new Error("Unauthorized to refund this payment");
    }

    if (!payment.stripe_payment_intent_id) {
      throw new Error("No Stripe payment intent found");
    }

    // Create refund in Stripe
    const refund = await stripe.refunds.create({
      payment_intent: payment.stripe_payment_intent_id,
      reason: "requested_by_customer",
      metadata: {
        refund_reason: reason || "Customer requested refund",
        refunded_by: user.id,
        ride_id: payment.ride_id,
      },
    });

    // Update payment status to refunded
    await supabase
      .from("payments")
      .update({ status: "refunded" })
      .eq("id", payment.id);

    // If ride is cancelled, update the ride status
    if (ride.status !== "cancelled" && ride.status !== "completed") {
      await supabase
        .from("rides")
        .update({ 
          status: "cancelled",
          cancelled_at: new Date().toISOString(),
          cancelled_by: user.id,
          cancellation_reason: reason || "Payment refunded"
        })
        .eq("id", payment.ride_id);
    }

    console.log(`Refund created: ${refund.id} for payment: ${payment.id}`);

    return new Response(
      JSON.stringify({
        success: true,
        refundId: refund.id,
        amount: refund.amount / 100,
        currency: refund.currency.toUpperCase(),
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error: any) {
    console.error("Error processing refund:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      }
    );
  }
});
