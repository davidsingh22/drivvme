import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildPushPayload } from "https://esm.sh/@block65/webcrypto-web-push@1.0.2";
import type { PushMessage, PushSubscription, VapidKeys } from "https://esm.sh/@block65/webcrypto-web-push@1.0.2";

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
    const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY")!;
    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY")!;
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
          // Get ride details for notification
          const { data: ride, error: rideErr } = await supabase
            .from("rides")
            .update({ status: "searching" })
            .eq("id", rideId)
            .eq("status", "pending_payment")
            .select("id, pickup_address, dropoff_address, estimated_fare")
            .single();

          if (rideErr) {
            console.error("Failed to update ride status to searching:", rideErr);
          } else {
            console.log(`Ride ${rideId} is now visible to drivers`);
            
            // NOW notify drivers - only after payment succeeded
            try {
              const { data: onlineDrivers } = await supabase
                .from("driver_profiles")
                .select("user_id")
                .eq("is_online", true);

              const driverUserIds = (onlineDrivers || []).map((d) => d.user_id);

              if (driverUserIds.length > 0) {
                const { data: subscriptions } = await supabase
                  .from("push_subscriptions")
                  .select("id, user_id, endpoint, p256dh, auth")
                  .in("user_id", driverUserIds);

                if (subscriptions && subscriptions.length > 0) {
                  const vapid: VapidKeys = {
                    subject: "mailto:support@drivvme.app",
                    publicKey: vapidPublicKey,
                    privateKey: vapidPrivateKey,
                  };

                  const fareDisplay = ride.estimated_fare ? `$${Number(ride.estimated_fare).toFixed(2)}` : "";
                  const pushBody = JSON.stringify({
                    title: "🚗 New Ride Request!",
                    body: `${ride.pickup_address} → ${ride.dropoff_address}${fareDisplay ? ` • ${fareDisplay}` : ""}`,
                    icon: "/favicon.ico",
                    badge: "/favicon.ico",
                    data: { url: "/driver", rideId: ride.id },
                  });

                  for (const sub of subscriptions) {
                    try {
                      const subscription: PushSubscription = {
                        endpoint: sub.endpoint,
                        expirationTime: null,
                        keys: { p256dh: sub.p256dh, auth: sub.auth },
                      };

                      const message: PushMessage = {
                        data: pushBody,
                        options: { ttl: 300, urgency: "high" },
                      };

                      const pushPayload = await buildPushPayload(message, subscription, vapid);
                      const resp = await fetch(subscription.endpoint, {
                        ...pushPayload,
                        body: pushPayload.body as BodyInit,
                      });

                      await resp.text();

                      if (!resp.ok && (resp.status === 404 || resp.status === 410)) {
                        await supabase.from("push_subscriptions").delete().eq("id", sub.id);
                      }
                    } catch (e) {
                      console.error("Driver push failed:", e);
                    }
                  }
                  console.log(`Notified ${subscriptions.length} drivers of new ride`);
                }
              }
            } catch (notifyErr) {
              console.error("Error notifying drivers:", notifyErr);
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
