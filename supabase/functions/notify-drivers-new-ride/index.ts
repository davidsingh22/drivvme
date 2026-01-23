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
    android?: {
      priority: string;
      notification?: {
        icon?: string;
        color?: string;
        sound?: string;
        channelId?: string;
      };
    };
  };
}

// Get OAuth2 access token for FCM v1 API using service account
async function getAccessToken(): Promise<string> {
  const serviceAccountJson = Deno.env.get("FIREBASE_SERVICE_ACCOUNT");
  
  if (!serviceAccountJson) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT not configured");
  }

  const serviceAccount = JSON.parse(serviceAccountJson);

  // Create JWT for OAuth2
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
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
  return tokenData.access_token;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const firebaseProjectId = Deno.env.get("FIREBASE_PROJECT_ID");

    const { rideId, pickupAddress, dropoffAddress, estimatedFare } = await req.json();

    console.log("Notifying drivers of new ride:", rideId);

    if (!rideId) {
      return new Response(JSON.stringify({ error: "rideId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get all online drivers
    const { data: onlineDrivers, error: driverError } = await supabase
      .from("driver_profiles")
      .select("user_id")
      .eq("is_online", true);

    if (driverError) {
      console.error("Error fetching online drivers:", driverError);
      return new Response(JSON.stringify({ error: "Failed to fetch drivers" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Found online drivers:", onlineDrivers?.length || 0);

    if (!onlineDrivers || onlineDrivers.length === 0) {
      return new Response(JSON.stringify({ message: "No online drivers found", sent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const driverUserIds = onlineDrivers.map(d => d.user_id);

    // Get push subscriptions for all online drivers
    const { data: subscriptions, error: subError } = await supabase
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth")
      .in("user_id", driverUserIds);

    if (subError) {
      console.error("Error fetching subscriptions:", subError);
      return new Response(JSON.stringify({ error: "Failed to fetch subscriptions" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Found driver subscriptions:", subscriptions?.length || 0);

    if (!subscriptions || subscriptions.length === 0) {
      return new Response(JSON.stringify({ message: "No driver subscriptions found", sent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get FCM access token
    let accessToken: string;
    try {
      accessToken = await getAccessToken();
    } catch (error) {
      console.error("Failed to get FCM access token:", error);
      return new Response(JSON.stringify({ error: "FCM authentication failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const fareDisplay = estimatedFare ? `$${Number(estimatedFare).toFixed(2)}` : "";
    const title = "🚗 New Ride Request!";
    const body = `${pickupAddress || "Pickup"} → ${dropoffAddress || "Dropoff"}${fareDisplay ? ` • ${fareDisplay}` : ""}`;

    const results: Array<{ id: string; success: boolean; reason?: string; status?: number }> = [];

    for (const sub of subscriptions) {
      try {
        // FCM token is stored in p256dh field
        const fcmToken = sub.p256dh;

        if (!fcmToken || sub.auth !== 'fcm') {
          console.log("Skipping non-FCM subscription:", sub.id);
          results.push({ id: sub.id, success: false, reason: "Not an FCM subscription" });
          continue;
        }

        const message: FCMMessageV1 = {
          message: {
            token: fcmToken,
            notification: {
              title,
              body,
            },
            data: {
              url: "/driver",
              rideId,
              type: "new_ride",
            },
            webpush: {
              notification: {
                icon: "/favicon.ico",
                badge: "/favicon.ico",
                vibrate: [300, 100, 300, 100, 300],
                requireInteraction: true,
                tag: "ride-request",
              },
              fcm_options: {
                link: "/driver",
              },
            },
            android: {
              priority: "high",
              notification: {
                icon: "ic_notification",
                color: "#4F46E5",
                sound: "default",
                channelId: "ride_requests",
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

        console.log("FCM sent to driver, status:", response.status);

        if (response.ok) {
          results.push({ id: sub.id, success: true, status: response.status });
        } else {
          const errorText = await response.text();
          console.error("FCM failed:", response.status, errorText);

          // Token expired/invalid: clean it up
          if (response.status === 404 || response.status === 410 || errorText.includes("UNREGISTERED")) {
            await supabase.from("push_subscriptions").delete().eq("id", sub.id);
            results.push({ id: sub.id, success: false, reason: "expired", status: response.status });
          } else {
            results.push({ id: sub.id, success: false, reason: errorText, status: response.status });
          }
        }
      } catch (e: unknown) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        console.error("FCM send failed:", errorMessage);
        results.push({ id: sub.id, success: false, reason: errorMessage });
      }
    }

    const sent = results.filter((r) => r.success).length;

    return new Response(JSON.stringify({ sent, total: results.length, driversNotified: driverUserIds.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in notify-drivers-new-ride:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
