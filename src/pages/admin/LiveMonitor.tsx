import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Users, Zap, CheckCircle, Car, Bell, Search, Home, ShoppingCart, Power, Navigation2, MapPin } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import Navbar from '@/components/Navbar';

const RIDE_OFFER_TIMEOUT_S = 25;

interface ActiveRideOffer {
  id: string; // notification id
  rideId: string;
  driverUserId: string;
  driverName: string;
  riderName: string;
  pickupAddress: string;
  dropoffAddress: string;
  estimatedFare: number;
  sentAt: number; // epoch ms
}

function RideOfferCountdown({ offer, onExpired }: { offer: ActiveRideOffer; onExpired: (id: string) => void }) {
  const [remaining, setRemaining] = useState(() => {
    const elapsed = Math.floor((Date.now() - offer.sentAt) / 1000);
    return Math.max(0, RIDE_OFFER_TIMEOUT_S - elapsed);
  });

  useEffect(() => {
    if (remaining <= 0) { onExpired(offer.id); return; }
    const t = setInterval(() => {
      const elapsed = Math.floor((Date.now() - offer.sentAt) / 1000);
      const r = Math.max(0, RIDE_OFFER_TIMEOUT_S - elapsed);
      setRemaining(r);
      if (r <= 0) { onExpired(offer.id); clearInterval(t); }
    }, 1000);
    return () => clearInterval(t);
  }, [offer.sentAt, offer.id, onExpired, remaining]);

  const urgency = remaining <= 5 ? 'text-red-500 font-bold' : remaining <= 10 ? 'text-orange-500 font-semibold' : 'text-yellow-500';

  return (
    <div className="flex items-start gap-2 p-3 rounded-lg border-2 border-yellow-500/50 bg-yellow-500/5 animate-pulse-slow">
      <Bell className="h-5 w-5 text-yellow-500 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">
          🔔 {offer.driverName} is receiving a ride request from {offer.riderName}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {offer.pickupAddress} → {offer.dropoffAddress} · ${offer.estimatedFare.toFixed(2)}
        </div>
        <div className={`text-sm mt-1 ${urgency}`}>
          ⏱ {remaining}s remaining to accept
        </div>
      </div>
    </div>
  );
}

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
  feedRole: 'rider' | 'driver' | 'both';
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

interface RideActivityRow {
  rider_id: string | null;
  updated_at: string;
  status: string;
}

const ONLINE_THRESHOLD_MS = 5 * 60_000;
const LOCATION_FEED_COOLDOWN_MS = 45_000;
const ACTIVE_RIDER_RIDE_STATUSES = ['searching', 'pending_payment', 'driver_assigned', 'driver_en_route', 'arrived', 'in_progress'] as const;
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
  const [activeOffers, setActiveOffers] = useState<ActiveRideOffer[]>([]);
  const [loading, setLoading] = useState(true);

  // Rider presence state
  interface RiderPresenceRow {
    user_id: string;
    display_name: string | null;
    status: string;
    current_screen: string;
    last_seen: string;
  }
  const [riderPresence, setRiderPresence] = useState<RiderPresenceRow[]>([]);

  // Driver presence state
  interface DriverPresenceRow {
    driver_id: string;
    display_name: string | null;
    status: string;
    current_screen: string;
    last_seen: string;
    lat: number | null;
    lng: number | null;
  }
  const [driverPresence, setDriverPresence] = useState<DriverPresenceRow[]>([]);

  const feedIdsRef = useRef(new Set<string>());
  const profileNameRef = useRef(new Map<string, string>());
  const locationFeedCooldownRef = useRef(new Map<string, number>());
  const roleByUserRef = useRef(new Map<string, 'rider' | 'driver'>());

  const resolveRoleByUserId = useCallback(async (userId: string): Promise<'rider' | 'driver'> => {
    const cached = roleByUserRef.current.get(userId);
    if (cached) return cached;

    const { data, error } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.error('LiveMonitor: failed to resolve role', { userId, error });
      return 'rider';
    }

    const resolved: 'rider' | 'driver' = data?.role === 'driver' ? 'driver' : 'rider';
    roleByUserRef.current.set(userId, resolved);
    return resolved;
  }, []);

  useEffect(() => {
    if (!authLoading && !isAdmin) navigate('/login', { replace: true });
  }, [authLoading, isAdmin, navigate]);

  // ── Rider Presence: fetch + realtime ──
  const loadRiderPresence = useCallback(async () => {
    const cutoff = new Date(Date.now() - 60_000).toISOString();
    const { data } = await supabase
      .from('rider_presence' as any)
      .select('user_id, display_name, status, current_screen, last_seen')
      .eq('status', 'online')
      .gte('last_seen', cutoff);
    if (data) setRiderPresence(data as any);
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    loadRiderPresence();
    const interval = setInterval(loadRiderPresence, 15_000);
    const channel = supabase
      .channel('rider-presence-monitor')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rider_presence' }, () => {
        loadRiderPresence();
      })
      .subscribe();
    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [isAdmin, loadRiderPresence]);

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
      feedRole: role,
    }, false);
  }, [getCachedName, pushFeedItem, upsertProfileNames]);

  const loadOnlineUsers = useCallback(async () => {
    const cutoff = new Date(Date.now() - ONLINE_THRESHOLD_MS).toISOString();

    const [riderRes, driverRes, rolesRes, activeRidesRes, presenceRes, onlineDriverProfilesRes] = await Promise.all([
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
      supabase
        .from('rides')
        .select('rider_id, updated_at, status')
        .gte('updated_at', cutoff)
        .in('status', [...ACTIVE_RIDER_RIDE_STATUSES]),
      supabase
        .from('presence')
        .select('user_id, last_seen_at, role')
        .gte('last_seen_at', cutoff),
      // Always show drivers who are flagged as online in their profile,
      // even if their heartbeat is stale (e.g. app backgrounded on mobile)
      supabase
        .from('driver_profiles')
        .select('user_id, updated_at')
        .eq('is_online', true),
    ]);

    if (riderRes.error || driverRes.error || activeRidesRes.error) {
      console.error('LiveMonitor: failed loading online presence sources', {
        riderError: riderRes.error,
        driverError: driverRes.error,
        rideActivityError: activeRidesRes.error,
      });
    }

    // Build a set of driver user_ids from user_roles for accurate classification
    const driverRoleSet = new Set<string>();
    (rolesRes.data || []).forEach((r: any) => {
      const normalizedRole: 'rider' | 'driver' = r.role === 'driver' ? 'driver' : 'rider';
      roleByUserRef.current.set(r.user_id, normalizedRole);
      if (normalizedRole === 'driver') driverRoleSet.add(r.user_id);
    });

    const riderRows = (riderRes.data || []) as RiderLocationRow[];
    const driverRows = (driverRes.data || []) as DriverLocationRow[];
    const rideActivityRows = (activeRidesRes.data || []) as RideActivityRow[];
    const presenceRows = (presenceRes.data || []) as { user_id: string; last_seen_at: string; role: string }[];

    // Collect latest timestamps per user across all sources
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

    rideActivityRows.forEach((row) => {
      if (!row.rider_id) return;
      const ts = row.updated_at;
      const prev = allUsersLatest.get(row.rider_id);
      if (!prev || new Date(ts).getTime() > new Date(prev).getTime()) {
        allUsersLatest.set(row.rider_id, ts);
      }
    });

    // Also consider presence heartbeat as an online signal
    presenceRows.forEach((row) => {
      const ts = row.last_seen_at;
      const prev = allUsersLatest.get(row.user_id);
      if (!prev || new Date(ts).getTime() > new Date(prev).getTime()) {
        allUsersLatest.set(row.user_id, ts);
      }

      const normalizedPresenceRole = String(row.role || '').toLowerCase();
      if (normalizedPresenceRole === 'driver') {
        driverRoleSet.add(row.user_id);
        roleByUserRef.current.set(row.user_id, 'driver');
      }
    });

    // Drivers flagged as is_online=true in driver_profiles always appear,
    // even if heartbeat/location data is stale (backgrounded app)
    ((onlineDriverProfilesRes.data || []) as { user_id: string; updated_at: string }[]).forEach((row) => {
      driverRoleSet.add(row.user_id);
      roleByUserRef.current.set(row.user_id, 'driver');
      if (!allUsersLatest.has(row.user_id)) {
        allUsersLatest.set(row.user_id, row.updated_at || new Date().toISOString());
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

    const [ridesRes, riderLocRes, driverLocRes, rolesRes] = await Promise.all([
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
      supabase
        .from('user_roles')
        .select('user_id, role'),
    ]);

    if (rolesRes.error) {
      console.error('LiveMonitor: failed loading user roles for activity feed', rolesRes.error);
    }

    const riderIds = [
      ...(ridesRes.data || []).map((r) => r.rider_id).filter(Boolean) as string[],
      ...((riderLocRes.data || []).map((r) => r.user_id)),
      ...((driverLocRes.data || []).map((d) => d.user_id)),
    ];

    const roleByUser = new Map<string, 'rider' | 'driver'>();
    (rolesRes.data || []).forEach((r: any) => {
      const normalizedRole: 'rider' | 'driver' = r.role === 'driver' ? 'driver' : 'rider';
      roleByUser.set(r.user_id, normalizedRole);
      roleByUserRef.current.set(r.user_id, normalizedRole);
    });

    await upsertProfileNames(riderIds);

    const items: FeedItem[] = [];

    ((riderLocRes.data || []) as RiderLocationRow[]).forEach((row) => {
      const role = roleByUser.get(row.user_id) || roleByUserRef.current.get(row.user_id) || 'rider';
      if (role !== 'rider') return;

      const seenAt = row.last_seen_at || row.updated_at;
      items.push({
        id: `loc-rider-${row.user_id}-${seenAt}`,
        icon: '📡',
        message: `${getCachedName(row.user_id)} active on app (rider)`,
        source: 'native',
        created_at: seenAt,
        feedRole: 'rider',
      });
    });

    ((driverLocRes.data || []) as DriverLocationRow[]).forEach((row) => {
      const role = roleByUser.get(row.user_id) || roleByUserRef.current.get(row.user_id) || 'rider';
      if (role !== 'driver') return;

      items.push({
        id: `loc-driver-${row.user_id}-${row.updated_at}`,
        icon: '🚕',
        message: `${getCachedName(row.user_id)} active on app (driver)`,
        source: 'native',
        created_at: row.updated_at,
        feedRole: 'driver',
      });
    });

    (ridesRes.data || []).forEach((ride) => {
      const riderName = ride.rider_id ? getCachedName(ride.rider_id) : 'Unknown';
      const status = String(ride.status || '').toLowerCase();
      const statusInfo = RIDE_STATUS_LABELS[status] || { icon: '📌', label: status || 'Updated' };

      const feedRole: FeedItem['feedRole'] = ['driver_assigned', 'driver_en_route', 'arrived'].includes(status) ? 'both' : 'rider';

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
        feedRole,
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

  const handleOfferExpired = useCallback((offerId: string) => {
    setActiveOffers((prev) => prev.filter((o) => o.id !== offerId));
  }, []);

  const removeOffersForRide = useCallback((rideId: string) => {
    setActiveOffers((prev) => prev.filter((o) => o.rideId !== rideId));
  }, []);

  useEffect(() => {
    if (!isAdmin) return;

    feedIdsRef.current.clear();
    setFeed([]);
    setActiveOffers([]);

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
          feedRole: 'rider',
        });

        void loadOnlineUsers();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rides' }, async (payload: any) => {
        const ride = payload.new;
        const oldRide = payload.old;

        if (ride.status === oldRide?.status) return;

        // If ride was accepted or cancelled, remove any active offer countdown
        if (['driver_assigned', 'cancelled', 'completed'].includes(ride.status)) {
          removeOffersForRide(ride.id);
        }

        const riderId = ride.rider_id as string | null;
        const driverId = ride.driver_id as string | null;
        if (riderId) await upsertProfileNames([riderId]);
        if (driverId) await upsertProfileNames([driverId]);

        const riderName = riderId ? getCachedName(riderId) : 'Unknown';
        const status = String(ride.status || '').toLowerCase();
        const statusInfo = RIDE_STATUS_LABELS[status] || { icon: '📌', label: status || 'Updated' };

        // If driver_assigned, show who accepted
        let message: string;
        if (status === 'driver_assigned' && driverId) {
          const driverName = getCachedName(driverId);
          message = `${driverName} accepted ${riderName}'s ride — ${ride.pickup_address || '?'} → ${ride.dropoff_address || '?'}`;
        } else if (BOOKING_SUCCESS_STATUSES.has(status)) {
          message = `${riderName}: Booking Successful`;
        } else {
          message = `${riderName}: ${statusInfo.label} — ${ride.pickup_address || '?'} → ${ride.dropoff_address || '?'}`;
        }

        const feedRole: FeedItem['feedRole'] = ['driver_assigned', 'driver_en_route', 'arrived', 'completed', 'cancelled'].includes(status) ? 'both' : 'rider';

        pushFeedItem({
          id: `ride-${ride.id}-${status}`,
          icon: statusInfo.icon,
          message,
          source: 'rides',
          created_at: ride.updated_at || new Date().toISOString(),
          feedRole,
        });

        void loadOnlineUsers();
      })
      .subscribe();

    // Subscribe to notifications for new_ride to detect ride offers sent to drivers
    const notifCh = supabase
      .channel('admin-ride-offers')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: 'type=eq.new_ride' }, async (payload: any) => {
        const notif = payload.new;
        const driverUserId = notif.user_id as string;
        const rideId = notif.ride_id as string | null;
        if (!rideId) return;

        // Fetch ride details to get rider name and route
        const { data: ride } = await supabase
          .from('rides')
          .select('rider_id, pickup_address, dropoff_address, estimated_fare')
          .eq('id', rideId)
          .maybeSingle();

        const riderId = ride?.rider_id as string | null;
        const idsToResolve = [driverUserId];
        if (riderId) idsToResolve.push(riderId);
        await upsertProfileNames(idsToResolve);

        const driverName = getCachedName(driverUserId);
        const riderName = riderId ? getCachedName(riderId) : 'Unknown';

        const offer: ActiveRideOffer = {
          id: notif.id,
          rideId,
          driverUserId,
          driverName,
          riderName,
          pickupAddress: ride?.pickup_address || '?',
          dropoffAddress: ride?.dropoff_address || '?',
          estimatedFare: Number(ride?.estimated_fare || 0),
          sentAt: new Date(notif.created_at || Date.now()).getTime(),
        };

        setActiveOffers((prev) => {
          // Don't duplicate
          if (prev.some((o) => o.id === offer.id)) return prev;
          return [offer, ...prev];
        });

        pushFeedItem({
          id: `offer-${notif.id}`,
          icon: '🔔',
          message: `${driverName} received a ride request from ${riderName}`,
          source: 'dispatch',
          created_at: notif.created_at || new Date().toISOString(),
          feedRole: 'driver',
        });
      })
      .subscribe();

    const riderLocCh = supabase
      .channel('admin-rider-locs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rider_locations' }, async (payload: any) => {
        const row = payload.new as RiderLocationRow | undefined;
        if (row?.user_id) {
          const role = await resolveRoleByUserId(row.user_id);
          if (role === 'rider') {
            const seenAt = row.last_seen_at || row.updated_at || new Date().toISOString();
            void maybePushLocationFeed('rider', row.user_id, seenAt);
          }
        }
        void loadOnlineUsers();
      })
      .subscribe();

    const driverLocCh = supabase
      .channel('admin-driver-locs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_locations' }, async (payload: any) => {
        const row = payload.new as DriverLocationRow | undefined;
        if (row?.user_id) {
          const role = await resolveRoleByUserId(row.user_id);
          if (role === 'driver') {
            const seenAt = row.updated_at || new Date().toISOString();
            void maybePushLocationFeed('driver', row.user_id, seenAt);
          }
        }
        void loadOnlineUsers();
      })
      .subscribe();

    const poll = setInterval(loadOnlineUsers, 15_000);

    // Polling fallback: catch ride status changes that realtime may silently miss
    const lastPollTsRef = { current: new Date().toISOString() };
    const ridePoll = setInterval(async () => {
      const since = lastPollTsRef.current;
      lastPollTsRef.current = new Date().toISOString();
      try {
        const { data: recentRides } = await supabase
          .from('rides')
          .select('id, rider_id, driver_id, status, pickup_address, dropoff_address, estimated_fare, updated_at, created_at')
          .gte('updated_at', since)
          .order('updated_at', { ascending: false })
          .limit(20);

        if (!recentRides?.length) return;

        for (const ride of recentRides) {
          const status = String(ride.status || '').toLowerCase();
          const feedId = `ride-${ride.id}-${status}`;

          // Skip if we already have this exact status update in the feed
          if (feedIdsRef.current.has(feedId)) continue;

          const riderId = ride.rider_id as string | null;
          const driverId = ride.driver_id as string | null;
          if (riderId) await upsertProfileNames([riderId]);
          if (driverId) await upsertProfileNames([driverId]);

          const riderName = riderId ? getCachedName(riderId) : 'Unknown';
          const statusInfo = RIDE_STATUS_LABELS[status] || { icon: '📌', label: status || 'Updated' };

          let message: string;
          if (status === 'driver_assigned' && driverId) {
            const driverName = getCachedName(driverId);
            message = `${driverName} accepted ${riderName}'s ride — ${ride.pickup_address || '?'} → ${ride.dropoff_address || '?'}`;
          } else if (BOOKING_SUCCESS_STATUSES.has(status)) {
            message = `${riderName}: Booking Successful`;
          } else {
            message = `${riderName}: ${statusInfo.label} — ${ride.pickup_address || '?'} → ${ride.dropoff_address || '?'}`;
          }

          const feedRole: FeedItem['feedRole'] = ['driver_assigned', 'driver_en_route', 'arrived', 'completed', 'cancelled'].includes(status) ? 'both' : 'rider';

          // Remove active offers for cancelled/completed/assigned rides
          if (['driver_assigned', 'cancelled', 'completed'].includes(status)) {
            removeOffersForRide(ride.id);
          }

          pushFeedItem({
            id: feedId,
            icon: statusInfo.icon,
            message,
            source: 'rides',
            created_at: ride.updated_at || new Date().toISOString(),
            feedRole,
          });
        }
      } catch (err) {
        console.error('LiveMonitor: ride poll fallback error', err);
      }
    }, 10_000);

    return () => {
      clearInterval(poll);
      clearInterval(ridePoll);
      supabase.removeChannel(ridesCh);
      supabase.removeChannel(notifCh);
      supabase.removeChannel(riderLocCh);
      supabase.removeChannel(driverLocCh);
    };
  }, [getCachedName, isAdmin, loadInitialFeed, loadOnlineUsers, maybePushLocationFeed, pushFeedItem, removeOffersForRide, resolveRoleByUserId, upsertProfileNames]);

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

  // Rider presence breakdown
  const ridersOnHome = riderPresence.filter((r) => r.current_screen === 'home');
  const ridersSearching = riderPresence.filter((r) => r.current_screen === 'searching');
  const ridersBooking = riderPresence.filter((r) => r.current_screen === 'booking');

  const screenIcon = (screen: string) => {
    if (screen === 'searching') return <Search className="h-3.5 w-3.5 text-yellow-500" />;
    if (screen === 'booking') return <ShoppingCart className="h-3.5 w-3.5 text-green-500" />;
    return <Home className="h-3.5 w-3.5 text-blue-500" />;
  };
  const screenLabel = (screen: string) => {
    if (screen === 'searching') return 'Searching';
    if (screen === 'booking') return 'Booking';
    return 'Home';
  };

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

        {/* Rider Presence Breakdown */}
        <div className="grid grid-cols-3 gap-4">
          <Card className="p-4 flex items-center gap-3 border-blue-500/30">
            <Home className="h-6 w-6 text-blue-500" />
            <div>
              <div className="text-2xl font-bold">{ridersOnHome.length}</div>
              <div className="text-xs text-muted-foreground">On Home</div>
            </div>
          </Card>
          <Card className="p-4 flex items-center gap-3 border-yellow-500/30">
            <Search className="h-6 w-6 text-yellow-500" />
            <div>
              <div className="text-2xl font-bold">{ridersSearching.length}</div>
              <div className="text-xs text-muted-foreground">Searching</div>
            </div>
          </Card>
          <Card className="p-4 flex items-center gap-3 border-green-500/30">
            <ShoppingCart className="h-6 w-6 text-green-500" />
            <div>
              <div className="text-2xl font-bold">{ridersBooking.length}</div>
              <div className="text-xs text-muted-foreground">Booking</div>
            </div>
          </Card>
        </div>

        {/* Rider Presence Detail List */}
        {riderPresence.length > 0 && (
          <Card className="p-4">
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              Rider Presence (Real-Time)
              <Badge variant="secondary" className="ml-auto">{riderPresence.length}</Badge>
            </h2>
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {riderPresence
                .sort((a, b) => new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime())
                .map((r) => (
                  <div key={r.user_id} className="flex items-center justify-between p-2 rounded-lg border border-border">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-green-500 animate-pulse" />
                      <span className="text-sm font-medium truncate max-w-[140px]">
                        {r.display_name || r.user_id.slice(0, 8)}
                      </span>
                      <Badge variant="outline" className="text-xs flex items-center gap-1">
                        {screenIcon(r.current_screen)}
                        {screenLabel(r.current_screen)}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">{timeAgo(r.last_seen)}</span>
                  </div>
                ))}
            </div>
          </Card>
        )}

        <div className="grid md:grid-cols-2 gap-6">
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
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
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
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
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
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <Card className="p-4">
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              Riders Live Activity Feed
              <Badge variant="secondary" className="ml-auto">
                {feed.filter((e) => e.feedRole === 'rider' || e.feedRole === 'both').length}
              </Badge>
            </h2>
            {loading ? (
              <div className="animate-pulse text-muted-foreground text-sm">Loading…</div>
            ) : feed.filter((e) => e.feedRole === 'rider' || e.feedRole === 'both').length === 0 ? (
              <div className="text-muted-foreground text-sm">No rider events yet</div>
            ) : (
              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                {feed
                  .filter((e) => e.feedRole === 'rider' || e.feedRole === 'both')
                  .map((e) => (
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

          <Card className="p-4">
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Car className="h-5 w-5 text-primary" />
              Drivers Live Activity Feed
              <Badge variant="secondary" className="ml-auto">
                {feed.filter((e) => e.feedRole === 'driver' || e.feedRole === 'both').length}
              </Badge>
            </h2>

            {activeOffers.length > 0 && (
              <div className="space-y-2 mb-4">
                {activeOffers.map((offer) => (
                  <RideOfferCountdown key={offer.id} offer={offer} onExpired={handleOfferExpired} />
                ))}
              </div>
            )}

            {loading ? (
              <div className="animate-pulse text-muted-foreground text-sm">Loading…</div>
            ) : feed.filter((e) => e.feedRole === 'driver' || e.feedRole === 'both').length === 0 && activeOffers.length === 0 ? (
              <div className="text-muted-foreground text-sm">No driver events yet</div>
            ) : (
              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                {feed
                  .filter((e) => e.feedRole === 'driver' || e.feedRole === 'both')
                  .map((e) => (
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
