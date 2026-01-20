import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')!;
    const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')!;

    const { userId, title, body, data, url } = await req.json();

    console.log('Sending push notification to user:', userId);
    console.log('Title:', title, 'Body:', body);

    if (!userId || !title) {
      return new Response(
        JSON.stringify({ error: 'userId and title are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get user's push subscriptions
    const { data: subscriptions, error: subError } = await supabase
      .from('push_subscriptions')
      .select('*')
      .eq('user_id', userId);

    if (subError) {
      console.error('Error fetching subscriptions:', subError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch subscriptions' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Found subscriptions:', subscriptions?.length || 0);

    if (!subscriptions || subscriptions.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No subscriptions found for user', sent: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const payload = JSON.stringify({
      title,
      body: body || '',
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      data: { url: url || '/', ...data }
    });

    const results = [];

    for (const subscription of subscriptions) {
      try {
        console.log('Sending to endpoint:', subscription.endpoint.substring(0, 50) + '...');
        
        // For now, use a simple POST to the push endpoint
        // In production, you'd want to use proper VAPID signing
        // This is a simplified version that works with some push services
        
        const response = await fetch(subscription.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'TTL': '86400',
          },
          body: payload,
        });

        console.log('Push response status:', response.status);

        if (response.status === 201 || response.status === 200) {
          results.push({ endpoint: subscription.endpoint, success: true });
        } else if (response.status === 410 || response.status === 404) {
          // Subscription expired or invalid - remove it
          console.log('Subscription expired, removing...');
          await supabase
            .from('push_subscriptions')
            .delete()
            .eq('id', subscription.id);
          results.push({ endpoint: subscription.endpoint, success: false, reason: 'expired' });
        } else {
          const errorText = await response.text();
          console.error(`Push failed:`, response.status, errorText);
          results.push({ endpoint: subscription.endpoint, success: false, reason: `${response.status}: ${errorText}` });
        }
      } catch (e) {
        console.error('Error sending push:', e);
        results.push({ endpoint: subscription.endpoint, success: false, reason: String(e) });
      }
    }

    const successCount = results.filter(r => r.success).length;
    console.log('Push notifications sent:', successCount, 'of', results.length);

    return new Response(
      JSON.stringify({ results, sent: successCount, total: results.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in send-push-notification:', error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
