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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const firebaseProjectId = Deno.env.get("FIREBASE_PROJECT_ID");

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
    } = await req.json();

    console.log(`[Tier ${tier}] Notifying drivers for ride:`, rideId);

    if (!rideId || !pickupLat || !pickupLng) {
      return new Response(JSON.stringify({ error: "rideId, pickupLat, pickupLng required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Tier configuration - TEST MODE: all tiers set to 100km for testing
    const tierConfig = {
      1: { maxDistanceKm: 100, maxEta: 60, description: "TEST MODE - 100km radius" },
      2: { maxDistanceKm: 100, maxEta: 60, description: "TEST MODE - 100km radius" },
      3: { maxDistanceKm: 100, maxEta: 60, description: "TEST MODE - 100km radius" },
      4: { maxDistanceKm: 100, maxEta: 60, description: "TEST MODE - Top 3 drivers" },
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
          // TEST MODE: Notify all busy drivers regardless of dropoff distance
          distance = calculateDistanceKm(pickupLat, pickupLng, dropoffLocation.lat, dropoffLocation.lng);
          // if (distance > 2) {
          //   return null; // Skip this busy driver - dropoff too far
          // }
        } else if (driver.current_lat && driver.current_lng) {
          distance = calculateDistanceKm(pickupLat, pickupLng, driver.current_lat, driver.current_lng);
        } else {
          // TEST MODE: Include all drivers without location by assuming they're very close
          // In production, this would be: distance = config.maxDistanceKm * 0.5
          distance = 1; // 1km - ensures they pass ETA filter
        }

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

    // For tier 4, only take top 3 drivers
    const nearbyDrivers = tier === 4 ? driversWithDistance.slice(0, 3) : driversWithDistance;

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

    // Send push notifications
    const results: Array<{ id: string; success: boolean; reason?: string }> = [];

    if (subscriptions && subscriptions.length > 0 && firebaseProjectId) {
      let accessToken: string;
      try {
        accessToken = await getAccessToken();
      } catch (error) {
        console.error("Failed to get FCM access token:", error);
        return new Response(JSON.stringify({ 
          error: "FCM authentication failed",
          inAppNotifications: inAppNotifications.length,
          tier,
        }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

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
