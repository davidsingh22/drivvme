import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface SaveCardRequest {
  action: "save" | "delete" | "set_default" | "list" | "pay_with_saved";
  paymentMethodId?: string;
  nickname?: string;
  cardId?: string;
  rideId?: string;
  amount?: number;
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

    const { action, paymentMethodId, nickname, cardId, rideId, amount }: SaveCardRequest = await req.json();

    // Get or create Stripe customer for this user
    const getOrCreateCustomer = async () => {
      // Check if user already has a Stripe customer ID in their profile
      const { data: profile } = await supabase
        .from("profiles")
        .select("stripe_customer_id")
        .eq("user_id", user.id)
        .single();

      if (profile?.stripe_customer_id) {
        return profile.stripe_customer_id;
      }

      // Create a new Stripe customer
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          supabase_user_id: user.id,
        },
      });

      // Note: We'd need to add stripe_customer_id column to profiles table
      // For now, we'll store it in saved_cards logic
      return customer.id;
    };

    if (action === "list") {
      // Get all saved cards for this user
      const { data: cards, error } = await supabase
        .from("saved_cards")
        .select("*")
        .eq("user_id", user.id)
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: false });

      if (error) throw error;

      return new Response(
        JSON.stringify({ cards: cards || [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "save") {
      if (!paymentMethodId || !nickname) {
        throw new Error("Missing paymentMethodId or nickname");
      }

      // Get or create customer
      const customerId = await getOrCreateCustomer();

      // Attach payment method to customer
      await stripe.paymentMethods.attach(paymentMethodId, {
        customer: customerId,
      });

      // Get payment method details
      const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
      
      if (!paymentMethod.card) {
        throw new Error("Invalid payment method - not a card");
      }

      // Check if this is the first card (make it default)
      const { count } = await supabase
        .from("saved_cards")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id);

      const isFirst = (count || 0) === 0;

      // Save to database
      const { data: savedCard, error } = await supabase
        .from("saved_cards")
        .insert({
          user_id: user.id,
          stripe_payment_method_id: paymentMethodId,
          nickname: nickname,
          card_brand: paymentMethod.card.brand || "unknown",
          card_last_four: paymentMethod.card.last4 || "****",
          card_exp_month: paymentMethod.card.exp_month,
          card_exp_year: paymentMethod.card.exp_year,
          is_default: isFirst,
        })
        .select()
        .single();

      if (error) throw error;

      return new Response(
        JSON.stringify({ card: savedCard }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "delete") {
      if (!cardId) {
        throw new Error("Missing cardId");
      }

      // Get the card to find the Stripe payment method ID
      const { data: card, error: fetchError } = await supabase
        .from("saved_cards")
        .select("*")
        .eq("id", cardId)
        .eq("user_id", user.id)
        .single();

      if (fetchError || !card) {
        throw new Error("Card not found");
      }

      // Detach from Stripe
      try {
        await stripe.paymentMethods.detach(card.stripe_payment_method_id);
      } catch (e) {
        // Payment method might already be detached, continue anyway
        console.log("Could not detach payment method:", e);
      }

      // Delete from database
      const { error } = await supabase
        .from("saved_cards")
        .delete()
        .eq("id", cardId)
        .eq("user_id", user.id);

      if (error) throw error;

      // If this was the default card, set another as default
      if (card.is_default) {
        const { data: remainingCards } = await supabase
          .from("saved_cards")
          .select("id")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(1);

        if (remainingCards && remainingCards.length > 0) {
          await supabase
            .from("saved_cards")
            .update({ is_default: true })
            .eq("id", remainingCards[0].id);
        }
      }

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "set_default") {
      if (!cardId) {
        throw new Error("Missing cardId");
      }

      // Remove default from all cards
      await supabase
        .from("saved_cards")
        .update({ is_default: false })
        .eq("user_id", user.id);

      // Set new default
      const { error } = await supabase
        .from("saved_cards")
        .update({ is_default: true })
        .eq("id", cardId)
        .eq("user_id", user.id);

      if (error) throw error;

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "pay_with_saved") {
      if (!cardId || !rideId || !amount) {
        throw new Error("Missing cardId, rideId, or amount");
      }

      // Get the saved card
      const { data: card, error: cardError } = await supabase
        .from("saved_cards")
        .select("*")
        .eq("id", cardId)
        .eq("user_id", user.id)
        .single();

      if (cardError || !card) {
        throw new Error("Card not found");
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

      // Get customer ID from payment method
      const paymentMethod = await stripe.paymentMethods.retrieve(card.stripe_payment_method_id);
      
      if (!paymentMethod.customer) {
        throw new Error("Payment method not attached to customer");
      }

      // Create and confirm payment intent
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100),
        currency: "cad",
        customer: paymentMethod.customer as string,
        payment_method: card.stripe_payment_method_id,
        off_session: true,
        confirm: true,
        metadata: {
          ride_id: rideId,
          user_id: user.id,
        },
      });

      // Create payment record in database
      await supabase.from("payments").insert({
        ride_id: rideId,
        payer_id: user.id,
        amount: amount,
        currency: "CAD",
        payment_type: "ride_payment",
        status: paymentIntent.status === "succeeded" ? "succeeded" : "pending",
        stripe_payment_intent_id: paymentIntent.id,
      });

      // If payment succeeded, update ride status
      if (paymentIntent.status === "succeeded") {
        await supabase
          .from("rides")
          .update({ status: "searching" })
          .eq("id", rideId);
      }

      return new Response(
        JSON.stringify({ 
          success: paymentIntent.status === "succeeded",
          status: paymentIntent.status,
          paymentIntentId: paymentIntent.id,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    throw new Error("Invalid action");
  } catch (error: any) {
    console.error("Error in manage-saved-cards:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );
  }
});
