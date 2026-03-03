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

interface RiderLocationRow {
  user_id: string;
  last_seen_at: string;
  updated_at: string;
}

interface DriverLocationRow {
  user_id: string;
  updated_at: string;
}

const ONLINE_THRESHOLD_MS = 2 * 60_000;
const LOCATION_FEED_COOLDOWN_MS = 45_000;
const BOOKING_SUCCESS_STATUSES = new Set(['confirmed', 'paid']);

const RIDE_STATUS_LABELS: Record<string, { icon: string; label: string }> = {
  searching: { icon: '⚡', label: 'Rider is booking' },
  confirmed: { icon: '✅', label: 'Booking Successful' },
  paid: { icon: '✅', label: 'Booking Successful' },
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

export default function LiveMonitor() {
  const { isAdmin, authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [onlineRiders, setOnlineRiders] = useState<OnlineUser[]>([]);
  const [onlineDrivers, setOnlineDrivers] = useState<OnlineUser[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);

  const feedIdsRef = useRef(new Set<string>());
  const profileNameRef = useRef(new Map<string, string>());
  const locationFeedCooldownRef = useRef(new Map<string, number>());

  useEffect(() => {
    if (!authLoading && !isAdmin) navigate('/login', { replace: true });
  }, [authLoading, isAdmin, navigate]);

  const getCachedName = useCallback((uid: string) => {
    return profileNameRef.current.get(uid) || uid.slice(0, 8);
  }, []);

  const upsertProfileNames = useCallback(async (userIds: string[]) => {
    const uniqueIds = [...new Set(userIds.filter(Boolean))];
    const missingIds = uniqueIds.filter((id) => !profileNameRef.current.has(id));
    if (missingIds.length === 0) return;

    const { data, error } = await supabase
      .from('profiles')
      .select('user_id, first_name, last_name, email')
      .in('user_id', missingIds);

    if (error) {
      console.error('LiveMonitor: failed to load profile names', error);
      return;
    }

    (data || []).forEach((p) => {
      const display = [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email || p.user_id.slice(0, 8);
      profileNameRef.current.set(p.user_id, display);
    });
  }, []);

  const pushFeedItem = useCallback((item: FeedItem, shouldToast = true) => {
    if (feedIdsRef.current.has(item.id)) return;
    feedIdsRef.current.add(item.id);
    setFeed((prev) => [item, ...prev].slice(0, 80));
    if (shouldToast) {
      toast({ title: `${item.icon} New activity`, description: item.message });
    }
  }, [toast]);

  const maybePushLocationFeed = useCallback(async (role: 'rider' | 'driver', userId: string, seenAt: string) => {
    if (!seenAt || (Date.now() - new Date(seenAt).getTime()) > ONLINE_THRESHOLD_MS) return;

    const key = `${role}:${userId}`;
    const lastPushedAt = locationFeedCooldownRef.current.get(key) || 0;
    if (Date.now() - lastPushedAt < LOCATION_FEED_COOLDOWN_MS) return;

    await upsertProfileNames([userId]);
    locationFeedCooldownRef.current.set(key, Date.now());

    pushFeedItem({
      id: `loc-${role}-${userId}-${seenAt}`,
      icon: role === 'rider' ? '📡' : '🚕',
      message: `${getCachedName(userId)} active on app (${role})`,
      source: 'native',
      created_at: seenAt,
    }, false);
  }, [getCachedName, pushFeedItem, upsertProfileNames]);

  const loadOnlineUsers = useCallback(async () => {
    const cutoff = new Date(Date.now() - ONLINE_THRESHOLD_MS).toISOString();

    const [riderRes, driverRes, rolesRes] = await Promise.all([
      supabase
        .from('rider_locations')
        .select('user_id, last_seen_at, updated_at')
        .or(`last_seen_at.gte.${cutoff},updated_at.gte.${cutoff}`),
      supabase
        .from('driver_locations')
        .select('user_id, updated_at')
        .gte('updated_at', cutoff),
      supabase
        .from('user_roles')
        .select('user_id, role'),
    ]);

    if (riderRes.error || driverRes.error) {
      console.error('LiveMonitor: failed loading location tables', {
        riderError: riderRes.error,
        driverError: driverRes.error,
      });
    }

    // Build a set of driver user_ids from user_roles for accurate classification
    const driverRoleSet = new Set<string>();
    (rolesRes.data || []).forEach((r: any) => {
      if (r.role === 'driver') driverRoleSet.add(r.user_id);
    });

    const riderRows = (riderRes.data || []) as RiderLocationRow[];
    const driverRows = (driverRes.data || []) as DriverLocationRow[];

    // Collect latest timestamps per user across both tables
    const allUsersLatest = new Map<string, string>();

    riderRows.forEach((row) => {
      const ts = row.last_seen_at || row.updated_at;
      const prev = allUsersLatest.get(row.user_id);
      if (!prev || new Date(ts).getTime() > new Date(prev).getTime()) {
        allUsersLatest.set(row.user_id, ts);
      }
    });

    driverRows.forEach((row) => {
      const ts = row.updated_at;
      const prev = allUsersLatest.get(row.user_id);
      if (!prev || new Date(ts).getTime() > new Date(prev).getTime()) {
        allUsersLatest.set(row.user_id, ts);
      }
    });

    const allUserIds = [...allUsersLatest.keys()];
    await upsertProfileNames(allUserIds);

    const riders: OnlineUser[] = [];
    const drivers: OnlineUser[] = [];

    allUsersLatest.forEach((last_seen_at, user_id) => {
      const isDriver = driverRoleSet.has(user_id);
      const entry: OnlineUser = {
        user_id,
        display_name: getCachedName(user_id),
        source: 'native',
        last_seen_at,
        role: isDriver ? 'driver' : 'rider',
      };
      if (isDriver) {
        drivers.push(entry);
      } else {
        riders.push(entry);
      }
    });

    setOnlineRiders(riders);
    setOnlineDrivers(drivers);
  }, [getCachedName, upsertProfileNames]);

  const loadInitialFeed = useCallback(async () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();

    const [ridesRes, riderLocRes, driverLocRes] = await Promise.all([
      supabase
        .from('rides')
        .select('id, rider_id, status, pickup_address, dropoff_address, estimated_fare, created_at, updated_at')
        .gte('updated_at', tenMinAgo)
        .order('updated_at', { ascending: false })
        .limit(40),
      supabase
        .from('rider_locations')
        .select('user_id, last_seen_at, updated_at')
        .gte('last_seen_at', tenMinAgo)
        .order('last_seen_at', { ascending: false })
        .limit(40),
      supabase
        .from('driver_locations')
        .select('user_id, updated_at')
        .gte('updated_at', tenMinAgo)
        .order('updated_at', { ascending: false })
        .limit(40),
    ]);

    const riderIds = [
      ...(ridesRes.data || []).map((r) => r.rider_id).filter(Boolean) as string[],
      ...((riderLocRes.data || []).map((r) => r.user_id)),
      ...((driverLocRes.data || []).map((d) => d.user_id)),
    ];

    await upsertProfileNames(riderIds);

    const items: FeedItem[] = [];

    ((riderLocRes.data || []) as RiderLocationRow[]).forEach((row) => {
      const seenAt = row.last_seen_at || row.updated_at;
      items.push({
        id: `loc-rider-${row.user_id}-${seenAt}`,
        icon: '📡',
        message: `${getCachedName(row.user_id)} active on app (rider)`,
        source: 'native',
        created_at: seenAt,
      });
    });

    ((driverLocRes.data || []) as DriverLocationRow[]).forEach((row) => {
      items.push({
        id: `loc-driver-${row.user_id}-${row.updated_at}`,
        icon: '🚕',
        message: `${getCachedName(row.user_id)} active on app (driver)`,
        source: 'native',
        created_at: row.updated_at,
      });
    });

    (ridesRes.data || []).forEach((ride) => {
      const riderName = ride.rider_id ? getCachedName(ride.rider_id) : 'Unknown';
      const status = String(ride.status || '').toLowerCase();
      const statusInfo = RIDE_STATUS_LABELS[status] || { icon: '📌', label: status || 'Updated' };

      items.push({
        id: `ride-${ride.id}-${status}`,
        icon: statusInfo.icon,
        message: BOOKING_SUCCESS_STATUSES.has(status)
          ? `${riderName}: Booking Successful`
          : status === 'searching'
            ? `${riderName} is booking a ride — ${ride.pickup_address || '?'} → ${ride.dropoff_address || '?'} ($${Number(ride.estimated_fare || 0).toFixed(2)})`
            : `${riderName}: ${statusInfo.label} — ${ride.pickup_address || '?'} → ${ride.dropoff_address || '?'}`,
        source: 'rides',
        created_at: ride.updated_at || ride.created_at,
      });
    });

    items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const deduped = items.filter((item) => {
      if (feedIdsRef.current.has(item.id)) return false;
      feedIdsRef.current.add(item.id);
      return true;
    }).slice(0, 80);

    setFeed(deduped);
  }, [getCachedName, upsertProfileNames]);

  useEffect(() => {
    if (!isAdmin) return;

    feedIdsRef.current.clear();
    setFeed([]);

    Promise.all([loadOnlineUsers(), loadInitialFeed()]).finally(() => setLoading(false));

    const ridesCh = supabase
      .channel('admin-rides-feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'rides' }, async (payload: any) => {
        const ride = payload.new;
        const riderId = ride.rider_id as string | null;
        if (riderId) await upsertProfileNames([riderId]);

        const riderName = riderId ? getCachedName(riderId) : 'Unknown';

        pushFeedItem({
          id: `ride-${ride.id}-created`,
          icon: '⚡',
          message: `${riderName} is booking a ride — ${ride.pickup_address || '?'} → ${ride.dropoff_address || '?'} ($${Number(ride.estimated_fare || 0).toFixed(2)})`,
          source: 'rides',
          created_at: ride.created_at || new Date().toISOString(),
        });

        void loadOnlineUsers();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rides' }, async (payload: any) => {
        const ride = payload.new;
        const oldRide = payload.old;

        if (ride.status === oldRide?.status) return;

        const riderId = ride.rider_id as string | null;
        if (riderId) await upsertProfileNames([riderId]);

        const riderName = riderId ? getCachedName(riderId) : 'Unknown';
        const status = String(ride.status || '').toLowerCase();
        const statusInfo = RIDE_STATUS_LABELS[status] || { icon: '📌', label: status || 'Updated' };

        pushFeedItem({
          id: `ride-${ride.id}-${status}`,
          icon: statusInfo.icon,
          message: BOOKING_SUCCESS_STATUSES.has(status)
            ? `${riderName}: Booking Successful`
            : `${riderName}: ${statusInfo.label} — ${ride.pickup_address || '?'} → ${ride.dropoff_address || '?'}`,
          source: 'rides',
          created_at: ride.updated_at || new Date().toISOString(),
        });

        void loadOnlineUsers();
      })
      .subscribe();

    const riderLocCh = supabase
      .channel('admin-rider-locs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rider_locations' }, (payload: any) => {
        const row = payload.new as RiderLocationRow | undefined;
        if (row?.user_id) {
          const seenAt = row.last_seen_at || row.updated_at || new Date().toISOString();
          void maybePushLocationFeed('rider', row.user_id, seenAt);
        }
        void loadOnlineUsers();
      })
      .subscribe();

    const driverLocCh = supabase
      .channel('admin-driver-locs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_locations' }, (payload: any) => {
        const row = payload.new as DriverLocationRow | undefined;
        if (row?.user_id) {
          const seenAt = row.updated_at || new Date().toISOString();
          void maybePushLocationFeed('driver', row.user_id, seenAt);
        }
        void loadOnlineUsers();
      })
      .subscribe();

    const poll = setInterval(loadOnlineUsers, 15_000);

    return () => {
      clearInterval(poll);
      supabase.removeChannel(ridesCh);
      supabase.removeChannel(riderLocCh);
      supabase.removeChannel(driverLocCh);
    };
  }, [getCachedName, isAdmin, loadInitialFeed, loadOnlineUsers, maybePushLocationFeed, pushFeedItem, upsertProfileNames]);

  if (authLoading || !isAdmin) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading…</div>
      </div>
    );
  }

  const now = Date.now();
  const fiveMinAgo = new Date(now - 5 * 60_000).toISOString();
  const bookingEvents5m = feed.filter((e) => e.icon === '⚡' && e.created_at >= fiveMinAgo).length;
  const successEvents5m = feed.filter((e) => e.message.includes('Booking Successful') && e.created_at >= fiveMinAgo).length;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/admin')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">Live Monitor (MSN)</h1>
        </div>

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
              <div className="text-xs text-muted-foreground">Successful (5m)</div>
            </div>
          </Card>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          <Card className="p-4">
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              Online Riders
              <Badge variant="secondary" className="ml-auto">{onlineRiders.length}</Badge>
            </h2>
            {loading ? (
              <div className="animate-pulse text-muted-foreground text-sm">Loading…</div>
            ) : onlineRiders.length === 0 ? (
              <div className="text-muted-foreground text-sm">No riders online</div>
            ) : (
              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                {onlineRiders
                  .sort((a, b) => new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime())
                  .map((u) => (
                    <div key={`rider-${u.user_id}`} className="flex items-center justify-between p-2 rounded-lg border border-border">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full bg-green-500" />
                        <span className="text-sm font-medium truncate max-w-[140px]">{u.display_name || u.user_id.slice(0, 8)}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{timeAgo(u.last_seen_at)}</span>
                    </div>
                  ))}
              </div>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Car className="h-5 w-5 text-primary" />
              Online Drivers
              <Badge variant="secondary" className="ml-auto">{onlineDrivers.length}</Badge>
            </h2>
            {loading ? (
              <div className="animate-pulse text-muted-foreground text-sm">Loading…</div>
            ) : onlineDrivers.length === 0 ? (
              <div className="text-muted-foreground text-sm">No drivers online</div>
            ) : (
              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                {onlineDrivers
                  .sort((a, b) => new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime())
                  .map((u) => (
                    <div key={`driver-${u.user_id}`} className="flex items-center justify-between p-2 rounded-lg border border-border">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full bg-blue-500" />
                        <span className="text-sm font-medium truncate max-w-[140px]">{u.display_name || u.user_id.slice(0, 8)}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{timeAgo(u.last_seen_at)}</span>
                    </div>
                  ))}
              </div>
            )}
          </Card>

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
