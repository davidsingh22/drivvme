import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Convert URL-safe base64 to Uint8Array
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Create JWT for VAPID
async function createVapidJwt(
  audience: string,
  subject: string,
  privateKeyBase64: string
): Promise<string> {
  const header = { alg: 'ES256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: audience,
    exp: now + 12 * 60 * 60, // 12 hours
    sub: subject,
  };

  const encoder = new TextEncoder();
  const headerB64 = btoa(JSON.stringify(header)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const payloadB64 = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unsignedToken = `${headerB64}.${payloadB64}`;

  // Import the private key
  const privateKeyBytes = urlBase64ToUint8Array(privateKeyBase64);
  
  // Create JWK from raw private key
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    d: privateKeyBase64,
    x: '', // Will be derived
    y: '', // Will be derived
  };

  // For ECDSA P-256, we need to derive x,y from the private key
  // We'll use a different approach - import as raw key
  const keyData = {
    kty: 'EC',
    crv: 'P-256',
    d: privateKeyBase64.replace(/-/g, '+').replace(/_/g, '/'),
    x: 'BBQ', // placeholder - will be computed
    y: 'BBQ', // placeholder
  };

  try {
    const privateKey = await crypto.subtle.importKey(
      'jwk',
      {
        kty: 'EC',
        crv: 'P-256',
        d: privateKeyBase64,
        // These are derived from the public key - we need to store them or compute
        x: Deno.env.get('VAPID_PUBLIC_KEY_X') || '',
        y: Deno.env.get('VAPID_PUBLIC_KEY_Y') || '',
      },
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign']
    );

    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      privateKey,
      encoder.encode(unsignedToken)
    );

    const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    return `${unsignedToken}.${signatureB64}`;
  } catch (e) {
    console.error('Error creating VAPID JWT:', e);
    throw e;
  }
}

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

    if (!subscriptions || subscriptions.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No subscriptions found for user' }),
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
        const endpoint = subscription.endpoint;
        const endpointUrl = new URL(endpoint);
        const audience = `${endpointUrl.protocol}//${endpointUrl.host}`;

        // Create the web push request
        // Using a simpler approach with fetch and the web-push spec
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Encoding': 'aes128gcm',
            'TTL': '86400',
            'Authorization': `vapid t=eyJ..., k=${vapidPublicKey}`,
          },
          body: payload,
        });

        if (response.status === 201 || response.status === 200) {
          results.push({ endpoint, success: true });
        } else if (response.status === 410 || response.status === 404) {
          // Subscription expired or invalid - remove it
          await supabase
            .from('push_subscriptions')
            .delete()
            .eq('id', subscription.id);
          results.push({ endpoint, success: false, reason: 'expired' });
        } else {
          const errorText = await response.text();
          console.error(`Push failed for ${endpoint}:`, response.status, errorText);
          results.push({ endpoint, success: false, reason: errorText });
        }
      } catch (e) {
        console.error('Error sending push:', e);
        results.push({ endpoint: subscription.endpoint, success: false, reason: String(e) });
      }
    }

    return new Response(
      JSON.stringify({ results }),
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
