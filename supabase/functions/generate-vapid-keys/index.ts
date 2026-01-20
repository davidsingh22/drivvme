import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Convert ArrayBuffer to URL-safe Base64
function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Generate ECDSA P-256 key pair (required for VAPID)
    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'ECDSA',
        namedCurve: 'P-256',
      },
      true, // extractable
      ['sign', 'verify']
    );

    // Export the public key in raw format
    const publicKeyRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey);
    const publicKey = arrayBufferToBase64Url(publicKeyRaw);

    // Export the private key in JWK format to get the 'd' parameter
    const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
    
    // The private key for VAPID is just the 'd' parameter from JWK
    // We need to convert it from standard base64 to URL-safe base64
    const privateKey = privateKeyJwk.d!
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    console.log('VAPID keys generated successfully');

    return new Response(
      JSON.stringify({
        publicKey,
        privateKey,
        instructions: 'Copy these keys and add them as secrets: VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error generating VAPID keys:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to generate VAPID keys' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
