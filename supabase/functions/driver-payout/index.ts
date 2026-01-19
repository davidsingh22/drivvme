import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface PayoutRequest {
  amount: number;
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

    // Check if user is a driver
    const { data: driverRole } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "driver")
      .single();

    if (!driverRole) {
      throw new Error("Only drivers can request payouts");
    }

    // Get driver profile
    const { data: driverProfile, error: profileError } = await supabase
      .from("driver_profiles")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (profileError || !driverProfile) {
      throw new Error("Driver profile not found");
    }

    const { amount }: PayoutRequest = await req.json();

    if (!amount || amount <= 0) {
      throw new Error("Invalid payout amount");
    }

    const availableBalance = Number(driverProfile.total_earnings) || 0;

    if (amount > availableBalance) {
      throw new Error(`Insufficient balance. Available: $${availableBalance.toFixed(2)}`);
    }

    // Check if driver has a Stripe Connect account
    let stripeAccountId = driverProfile.stripe_account_id;

    if (!stripeAccountId) {
      // Create a Stripe Connect Express account for the driver
      const { data: profile } = await supabase
        .from("profiles")
        .select("email, first_name, last_name")
        .eq("user_id", user.id)
        .single();

      const account = await stripe.accounts.create({
        type: "express",
        country: "CA",
        email: profile?.email || undefined,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_type: "individual",
        individual: {
          first_name: profile?.first_name || undefined,
          last_name: profile?.last_name || undefined,
          email: profile?.email || undefined,
        },
      });

      stripeAccountId = account.id;

      // Save the Stripe account ID to the driver profile
      await supabase
        .from("driver_profiles")
        .update({ stripe_account_id: stripeAccountId })
        .eq("user_id", user.id);
    }

    // Check if the account is fully onboarded
    const account = await stripe.accounts.retrieve(stripeAccountId);

    if (!account.details_submitted) {
      // Return an onboarding link
      const accountLink = await stripe.accountLinks.create({
        account: stripeAccountId,
        refresh_url: `${req.headers.get("origin")}/earnings`,
        return_url: `${req.headers.get("origin")}/earnings?onboarded=true`,
        type: "account_onboarding",
      });

      return new Response(
        JSON.stringify({
          success: false,
          needsOnboarding: true,
          onboardingUrl: accountLink.url,
          message: "Please complete your payment setup first",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    // Create a transfer to the driver's connected account
    const amountInCents = Math.round(amount * 100);

    const transfer = await stripe.transfers.create({
      amount: amountInCents,
      currency: "cad",
      destination: stripeAccountId,
      description: `Driver payout for ${user.id}`,
      metadata: {
        driver_id: user.id,
        payout_requested_at: new Date().toISOString(),
      },
    });

    // Deduct the amount from driver's total_earnings
    const newBalance = availableBalance - amount;
    await supabase
      .from("driver_profiles")
      .update({ total_earnings: newBalance })
      .eq("user_id", user.id);

    console.log(`Payout created: ${transfer.id} for driver: ${user.id}, amount: $${amount}`);

    return new Response(
      JSON.stringify({
        success: true,
        transferId: transfer.id,
        amount: amount,
        currency: "CAD",
        newBalance: newBalance,
        message: `Successfully transferred $${amount.toFixed(2)} to your account`,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error: any) {
    console.error("Error processing payout:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      }
    );
  }
});
