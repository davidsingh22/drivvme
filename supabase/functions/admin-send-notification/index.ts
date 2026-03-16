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
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY')!;

    // Verify admin
    const userClient = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    const { data: isAdmin } = await adminClient.rpc('is_admin', { _user_id: user.id });
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: 'Admin only' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { title, message, audience } = await req.json();
    if (!title || !message || !audience) {
      return new Response(JSON.stringify({ error: 'Missing title, message, or audience' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const restApiKey = Deno.env.get('ONESIGNAL_REST_API_KEY');
    if (!restApiKey) throw new Error('ONESIGNAL_REST_API_KEY not configured');

    const payload: Record<string, unknown> = {
      app_id: '5a6c4131-8faa-4969-b5c4-5a09033c8e2a',
      headings: { en: title },
      contents: { en: message },
      priority: 10,
    };

    if (audience === 'drivers') {
      payload.filters = [{ field: 'tag', key: 'role', relation: '=', value: 'driver' }];
    } else if (audience === 'riders') {
      payload.filters = [{ field: 'tag', key: 'role', relation: '=', value: 'rider' }];
    } else {
      payload.included_segments = ['All'];
    }

    console.log('[admin-send-notification] sending to audience:', audience);

    const osRes = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': `Basic ${restApiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const osData = await osRes.json();
    console.log('[admin-send-notification] OneSignal response:', osRes.status, JSON.stringify(osData));

    if (!osRes.ok) {
      return new Response(JSON.stringify({ error: 'OneSignal error', details: osData }), {
        status: osRes.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Log to DB
    await adminClient.from('admin_notifications_log').insert({
      title,
      message,
      audience,
      sent_by_admin: user.id,
    });

    return new Response(JSON.stringify({ success: true, recipients: osData.recipients, id: osData.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[admin-send-notification] error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
