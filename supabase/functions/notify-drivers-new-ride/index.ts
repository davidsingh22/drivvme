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

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Input validation helper
function validateInput(input: unknown): {
  valid: boolean;
  data?: {
    rideId: string;
    pickupAddress?: string;
    dropoffAddress?: string;
    estimatedFare?: number;
    pickupLat?: number;
    pickupLng?: number;
    maxDistanceKm: number;
  };
  error?: string;
} {
  if (!input || typeof input !== 'object') {
    return { valid: false, error: 'Invalid JSON body' };
  }

  const { 
    rideId, 
    pickupAddress, 
    dropoffAddress, 
    estimatedFare,
    pickupLat,
    pickupLng,
    maxDistanceKm = 15,
  } = input as Record<string, unknown>;

  // Required fields
  if (typeof rideId !== 'string' || !UUID_REGEX.test(rideId)) {
    return { valid: false, error: 'rideId must be a valid UUID' };
  }

  // Optional fields
  if (pickupAddress !== undefined && (typeof pickupAddress !== 'string' || pickupAddress.length > 200)) {
    return { valid: false, error: 'pickupAddress must be a string up to 200 characters' };
  }
  if (dropoffAddress !== undefined && (typeof dropoffAddress !== 'string' || dropoffAddress.length > 200)) {
    return { valid: false, error: 'dropoffAddress must be a string up to 200 characters' };
  }
  if (estimatedFare !== undefined && (typeof estimatedFare !== 'number' || estimatedFare < 0 || estimatedFare > 10000)) {
    return { valid: false, error: 'estimatedFare must be a number between 0 and 10000' };
  }
  if (pickupLat !== undefined && (typeof pickupLat !== 'number' || pickupLat < -90 || pickupLat > 90)) {
    return { valid: false, error: 'pickupLat must be a number between -90 and 90' };
  }
  if (pickupLng !== undefined && (typeof pickupLng !== 'number' || pickupLng < -180 || pickupLng > 180)) {
    return { valid: false, error: 'pickupLng must be a number between -180 and 180' };
  }
  if (typeof maxDistanceKm !== 'number' || maxDistanceKm < 1 || maxDistanceKm > 100) {
    return { valid: false, error: 'maxDistanceKm must be a number between 1 and 100' };
  }

  return {
    valid: true,
    data: {
      rideId,
      pickupAddress: typeof pickupAddress === 'string' ? pickupAddress : undefined,
      dropoffAddress: typeof dropoffAddress === 'string' ? dropoffAddress : undefined,
      estimatedFare: typeof estimatedFare === 'number' ? estimatedFare : undefined,
      pickupLat: typeof pickupLat === 'number' ? pickupLat : undefined,
      pickupLng: typeof pickupLng === 'number' ? pickupLng : undefined,
      maxDistanceKm: typeof maxDistanceKm === 'number' ? maxDistanceKm : 15,
    },
  };
}

// Calculate distance between two coordinates using Haversine formula (returns km)
function calculateDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
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

// Send OneSignal notification to all drivers via tag filter
async function sendOneSignalDriverAlert(rideId: string, pickupAddress?: string): Promise<{ success: boolean; error?: string; onesignal_id?: string | null; recipients?: number }> {
  const apiKey = Deno.env.get("ONESIGNAL_REST_API_KEY");
  if (!apiKey) {
    console.error("ONESIGNAL_REST_API_KEY not configured");
    return { success: false, error: "Missing OneSignal API key", onesignal_id: null };
  }

  // Hardcoded app_id — same one that works in test-driver-push
  const appId = "5a6c4131-8faa-4969-b5c4-5a09033c8e2a";
  console.log("[notify-drivers-new-ride] Using hardcoded OneSignal app_id:", appId);

  // Hardcoded tag filter only — NO included_segments (they conflict with filters)
  const payload = {
    app_id: appId,
    filters: [
      { field: "tag", key: "role", relation: "=", value: "driver" },
    ],
    // No foreground presentation — let the app's internal UI handle the alert with beep + modal
    headings: { en: "New Ride Request Nearby! 🚗" },
    contents: { en: "A new ride request is available near you. Tap to view details!" },
    data: { ride_id: rideId, type: "new_ride", targetUrl: "/driver-dashboard" },
    priority: 10,
    ttl: 3600,
    ios_sound: "default",
    content_available: true,
    mutable_content: true,
  };

  console.log("[notify-drivers-new-ride] OneSignal payload:", JSON.stringify(payload));

  try {
    const res = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Basic ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const result = await res.json();
    console.log("[notify-drivers-new-ride] OneSignal status:", res.status, "response:", JSON.stringify(result));
    console.log("[notify-drivers-new-ride] Matched devices (recipients):", result?.recipients ?? "N/A");

    if (!res.ok || result?.errors?.length) {
      const errorMsg = result?.errors?.join(", ") || `HTTP ${res.status}`;
      console.error("[notify-drivers-new-ride] OneSignal ERROR:", errorMsg);
      return { success: false, error: errorMsg, onesignal_id: null, recipients: 0 };
    }

    return { 
      success: true, 
      onesignal_id: result?.id || null, 
      recipients: result?.recipients || 0 
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[notify-drivers-new-ride] OneSignal fetch failed:", msg);
    return { success: false, error: msg, onesignal_id: null };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const firebaseProjectId = Deno.env.get("FIREBASE_PROJECT_ID");

    // Parse input
    let rawInput: unknown;
    try {
      rawInput = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const raw = rawInput as Record<string, unknown>;

    // Handle trigger payload format (source: 'trigger')
    const isTrigger = raw.source === "trigger";
    let rideId: string;
    let pickupAddress: string | undefined;
    let dropoffAddress: string | undefined;
    let estimatedFare: number | undefined;
    let pickupLat: number | undefined;
    let pickupLng: number | undefined;
    let maxDistanceKm = 15;

    if (isTrigger) {
      rideId = raw.ride_id as string;
      pickupAddress = raw.pickup_address as string | undefined;
      dropoffAddress = raw.dropoff_address as string | undefined;
      estimatedFare = raw.estimated_fare as number | undefined;
      pickupLat = raw.pickup_lat as number | undefined;
      pickupLng = raw.pickup_lng as number | undefined;
      console.log("Trigger-invoked for new ride:", rideId);
    } else {
      // Existing validation for direct API calls
      const authHeader = req.headers.get("Authorization");
      if (!authHeader || authHeader !== `Bearer ${serviceRoleKey}`) {
        return new Response(
          JSON.stringify({ error: "Unauthorized" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const validation = validateInput(rawInput);
      if (!validation.valid || !validation.data) {
        return new Response(
          JSON.stringify({ error: validation.error }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      rideId = validation.data.rideId;
      pickupAddress = validation.data.pickupAddress;
      dropoffAddress = validation.data.dropoffAddress;
      estimatedFare = validation.data.estimatedFare;
      pickupLat = validation.data.pickupLat;
      pickupLng = validation.data.pickupLng;
      maxDistanceKm = validation.data.maxDistanceKm;
    }

    console.log("Notifying nearby drivers of new ride:", rideId);

    const supabase = createClient(supabaseUrl, serviceRoleKey!);

    // Get all online drivers with their current location
    const { data: onlineDrivers, error: driverError } = await supabase
      .from("driver_profiles")
      .select("user_id, current_lat, current_lng")
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
      return new Response(JSON.stringify({ 
        message: "No online drivers found", 
        sent: 0,
        nearbyDrivers: 0,
        totalOnline: 0 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Filter drivers by proximity to pickup location
    let nearbyDrivers = onlineDrivers;
    
    if (pickupLat && pickupLng) {
      nearbyDrivers = onlineDrivers.filter(driver => {
        // Include drivers without location data (they might have just gone online)
        if (!driver.current_lat || !driver.current_lng) {
          return true;
        }
        
        const distance = calculateDistanceKm(
          pickupLat, 
          pickupLng, 
          driver.current_lat, 
          driver.current_lng
        );
        
        console.log(`Driver ${driver.user_id} is ${distance.toFixed(2)}km from pickup`);
        return distance <= maxDistanceKm;
      });
      
      console.log(`Filtered to ${nearbyDrivers.length} nearby drivers within ${maxDistanceKm}km`);
    }

    if (nearbyDrivers.length === 0) {
      return new Response(JSON.stringify({ 
        message: "No nearby drivers found", 
        sent: 0,
        nearbyDrivers: 0,
        totalOnline: onlineDrivers.length 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const driverUserIds = nearbyDrivers.map(d => d.user_id);

    // Get push subscriptions for nearby online drivers
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

    // Create in-app notifications for all nearby drivers (even without push subscriptions)
    const inAppNotifications = nearbyDrivers.map(driver => ({
      user_id: driver.user_id,
      ride_id: rideId,
      type: "new_ride",
      title: "🚗 New Ride Request",
      message: `${pickupAddress || "Pickup"} → ${dropoffAddress || "Dropoff"}${estimatedFare ? ` • $${Number(estimatedFare).toFixed(2)}` : ""}`,
    }));

    const { error: notifError } = await supabase
      .from("notifications")
      .insert(inAppNotifications);

    if (notifError) {
      console.error("Failed to create in-app notifications:", notifError);
    } else {
      console.log(`Created ${inAppNotifications.length} in-app notifications`);
    }

    if (!subscriptions || subscriptions.length === 0) {
      return new Response(JSON.stringify({ 
        message: "No driver push subscriptions found, in-app notifications sent", 
        sent: 0,
        inAppNotifications: inAppNotifications.length,
        nearbyDrivers: nearbyDrivers.length,
        totalOnline: onlineDrivers.length 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get FCM access token
    let accessToken: string;
    try {
      accessToken = await getAccessToken();
    } catch (error) {
      console.error("Failed to get FCM access token:", error);
      return new Response(JSON.stringify({ 
        error: "FCM authentication failed",
        inAppNotifications: inAppNotifications.length 
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Professional notification content
    const fareDisplay = estimatedFare ? `$${Number(estimatedFare).toFixed(2)}` : "";
    const title = "🚗 New Ride Request Nearby";
    const body = `📍 ${pickupAddress || "Pickup location"}\n➡️ ${dropoffAddress || "Destination"}${fareDisplay ? `\n💰 Earn ${fareDisplay}` : ""}`;

    const results: Array<{ id: string; success: boolean; reason?: string; status?: number }> = [];

    // Send push notifications in parallel for faster delivery
    const pushPromises = subscriptions.map(async (sub) => {
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
              body,
            },
            data: {
              url: "/driver",
              rideId,
              type: "new_ride",
              pickupAddress: pickupAddress || "",
              dropoffAddress: dropoffAddress || "",
              estimatedFare: String(estimatedFare || ""),
            },
            webpush: {
              notification: {
                icon: "/favicon.ico",
                badge: "/favicon.ico",
                vibrate: [300, 100, 300, 100, 300],
                requireInteraction: true,
                tag: `ride-request-${rideId}`,
              },
              fcm_options: {
                link: "/driver",
              },
            },
            android: {
              priority: "high",
              notification: {
                icon: "ic_notification",
                color: "#10B981", // Green color for ride requests
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

    const pushResults = await Promise.all(pushPromises);
    results.push(...pushResults);

    const sent = results.filter((r) => r.success).length;

    // Also send OneSignal broadcast to all drivers
    const oneSignalResult = await sendOneSignalDriverAlert(rideId, pickupAddress);
    console.log("OneSignal driver alert:", oneSignalResult);

    return new Response(JSON.stringify({ 
      sent, 
      total: results.length, 
      nearbyDrivers: nearbyDrivers.length,
      totalOnline: onlineDrivers.length,
      inAppNotifications: inAppNotifications.length,
      oneSignal: oneSignalResult,
      results 
    }), {
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
