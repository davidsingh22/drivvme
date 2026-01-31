import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface FCMMessageV1 {
  message: {
    token: string;
    notification: {
      title: string;
      body: string;
    };
    data: Record<string, string>;
    webpush?: {
      notification?: {
        icon?: string;
        badge?: string;
        vibrate?: number[];
        requireInteraction?: boolean;
        tag?: string;
      };
      fcm_options?: {
        link?: string;
      };
    };
  };
}

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Input validation helper
function validateInput(input: unknown): { 
  valid: boolean; 
  data?: { userId: string; title: string; body?: string; data?: Record<string, string>; url?: string }; 
  error?: string 
} {
  if (!input || typeof input !== 'object') {
    return { valid: false, error: 'Invalid JSON body' };
  }

  const { userId, title, body, data, url } = input as Record<string, unknown>;

  // Required fields
  if (typeof userId !== 'string' || !UUID_REGEX.test(userId)) {
    return { valid: false, error: 'userId must be a valid UUID' };
  }
  if (typeof title !== 'string' || title.length === 0 || title.length > 100) {
    return { valid: false, error: 'title must be a string between 1-100 characters' };
  }

  // Optional fields
  if (body !== undefined && (typeof body !== 'string' || body.length > 500)) {
    return { valid: false, error: 'body must be a string up to 500 characters' };
  }
  if (url !== undefined && (typeof url !== 'string' || url.length > 200)) {
    return { valid: false, error: 'url must be a string up to 200 characters' };
  }
  if (data !== undefined && (typeof data !== 'object' || data === null || Array.isArray(data))) {
    return { valid: false, error: 'data must be an object' };
  }

  // Validate data object values are strings
  if (data) {
    for (const [key, value] of Object.entries(data)) {
      if (typeof value !== 'string') {
        return { valid: false, error: `data.${key} must be a string` };
      }
    }
  }

  return {
    valid: true,
    data: {
      userId,
      title,
      body: typeof body === 'string' ? body : undefined,
      data: data as Record<string, string> | undefined,
      url: typeof url === 'string' ? url : undefined,
    },
  };
}

// Cache for access token to avoid repeated OAuth exchanges
let cachedAccessToken: string | null = null;
let tokenExpiresAt = 0;

// Get OAuth2 access token for FCM v1 API using service account (with caching)
async function getAccessToken(): Promise<string> {
  const now = Date.now();
  
  // Return cached token if still valid (with 5 min buffer)
  if (cachedAccessToken && tokenExpiresAt > now + 300000) {
    return cachedAccessToken;
  }

  const serviceAccountJson = Deno.env.get("FIREBASE_SERVICE_ACCOUNT");
  
  if (!serviceAccountJson) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT not configured");
  }

  const serviceAccount = JSON.parse(serviceAccountJson);

  // Create JWT for OAuth2
  const nowSec = Math.floor(now / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: nowSec,
    exp: nowSec + 3600,
  };

  // Encode header and payload
  const encoder = new TextEncoder();
  const headerB64 = btoa(JSON.stringify(header)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const payloadB64 = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const signInput = `${headerB64}.${payloadB64}`;

  // Import private key and sign
  const privateKeyPem = serviceAccount.private_key;
  const pemContents = privateKeyPem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
  
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    encoder.encode(signInput)
  );
  
  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const jwt = `${signInput}.${signatureB64}`;

  // Exchange JWT for access token
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  if (!tokenResponse.ok) {
    const error = await tokenResponse.text();
    throw new Error(`Failed to get access token: ${error}`);
  }

  const tokenData = await tokenResponse.json();
  
  // Cache the token (expires in ~1 hour, we got it fresh)
  cachedAccessToken = tokenData.access_token;
  tokenExpiresAt = now + (tokenData.expires_in || 3600) * 1000;
  
  return cachedAccessToken!;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate with service role key - this is an internal function
    const authHeader = req.headers.get("Authorization");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!authHeader || authHeader !== `Bearer ${serviceRoleKey}`) {
      console.error("Unauthorized: Invalid or missing service role key");
      return new Response(
        JSON.stringify({ error: "Unauthorized - service role key required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const firebaseProjectId = Deno.env.get("FIREBASE_PROJECT_ID");

    // Parse and validate input
    let rawInput: unknown;
    try {
      rawInput = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const validation = validateInput(rawInput);
    if (!validation.valid || !validation.data) {
      return new Response(
        JSON.stringify({ error: validation.error }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { userId, title, body, data, url } = validation.data;

    console.log("Sending FCM notification to user:", userId);
    console.log("Title:", title, "Body:", body);

    // Start fetching subscriptions and access token in parallel
    const supabase = createClient(supabaseUrl, serviceRoleKey!);
    
    const [subscriptionsResult, accessToken] = await Promise.all([
      supabase
        .from("push_subscriptions")
        .select("id, endpoint, p256dh, auth")
        .eq("user_id", userId),
      getAccessToken()
    ]);

    const { data: subscriptions, error: subError } = subscriptionsResult;

    if (subError) {
      console.error("Error fetching subscriptions:", subError);
      return new Response(JSON.stringify({ error: "Failed to fetch subscriptions" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Found subscriptions:", subscriptions?.length || 0);

    if (!subscriptions || subscriptions.length === 0) {
      return new Response(JSON.stringify({ message: "No subscriptions found for user", sent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: Array<{ id: string; success: boolean; reason?: string; status?: number }> = [];

    // Send to all subscriptions in parallel
    const sendPromises = subscriptions.map(async (sub) => {
      try {
        // FCM token is stored in p256dh field
        const fcmToken = sub.p256dh;

        if (!fcmToken || sub.auth !== 'fcm') {
          console.log("Skipping non-FCM subscription:", sub.id);
          return { id: sub.id, success: false, reason: "Not an FCM subscription" };
        }

        const message: FCMMessageV1 = {
          message: {
            token: fcmToken,
            notification: {
              title,
              body: body || "",
            },
            data: {
              url: url || "/",
              ...(data || {}),
            },
            webpush: {
              notification: {
                icon: "/favicon.ico",
                badge: "/favicon.ico",
                vibrate: [300, 100, 300, 100, 300],
                requireInteraction: true,
                tag: "ride-notification",
              },
              fcm_options: {
                link: url || "/",
              },
            },
          },
        };

        const response = await fetch(
          `https://fcm.googleapis.com/v1/projects/${firebaseProjectId}/messages:send`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(message),
          }
        );

        console.log("FCM sent, status:", response.status);

        if (response.ok) {
          return { id: sub.id, success: true, status: response.status };
        } else {
          const errorText = await response.text();
          console.error("FCM failed:", response.status, errorText);

          // Token expired/invalid: clean it up
          if (response.status === 404 || response.status === 410 || errorText.includes("UNREGISTERED")) {
            await supabase.from("push_subscriptions").delete().eq("id", sub.id);
            return { id: sub.id, success: false, reason: "expired", status: response.status };
          } else {
            return { id: sub.id, success: false, reason: errorText, status: response.status };
          }
        }
      } catch (e: unknown) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        console.error("FCM send failed:", errorMessage);
        return { id: sub.id, success: false, reason: errorMessage };
      }
    });

    const allResults = await Promise.all(sendPromises);
    results.push(...allResults);

    const sent = results.filter((r) => r.success).length;

    return new Response(JSON.stringify({ sent, total: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in send-push-notification:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
