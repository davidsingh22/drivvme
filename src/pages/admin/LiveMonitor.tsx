import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Users, Zap, CheckCircle, Car } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import Navbar from '@/components/Navbar';

/* ─── types ─── */

interface OnlineUser {
  user_id: string;
  display_name: string | null;
  source: string;
  last_seen_at: string;
  role: 'rider' | 'driver';
}

interface FeedItem {
  id: string;
  icon: string;
  message: string;
  source: string;
  created_at: string;
}

/* ─── constants ─── */

const ONLINE_THRESHOLD_MS = 2 * 60_000; // 2 minutes for all platforms

const RIDE_STATUS_LABELS: Record<string, { icon: string; label: string }> = {
  searching: { icon: '🔍', label: 'Searching for driver' },
  pending_payment: { icon: '💳', label: 'Pending payment' },
  driver_assigned: { icon: '🚗', label: 'Driver assigned' },
  driver_en_route: { icon: '🚙', label: 'Driver en route' },
  arrived: { icon: '📍', label: 'Driver arrived' },
  in_progress: { icon: '🛣️', label: 'Ride in progress' },
  completed: { icon: '✅', label: 'Ride completed' },
  cancelled: { icon: '❌', label: 'Ride cancelled' },
};

function timeAgo(ts: string): string {
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

/* ─── component ─── */

export default function LiveMonitor() {
  const { isAdmin, authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [onlineRiders, setOnlineRiders] = useState<OnlineUser[]>([]);
  const [onlineDrivers, setOnlineDrivers] = useState<OnlineUser[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);

  const feedIdsRef = useRef(new Set<string>());

  // Auth guard
  useEffect(() => {
    if (!authLoading && !isAdmin) navigate('/login', { replace: true });
  }, [authLoading, isAdmin, navigate]);

  /* ── helper: push a feed item (deduped) ── */
  const pushFeedItem = useCallback((item: FeedItem) => {
    if (feedIdsRef.current.has(item.id)) return;
    feedIdsRef.current.add(item.id);
    setFeed((prev) => [item, ...prev].slice(0, 80));
    toast({ title: `${item.icon} New activity`, description: item.message });
  }, [toast]);

  /* ── load online counters from location tables (2-min window) ── */
  const loadOnlineUsers = useCallback(async () => {
    const cutoff = new Date(Date.now() - ONLINE_THRESHOLD_MS).toISOString();

    const [riderRes, driverRes] = await Promise.all([
      supabase
        .from('rider_locations')
        .select('user_id, last_seen_at, is_online')
        .gte('last_seen_at', cutoff),
      supabase
        .from('driver_locations')
        .select('user_id, updated_at, is_online')
        .eq('is_online', true)
        .gte('updated_at', cutoff),
    ]);

    // Fetch profile names for riders
    const riderRows = riderRes.data || [];
    const driverRows = driverRes.data || [];
    const allUserIds = [
      ...riderRows.map((r: any) => r.user_id),
      ...driverRows.map((d: any) => d.user_id),
    ];

    let profileMap = new Map<string, { first_name: string | null; last_name: string | null; email: string | null }>();
    if (allUserIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, first_name, last_name, email')
        .in('user_id', allUserIds);
      (profiles || []).forEach((p: any) => profileMap.set(p.user_id, p));
    }

    const getName = (uid: string) => {
      const p = profileMap.get(uid);
      if (!p) return null;
      const full = [p.first_name, p.last_name].filter(Boolean).join(' ');
      return full || p.email || null;
    };

    setOnlineRiders(
      riderRows.map((r: any) => ({
        user_id: r.user_id,
        display_name: getName(r.user_id),
        source: 'location',
        last_seen_at: r.last_seen_at,
        role: 'rider' as const,
      }))
    );

    setOnlineDrivers(
      driverRows.map((d: any) => ({
        user_id: d.user_id,
        display_name: getName(d.user_id),
        source: 'location',
        last_seen_at: d.updated_at,
        role: 'driver' as const,
      }))
    );
  }, []);

  /* ── load existing activity_events + recent rides for initial feed ── */
  const loadInitialFeed = useCallback(async () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();

    const [eventsRes, ridesRes] = await Promise.all([
      supabase
        .from('activity_events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30),
      supabase
        .from('rides')
        .select('id, rider_id, status, pickup_address, dropoff_address, estimated_fare, created_at, updated_at')
        .gte('created_at', tenMinAgo)
        .order('created_at', { ascending: false })
        .limit(30),
    ]);

    const items: FeedItem[] = [];

    // Convert activity_events
    (eventsRes.data || []).forEach((e: any) => {
      const EVENT_ICONS: Record<string, string> = {
        SIGNED_IN: '🟢',
        APP_OPENED: '🔵',
        BOOK_RIDE_CLICKED: '⚡',
        BOOKING_CONFIRMED: '✅',
      };
      items.push({
        id: `ae-${e.id}`,
        icon: EVENT_ICONS[e.event_type] || '📌',
        message: e.message,
        source: e.source || 'web',
        created_at: e.created_at,
      });
    });

    // Convert recent rides to feed items
    const riderIds = [...new Set((ridesRes.data || []).map((r: any) => r.rider_id).filter(Boolean))];
    let riderNames = new Map<string, string>();
    if (riderIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, first_name, last_name, email')
        .in('user_id', riderIds);
      (profiles || []).forEach((p: any) => {
        const name = [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email || p.user_id.slice(0, 8);
        riderNames.set(p.user_id, name);
      });
    }

    (ridesRes.data || []).forEach((ride: any) => {
      const riderName = riderNames.get(ride.rider_id) || ride.rider_id?.slice(0, 8) || 'Unknown';
      const statusInfo = RIDE_STATUS_LABELS[ride.status] || { icon: '📌', label: ride.status };

      items.push({
        id: `ride-${ride.id}-${ride.status}`,
        icon: statusInfo.icon,
        message: `${riderName}: ${statusInfo.label} — ${ride.pickup_address || '?'} → ${ride.dropoff_address || '?'} ($${Number(ride.estimated_fare || 0).toFixed(2)})`,
        source: 'rides',
        created_at: ride.status === 'searching' ? ride.created_at : ride.updated_at,
      });
    });

    // Sort by time, dedup, take top 80
    items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const deduped = items.filter((item) => {
      if (feedIdsRef.current.has(item.id)) return false;
      feedIdsRef.current.add(item.id);
      return true;
    }).slice(0, 80);

    setFeed(deduped);
  }, []);

  /* ── main data loading + realtime subscriptions ── */
  useEffect(() => {
    if (!isAdmin) return;

    Promise.all([loadOnlineUsers(), loadInitialFeed()]).then(() => setLoading(false));

    // Realtime: rides table — capture every ride lifecycle event
    const ridesCh = supabase
      .channel('admin-rides-feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'rides' }, async (payload: any) => {
        const ride = payload.new;
        // Fetch rider name
        let riderName = ride.rider_id?.slice(0, 8) || 'Unknown';
        if (ride.rider_id) {
          const { data } = await supabase
            .from('profiles')
            .select('first_name, last_name, email')
            .eq('user_id', ride.rider_id)
            .maybeSingle();
          if (data) {
            riderName = [data.first_name, data.last_name].filter(Boolean).join(' ') || data.email || riderName;
          }
        }

        pushFeedItem({
          id: `ride-${ride.id}-created`,
          icon: '⚡',
          message: `${riderName} is booking a ride — ${ride.pickup_address || '?'} → ${ride.dropoff_address || '?'} ($${Number(ride.estimated_fare || 0).toFixed(2)})`,
          source: 'rides',
          created_at: ride.created_at || new Date().toISOString(),
        });

        loadOnlineUsers();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rides' }, async (payload: any) => {
        const ride = payload.new;
        const oldRide = payload.old;

        // Only fire on status change
        if (ride.status === oldRide?.status) return;

        let riderName = ride.rider_id?.slice(0, 8) || 'Unknown';
        if (ride.rider_id) {
          const { data } = await supabase
            .from('profiles')
            .select('first_name, last_name, email')
            .eq('user_id', ride.rider_id)
            .maybeSingle();
          if (data) {
            riderName = [data.first_name, data.last_name].filter(Boolean).join(' ') || data.email || riderName;
          }
        }

        const statusInfo = RIDE_STATUS_LABELS[ride.status] || { icon: '📌', label: ride.status };

        pushFeedItem({
          id: `ride-${ride.id}-${ride.status}`,
          icon: statusInfo.icon,
          message: `${riderName}: ${statusInfo.label} — ${ride.pickup_address || '?'} → ${ride.dropoff_address || '?'}`,
          source: 'rides',
          created_at: ride.updated_at || new Date().toISOString(),
        });

        loadOnlineUsers();
      })
      .subscribe();

    // Realtime: activity_events (keep existing behavior)
    const activityCh = supabase
      .channel('admin-activity')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity_events' }, (payload: any) => {
        const row = payload.new;
        const EVENT_ICONS: Record<string, string> = {
          SIGNED_IN: '🟢',
          APP_OPENED: '🔵',
          BOOK_RIDE_CLICKED: '⚡',
          BOOKING_CONFIRMED: '✅',
        };
        pushFeedItem({
          id: `ae-${row.id}`,
          icon: EVENT_ICONS[row.event_type] || '📌',
          message: row.message,
          source: row.source || 'web',
          created_at: row.created_at,
        });
      })
      .subscribe();

    // Realtime: rider_locations + driver_locations for online counters
    const riderLocCh = supabase
      .channel('admin-rider-locs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rider_locations' }, () => {
        loadOnlineUsers();
      })
      .subscribe();

    const driverLocCh = supabase
      .channel('admin-driver-locs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_locations' }, () => {
        loadOnlineUsers();
      })
      .subscribe();

    // Poll online counters every 15s
    const poll = setInterval(loadOnlineUsers, 15_000);

    return () => {
      clearInterval(poll);
      supabase.removeChannel(ridesCh);
      supabase.removeChannel(activityCh);
      supabase.removeChannel(riderLocCh);
      supabase.removeChannel(driverLocCh);
    };
  }, [isAdmin, loadOnlineUsers, loadInitialFeed, pushFeedItem]);

  /* ── render ── */

  if (authLoading || !isAdmin) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading…</div>
      </div>
    );
  }

  const now = Date.now();
  const fiveMinAgo = new Date(now - 5 * 60_000).toISOString();
  const bookingEvents5m = feed.filter(
    (e) => (e.icon === '⚡') && e.created_at >= fiveMinAgo
  ).length;
  const successEvents5m = feed.filter(
    (e) => (e.icon === '✅') && e.created_at >= fiveMinAgo
  ).length;

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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="p-4 flex items-center gap-3">
            <Users className="h-6 w-6 text-primary" />
            <div>
              <div className="text-2xl font-bold">{onlineRiders.length}</div>
              <div className="text-xs text-muted-foreground">Riders online</div>
            </div>
          </Card>
          <Card className="p-4 flex items-center gap-3">
            <Car className="h-6 w-6 text-primary" />
            <div>
              <div className="text-2xl font-bold">{onlineDrivers.length}</div>
              <div className="text-xs text-muted-foreground">Drivers online</div>
            </div>
          </Card>
          <Card className="p-4 flex items-center gap-3">
            <Zap className="h-6 w-6 text-accent" />
            <div>
              <div className="text-2xl font-bold">{bookingEvents5m}</div>
              <div className="text-xs text-muted-foreground">Bookings (5m)</div>
            </div>
          </Card>
          <Card className="p-4 flex items-center gap-3">
            <CheckCircle className="h-6 w-6 text-primary" />
            <div>
              <div className="text-2xl font-bold">{successEvents5m}</div>
              <div className="text-xs text-muted-foreground">Completed (5m)</div>
            </div>
          </Card>
        </div>

        {/* Two panels */}
        <div className="grid md:grid-cols-2 gap-6">
          {/* Panel 1: Online Users */}
          <Card className="p-4">
            <h2 className="text-lg font-semibold mb-3">Online Users</h2>
            {loading ? (
              <div className="animate-pulse text-muted-foreground text-sm">Loading…</div>
            ) : onlineRiders.length === 0 && onlineDrivers.length === 0 ? (
              <div className="text-muted-foreground text-sm">No users online</div>
            ) : (
              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                {[...onlineRiders, ...onlineDrivers]
                  .sort((a, b) => new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime())
                  .map((u) => (
                    <div key={u.user_id} className="flex items-center justify-between p-2 rounded-lg border border-border">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full bg-green-500" />
                        <span className="text-sm font-medium truncate max-w-[160px]">
                          {u.display_name || u.user_id.slice(0, 8)}
                        </span>
                        <Badge variant="outline" className="text-xs capitalize">{u.role}</Badge>
                      </div>
                      <span className="text-xs text-muted-foreground">{timeAgo(u.last_seen_at)}</span>
                    </div>
                  ))}
              </div>
            )}
          </Card>

          {/* Panel 2: Live Activity Feed (table-driven) */}
          <Card className="p-4">
            <h2 className="text-lg font-semibold mb-3">Live Activity Feed</h2>
            {loading ? (
              <div className="animate-pulse text-muted-foreground text-sm">Loading…</div>
            ) : feed.length === 0 ? (
              <div className="text-muted-foreground text-sm">No events yet</div>
            ) : (
              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                {feed.map((e) => (
                  <div key={e.id} className="flex items-start gap-2 p-2 rounded-lg border border-border">
                    <span className="text-lg leading-none mt-0.5">{e.icon}</span>
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
