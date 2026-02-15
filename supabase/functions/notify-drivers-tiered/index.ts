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

interface DriverWithDistance {
  user_id: string;
  current_lat: number | null;
  current_lng: number | null;
  distance_km: number;
  is_priority: boolean;
  current_dropoff_lat?: number | null;
  current_dropoff_lng?: number | null;
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
    pickupLat: number;
    pickupLng: number;
    tier: number;
    excludeDriverIds: string[];
    maxEtaMinutes?: number;
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
    tier = 1,
    excludeDriverIds = [],
    maxEtaMinutes,
  } = input as Record<string, unknown>;

  // Required fields
  if (typeof rideId !== 'string' || !UUID_REGEX.test(rideId)) {
    return { valid: false, error: 'rideId must be a valid UUID' };
  }
  if (typeof pickupLat !== 'number' || pickupLat < -90 || pickupLat > 90) {
    return { valid: false, error: 'pickupLat must be a number between -90 and 90' };
  }
  if (typeof pickupLng !== 'number' || pickupLng < -180 || pickupLng > 180) {
    return { valid: false, error: 'pickupLng must be a number between -180 and 180' };
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
  if (typeof tier !== 'number' || tier < 1 || tier > 4) {
    return { valid: false, error: 'tier must be a number between 1 and 4' };
  }
  if (!Array.isArray(excludeDriverIds)) {
    return { valid: false, error: 'excludeDriverIds must be an array' };
  }
  // Validate each excludeDriverId is a valid UUID
  for (const id of excludeDriverIds) {
    if (typeof id !== 'string' || !UUID_REGEX.test(id)) {
      return { valid: false, error: 'excludeDriverIds must contain valid UUIDs' };
    }
  }
  if (maxEtaMinutes !== undefined && (typeof maxEtaMinutes !== 'number' || maxEtaMinutes < 1 || maxEtaMinutes > 120)) {
    return { valid: false, error: 'maxEtaMinutes must be a number between 1 and 120' };
  }

  return {
    valid: true,
    data: {
      rideId,
      pickupAddress: typeof pickupAddress === 'string' ? pickupAddress : undefined,
      dropoffAddress: typeof dropoffAddress === 'string' ? dropoffAddress : undefined,
      estimatedFare: typeof estimatedFare === 'number' ? estimatedFare : undefined,
      pickupLat,
      pickupLng,
      tier: typeof tier === 'number' ? tier : 1,
      excludeDriverIds: excludeDriverIds as string[],
      maxEtaMinutes: typeof maxEtaMinutes === 'number' ? maxEtaMinutes : undefined,
    },
  };
}

// Calculate distance between two coordinates using Haversine formula (returns km)
function calculateDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
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

// Estimate ETA based on distance (rough: 30km/h average in city)
function estimateEtaMinutes(distanceKm: number): number {
  return Math.ceil((distanceKm / 30) * 60);
}

// Get OAuth2 access token for FCM v1 API using service account
async function getAccessToken(): Promise<string> {
  const serviceAccountJson = Deno.env.get("FIREBASE_SERVICE_ACCOUNT");
  
  if (!serviceAccountJson) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT not configured");
  }

  const serviceAccount = JSON.parse(serviceAccountJson);

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const encoder = new TextEncoder();
  const headerB64 = btoa(JSON.stringify(header)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const payloadB64 = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const signInput = `${headerB64}.${payloadB64}`;

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
    // Authenticate - accept both service role key OR valid user JWT
    const authHeader = req.headers.get("Authorization");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    let isServiceRole = false;
    let userId: string | null = null;

    if (authHeader === `Bearer ${serviceRoleKey}`) {
      // Service role key - full access
      isServiceRole = true;
    } else if (authHeader?.startsWith("Bearer ")) {
      // Try to validate as user JWT
      const userClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } }
      });
      
      const token = authHeader.replace("Bearer ", "");
      const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
      
      if (claimsError || !claimsData?.claims?.sub) {
        console.error("Unauthorized: Invalid JWT");
        return new Response(
          JSON.stringify({ error: "Unauthorized" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      userId = claimsData.claims.sub as string;
    } else {
      console.error("Unauthorized: Missing authorization header");
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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

    const { 
      rideId, 
      pickupAddress, 
      dropoffAddress, 
      estimatedFare,
      pickupLat,
      pickupLng,
      tier,
      excludeDriverIds,
      maxEtaMinutes,
    } = validation.data;

    console.log(`[Tier ${tier}] Notifying drivers for ride:`, rideId);

    // Use service role key for database operations (either from direct auth or fetched)
    const supabase = createClient(supabaseUrl, serviceRoleKey!);

    // If user auth (not service role), verify they own this ride
    if (!isServiceRole && userId) {
      const { data: ride, error: rideCheckError } = await supabase
        .from("rides")
        .select("rider_id")
        .eq("id", rideId)
        .single();
      
      if (rideCheckError || !ride || ride.rider_id !== userId) {
        console.error("Unauthorized: User does not own this ride");
        return new Response(
          JSON.stringify({ error: "Unauthorized - not your ride" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Tier configuration — expanding radius, small batch dispatch
    const tierConfig = {
      1: { maxDistanceKm: 3, maxEta: 10, maxDrivers: 2, description: "3km radius, max 2 drivers" },
      2: { maxDistanceKm: 5, maxEta: 15, maxDrivers: 3, description: "5km radius, max 3 drivers" },
      3: { maxDistanceKm: 8, maxEta: 20, maxDrivers: 3, description: "8km radius, max 3 drivers" },
      4: { maxDistanceKm: 12, maxEta: 30, maxDrivers: 3, description: "12km radius, max 3 drivers" },
    };

    const config = tierConfig[tier as keyof typeof tierConfig] || tierConfig[1];
    const effectiveMaxEta = maxEtaMinutes ?? config.maxEta;

    // Get all online drivers with their current location and priority status
    const { data: onlineDrivers, error: driverError } = await supabase
      .from("driver_profiles")
      .select("user_id, current_lat, current_lng, priority_driver_until")
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
        tier,
        nearbyDrivers: 0,
        totalOnline: 0 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check which drivers are currently on a ride (to check dropoff proximity)
    const { data: busyRides } = await supabase
      .from("rides")
      .select("driver_id, dropoff_lat, dropoff_lng")
      .in("driver_id", onlineDrivers.map(d => d.user_id))
      .in("status", ["driver_assigned", "driver_en_route", "arrived", "in_progress"]);

    const busyDriverDropoffs = new Map<string, { lat: number; lng: number }>();
    busyRides?.forEach(ride => {
      if (ride.driver_id && ride.dropoff_lat && ride.dropoff_lng) {
        busyDriverDropoffs.set(ride.driver_id, { lat: ride.dropoff_lat, lng: ride.dropoff_lng });
      }
    });

    // Filter and sort drivers by distance
    const driversWithDistance: DriverWithDistance[] = onlineDrivers
      .filter(driver => !excludeDriverIds.includes(driver.user_id))
      .map(driver => {
        // For busy drivers, use their dropoff location instead
        const dropoffLocation = busyDriverDropoffs.get(driver.user_id);
        
        let distance = Infinity;
        if (dropoffLocation) {
          distance = calculateDistanceKm(pickupLat, pickupLng, dropoffLocation.lat, dropoffLocation.lng);
        } else if (driver.current_lat && driver.current_lng) {
          distance = calculateDistanceKm(pickupLat, pickupLng, driver.current_lat, driver.current_lng);
        }
        // Drivers without location are excluded (distance stays Infinity)

        const isPriority = driver.priority_driver_until && 
          new Date(driver.priority_driver_until) > new Date();

        return {
          user_id: driver.user_id,
          current_lat: driver.current_lat,
          current_lng: driver.current_lng,
          distance_km: distance,
          is_priority: !!isPriority,
        };
      })
      .filter((d): d is DriverWithDistance => d !== null)
      .filter(d => d.distance_km <= config.maxDistanceKm)
      .filter(d => estimateEtaMinutes(d.distance_km) <= effectiveMaxEta)
      .sort((a, b) => {
        // Priority drivers first, then by distance
        if (a.is_priority && !b.is_priority) return -1;
        if (!a.is_priority && b.is_priority) return 1;
        return a.distance_km - b.distance_km;
      });

    // Limit batch size per tier config
    const nearbyDrivers = driversWithDistance.slice(0, config.maxDrivers);

    console.log(`Tier ${tier}: Found ${nearbyDrivers.length} eligible drivers (${config.description})`);

    if (nearbyDrivers.length === 0) {
      // Update ride with current tier for escalation tracking
      await supabase
        .from("rides")
        .update({ 
          notification_tier: tier,
          last_notification_at: new Date().toISOString(),
        })
        .eq("id", rideId);

      return new Response(JSON.stringify({ 
        message: `No nearby drivers found for tier ${tier}`, 
        sent: 0,
        tier,
        config: config.description,
        nearbyDrivers: 0,
        totalOnline: onlineDrivers.length,
        shouldEscalate: tier < 4,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const driverUserIds = nearbyDrivers.map(d => d.user_id);

    // Update ride with notified drivers
    await supabase
      .from("rides")
      .update({ 
        notification_tier: tier,
        last_notification_at: new Date().toISOString(),
        notified_driver_ids: [...new Set([...excludeDriverIds, ...driverUserIds])],
      })
      .eq("id", rideId);

    // Get push subscriptions for nearby online drivers
    const { data: subscriptions, error: subError } = await supabase
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth")
      .in("user_id", driverUserIds);

    if (subError) {
      console.error("Error fetching subscriptions:", subError);
    }

    // Create enhanced in-app notifications with ETA and earnings
    const platformFee = 5;
    const minimumEarnings = estimatedFare ? estimatedFare - platformFee : undefined;

    const inAppNotifications = nearbyDrivers.map(driver => {
      const eta = estimateEtaMinutes(driver.distance_km);
      const isPriority = driver.is_priority;
      
      return {
        user_id: driver.user_id,
        ride_id: rideId,
        type: "new_ride",
        title: isPriority 
          ? "⚡ PRIORITY RIDE REQUEST" 
          : "🚗 New Ride Request",
        message: `${eta} min pickup • ${minimumEarnings ? `$${minimumEarnings.toFixed(2)} earnings` : ''} • ${pickupAddress || "Pickup"} → ${dropoffAddress || "Dropoff"}`,
      };
    });

    const { error: notifError } = await supabase
      .from("notifications")
      .insert(inAppNotifications);

    if (notifError) {
      console.error("Failed to create in-app notifications:", notifError);
    } else {
      console.log(`Created ${inAppNotifications.length} in-app notifications`);
    }

    // Send push notifications via multiple channels
    const results: Array<{ id: string; success: boolean; reason?: string }> = [];

    // --- Channel 1: OneSignal push notifications (primary) ---
    const oneSignalApiKey = Deno.env.get("ONESIGNAL_REST_API_KEY");
    if (oneSignalApiKey && driverUserIds.length > 0) {
      try {
        // Get OneSignal player IDs from profiles
        const { data: driverProfiles } = await supabase
          .from("profiles")
          .select("user_id, onesignal_player_id")
          .in("user_id", driverUserIds)
          .not("onesignal_player_id", "is", null);

        const playerIds = driverProfiles
          ?.map(p => p.onesignal_player_id)
          .filter(Boolean) as string[] || [];

        // Also send via external_user_ids for drivers without saved player IDs
        const driversWithPlayerId = new Set(driverProfiles?.map(p => p.user_id) || []);
        const driversWithoutPlayerId = driverUserIds.filter(id => !driversWithPlayerId.has(id));

        const oneSignalPayload: Record<string, unknown> = {
          app_id: "5a6c4131-8faa-4969-b5c4-5a09033c8e2a",
          headings: { en: nearbyDrivers.some(d => d.is_priority) ? "⚡ PRIORITY RIDE REQUEST" : "🚗 New Ride Request" },
          contents: { en: `${pickupAddress || "Pickup"} → ${dropoffAddress || "Dropoff"}${minimumEarnings ? ` • $${minimumEarnings.toFixed(2)}` : ""}` },
          url: "/driver",
          priority: 10,
          ios_sound: "default",
          android_sound: "default",
          content_available: true,
        };

        // Send to player IDs if available
        if (playerIds.length > 0) {
          const osRes = await fetch("https://onesignal.com/api/v1/notifications", {
            method: "POST",
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "Authorization": `Basic ${oneSignalApiKey}`,
            },
            body: JSON.stringify({ ...oneSignalPayload, include_player_ids: playerIds }),
          });
          const osData = await osRes.json();
          console.log(`OneSignal push (player_ids) result:`, osData);
          if (osRes.ok) {
            results.push(...playerIds.map(id => ({ id, success: true })));
          }
        }

        // Send to external user IDs for drivers without player IDs
        if (driversWithoutPlayerId.length > 0) {
          const osRes = await fetch("https://onesignal.com/api/v1/notifications", {
            method: "POST",
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "Authorization": `Basic ${oneSignalApiKey}`,
            },
            body: JSON.stringify({ ...oneSignalPayload, include_external_user_ids: driversWithoutPlayerId }),
          });
          const osData = await osRes.json();
          console.log(`OneSignal push (external_ids) result:`, osData);
          if (osRes.ok) {
            results.push(...driversWithoutPlayerId.map(id => ({ id, success: true })));
          }
        }
      } catch (osErr) {
        console.error("OneSignal push error:", osErr);
      }
    }

    // --- Channel 2: FCM push notifications (fallback) ---
    if (subscriptions && subscriptions.length > 0 && firebaseProjectId) {
      let accessToken: string;
      try {
        accessToken = await getAccessToken();
      } catch (error) {
        console.error("Failed to get FCM access token:", error);
        // Don't return error - OneSignal may have already succeeded
        accessToken = "";
      }

      if (accessToken) {
        const pushPromises = subscriptions.map(async (sub) => {
          const driver = nearbyDrivers.find(d => d.user_id === sub.user_id);
          if (!driver) return { id: sub.id, success: false, reason: "Driver not in list" };

          const fcmToken = sub.p256dh;
          if (!fcmToken || sub.auth !== 'fcm') {
            return { id: sub.id, success: false, reason: "Not an FCM subscription" };
          }

          const eta = estimateEtaMinutes(driver.distance_km);
          const isPriority = driver.is_priority;
          
          const title = isPriority 
            ? "⚡ PRIORITY RIDE • Accept Fast!"
            : `🚗 New Ride • ${eta} min pickup`;
          
          const body = minimumEarnings 
            ? `💰 $${minimumEarnings.toFixed(2)} earnings\n📍 ${pickupAddress || "Pickup"}`
            : `📍 ${pickupAddress || "Pickup"} → ${dropoffAddress || "Destination"}`;

          const message: FCMMessageV1 = {
            message: {
              token: fcmToken,
              notification: { title, body },
              data: {
                url: "/driver",
                rideId,
                type: "new_ride",
                pickupAddress: pickupAddress || "",
                dropoffAddress: dropoffAddress || "",
                estimatedFare: String(estimatedFare || ""),
                pickupEta: String(eta),
                minimumEarnings: String(minimumEarnings || ""),
                isPriority: String(isPriority),
              },
              webpush: {
                notification: {
                  icon: "/favicon.ico",
                  badge: "/favicon.ico",
                  vibrate: [300, 100, 300, 100, 300, 100, 300],
                  requireInteraction: true,
                  tag: `ride-request-${rideId}`,
                },
                fcm_options: { link: "/driver" },
              },
              android: {
                priority: "high",
                notification: {
                  icon: "ic_notification",
                  color: isPriority ? "#F59E0B" : "#10B981",
                  sound: "default",
                  channelId: "ride_requests",
                },
              },
            },
          };

          try {
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

            if (response.ok) {
              return { id: sub.id, success: true };
            } else {
              const errorText = await response.text();
              if (response.status === 404 || response.status === 410 || errorText.includes("UNREGISTERED")) {
                await supabase.from("push_subscriptions").delete().eq("id", sub.id);
                return { id: sub.id, success: false, reason: "expired" };
              }
              return { id: sub.id, success: false, reason: errorText };
            }
          } catch (e: unknown) {
            return { id: sub.id, success: false, reason: e instanceof Error ? e.message : String(e) };
          }
        });

        results.push(...await Promise.all(pushPromises));
      }
    }

    const sent = results.filter(r => r.success).length;

    return new Response(JSON.stringify({ 
      sent, 
      total: results.length,
      tier,
      config: config.description,
      nearbyDrivers: nearbyDrivers.length,
      totalOnline: onlineDrivers.length,
      inAppNotifications: inAppNotifications.length,
      notifiedDriverIds: driverUserIds,
      shouldEscalate: nearbyDrivers.length === 0 && tier < 4,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in notify-drivers-tiered:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
