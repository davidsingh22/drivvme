import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface FCMMessage {
  message: {
    token: string;
    notification?: {
      title: string;
      body: string;
    };
    data?: Record<string, string>;
    webpush?: {
      notification?: {
        icon?: string;
        badge?: string;
        vibrate?: number[];
        requireInteraction?: boolean;
        tag?: string;
        actions?: Array<{ action: string; title: string }>;
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

async function getAccessToken(): Promise<string> {
  // For FCM HTTP v1 API, we need a service account
  // Using the legacy FCM API with server key for simplicity
  const serverKey = Deno.env.get("FCM_SERVER_KEY");
  if (!serverKey) {
    throw new Error("FCM_SERVER_KEY not configured");
  }
  return serverKey;
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

    const supabase = createClient(supabaseUrl, serviceRoleKey!);

    // Get FCM tokens for the user
    const { data: subscriptions, error: subError } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", userId);

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

    const serverKey = await getAccessToken();
    const projectId = Deno.env.get("FIREBASE_PROJECT_ID");

    const results: Array<{ id: string; success: boolean; reason?: string; status?: number }> = [];

    for (const sub of subscriptions) {
      try {
        // The endpoint contains the FCM token for FCM subscriptions
        // For FCM, the token is stored in the endpoint field
        const fcmToken = sub.endpoint.includes("fcm.googleapis.com") 
          ? sub.endpoint.split("/").pop() 
          : sub.p256dh; // Fallback to p256dh where we store FCM token

        if (!fcmToken) {
          results.push({ id: sub.id, success: false, reason: "No FCM token found" });
          continue;
        }

        const message: FCMMessage = {
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
                actions: [
                  { action: "open", title: "Open App" },
                  { action: "dismiss", title: "Dismiss" },
                ],
              },
              fcm_options: {
                link: url || "/",
              },
            },
          },
        };

        const response = await fetch(
          `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${serverKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(message),
          }
        );

        console.log("FCM sent, status:", response.status);

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

    return new Response(JSON.stringify({ sent, total: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in send-fcm-notification:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
