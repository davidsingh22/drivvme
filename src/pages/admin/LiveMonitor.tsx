import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Users, Zap, CheckCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import Navbar from '@/components/Navbar';

interface PresenceRow {
  user_id: string;
  role: string;
  display_name: string | null;
  source: string;
  last_seen_at: string;
}

interface ActivityRow {
  id: string;
  user_id: string;
  role: string;
  event_type: string;
  message: string;
  source: string;
  meta: any;
  created_at: string;
}

interface RiderLocationRow {
  user_id: string;
  is_online: boolean;
  last_seen_at: string;
}

interface ProfileNameRow {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

const EVENT_ICONS: Record<string, string> = {
  SIGNED_IN: '🟢',
  APP_OPENED: '🔵',
  BOOK_RIDE_CLICKED: '⚡',
  BOOKING_CONFIRMED: '✅',
};

const MOBILE_ONLINE_GRACE_MS = 5 * 60_000;
const WEB_ONLINE_GRACE_MS = 60_000;

function timeAgo(ts: string): string {
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function isOnlineBySource(rider: PresenceRow, now: number): boolean {
  const source = (rider.source || '').toLowerCase();
  const threshold = source === 'ios' || source === 'android' || source === 'app'
    ? MOBILE_ONLINE_GRACE_MS
    : WEB_ONLINE_GRACE_MS;

  return now - new Date(rider.last_seen_at).getTime() < threshold;
}

export default function LiveMonitor() {
  const { isAdmin, authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [riders, setRiders] = useState<PresenceRow[]>([]);
  const [events, setEvents] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const eventIdsRef = useRef(new Set<string>());

  // Auth guard
  useEffect(() => {
    if (!authLoading && !isAdmin) navigate('/login', { replace: true });
  }, [authLoading, isAdmin, navigate]);

  // Load initial data
  useEffect(() => {
    if (!isAdmin) return;

    const loadRiders = async () => {
      const fiveMinAgoIso = new Date(Date.now() - MOBILE_ONLINE_GRACE_MS).toISOString();

      const [presenceRes, locationRes] = await Promise.all([
        supabase
          .from('presence')
          .select('user_id, role, display_name, source, last_seen_at')
          .eq('role', 'RIDER')
          .order('last_seen_at', { ascending: false }),
        supabase
          .from('rider_locations')
          .select('user_id, is_online, last_seen_at')
          .eq('is_online', true)
          .gte('last_seen_at', fiveMinAgoIso),
      ]);

      if (presenceRes.error) {
        console.error('[LiveMonitor] presence query failed:', presenceRes.error.message);
        toast({ title: 'Failed to load riders', description: presenceRes.error.message, variant: 'destructive' });
        return;
      }

      if (locationRes.error) {
        console.error('[LiveMonitor] rider_locations query failed:', locationRes.error.message);
      }

      const merged = new Map<string, PresenceRow>();
      const presenceRows = (presenceRes.data || []) as PresenceRow[];
      const locationRows = (locationRes.data || []) as RiderLocationRow[];

      presenceRows.forEach((row) => merged.set(row.user_id, { ...row }));

      const locationUserIds = [...new Set(locationRows.map((r) => r.user_id))];
      let profileMap = new Map<string, ProfileNameRow>();

      if (locationUserIds.length > 0) {
        const { data: profileRows, error: profileError } = await supabase
          .from('profiles')
          .select('user_id, first_name, last_name, email')
          .in('user_id', locationUserIds);

        if (profileError) {
          console.error('[LiveMonitor] profile lookup failed:', profileError.message);
        } else {
          profileMap = new Map((profileRows as ProfileNameRow[]).map((p) => [p.user_id, p]));
        }
      }

      locationRows.forEach((loc) => {
        const existing = merged.get(loc.user_id);
        const profile = profileMap.get(loc.user_id);
        const displayFromProfile = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || profile?.email || null;

        if (existing) {
          if (new Date(loc.last_seen_at).getTime() > new Date(existing.last_seen_at).getTime()) {
            existing.last_seen_at = loc.last_seen_at;
            if (!existing.source || existing.source === 'web') {
              existing.source = 'app';
            }
          }

          if (!existing.display_name && displayFromProfile) {
            existing.display_name = displayFromProfile;
          }

          merged.set(loc.user_id, existing);
          return;
        }

        merged.set(loc.user_id, {
          user_id: loc.user_id,
          role: 'RIDER',
          display_name: displayFromProfile,
          source: 'app',
          last_seen_at: loc.last_seen_at,
        });
      });

      const rows = [...merged.values()].sort(
        (a, b) => new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime()
      );

      setRiders(rows);
    };

    const loadEvents = async () => {
      const { data, error } = await supabase
        .from('activity_events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) {
        console.error('[LiveMonitor] activity_events query failed:', error.message);
        toast({ title: 'Failed to load activity', description: error.message, variant: 'destructive' });
        return;
      }

      if (data) {
        const rows = data as ActivityRow[];
        setEvents(rows);
        rows.forEach((e) => eventIdsRef.current.add(e.id));
      }
    };

    Promise.all([loadRiders(), loadEvents()]).then(() => setLoading(false));

    // Realtime: presence changes
    const presenceCh = supabase
      .channel('admin-presence')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'presence' }, () => {
        loadRiders();
      })
      .subscribe();

    // Realtime: rider_locations fallback changes (mobile app)
    const riderLocationsCh = supabase
      .channel('admin-rider-locations')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rider_locations' }, () => {
        loadRiders();
      })
      .subscribe();

    // Realtime: new activity events
    const activityCh = supabase
      .channel('admin-activity')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity_events' }, (payload: any) => {
        const row = payload.new as ActivityRow;
        if (!eventIdsRef.current.has(row.id)) {
          eventIdsRef.current.add(row.id);
          setEvents((prev) => [row, ...prev].slice(0, 50));
          toast({ title: `${EVENT_ICONS[row.event_type] || '📌'} New activity`, description: row.message });
        }
      })
      .subscribe();

    // Poll riders every 15s for freshness
    const poll = setInterval(loadRiders, 15_000);

    return () => {
      clearInterval(poll);
      supabase.removeChannel(presenceCh);
      supabase.removeChannel(riderLocationsCh);
      supabase.removeChannel(activityCh);
    };
  }, [isAdmin, toast]);

  if (authLoading || !isAdmin) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading…</div>
      </div>
    );
  }

  const now = Date.now();
  const onlineRiders = riders.filter((r) => isOnlineBySource(r, now));
  const fiveMinAgo = new Date(now - 5 * 60_000).toISOString();
  const bookClicks5m = events.filter((e) => e.event_type === 'BOOK_RIDE_CLICKED' && e.created_at >= fiveMinAgo).length;
  const confirmed5m = events.filter((e) => e.event_type === 'BOOKING_CONFIRMED' && e.created_at >= fiveMinAgo).length;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/admin')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">Live Monitor (MSN)</h1>
        </div>

        {/* Counters */}
        <div className="grid grid-cols-3 gap-4">
          <Card className="p-4 flex items-center gap-3">
            <Users className="h-6 w-6 text-primary" />
            <div>
              <div className="text-2xl font-bold">{onlineRiders.length}</div>
              <div className="text-xs text-muted-foreground">Online riders now</div>
            </div>
          </Card>
          <Card className="p-4 flex items-center gap-3">
            <Zap className="h-6 w-6 text-accent" />
            <div>
              <div className="text-2xl font-bold">{bookClicks5m}</div>
              <div className="text-xs text-muted-foreground">Book clicks (5m)</div>
            </div>
          </Card>
          <Card className="p-4 flex items-center gap-3">
            <CheckCircle className="h-6 w-6 text-secondary-foreground" />
            <div>
              <div className="text-2xl font-bold">{confirmed5m}</div>
              <div className="text-xs text-muted-foreground">Confirmed (5m)</div>
            </div>
          </Card>
        </div>

        {/* Two panels */}
        <div className="grid md:grid-cols-2 gap-6">
          {/* Panel 1: Live Riders Online */}
          <Card className="p-4">
            <h2 className="text-lg font-semibold mb-3">Live Riders Online</h2>
            {loading ? (
              <div className="animate-pulse text-muted-foreground text-sm">Loading…</div>
            ) : riders.length === 0 ? (
              <div className="text-muted-foreground text-sm">No riders found</div>
            ) : (
              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                {riders.map((r) => {
                  const isOnline = isOnlineBySource(r, now);
                  return (
                    <div key={r.user_id} className="flex items-center justify-between p-2 rounded-lg border border-border">
                      <div className="flex items-center gap-2">
                        <span className={`h-2.5 w-2.5 rounded-full ${isOnline ? 'bg-green-500' : 'bg-muted-foreground/40'}`} />
                        <span className="text-sm font-medium truncate max-w-[160px]">
                          {r.display_name || r.user_id.slice(0, 8)}
                        </span>
                        <Badge variant="outline" className="text-xs">{r.source}</Badge>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {isOnline ? 'Online' : `Last seen ${timeAgo(r.last_seen_at)}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Panel 2: Live Activity Feed */}
          <Card className="p-4">
            <h2 className="text-lg font-semibold mb-3">Live Activity Feed</h2>
            {loading ? (
              <div className="animate-pulse text-muted-foreground text-sm">Loading…</div>
            ) : events.length === 0 ? (
              <div className="text-muted-foreground text-sm">No events yet</div>
            ) : (
              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                {events.map((e) => (
                  <div key={e.id} className="flex items-start gap-2 p-2 rounded-lg border border-border">
                    <span className="text-lg leading-none mt-0.5">{EVENT_ICONS[e.event_type] || '📌'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm">{e.message}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground">{timeAgo(e.created_at)}</span>
                        <Badge variant="outline" className="text-xs">{e.source}</Badge>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
