import React, { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { User, Car, WifiOff, Clock, Radio, Activity, Navigation, Circle } from 'lucide-react';

interface RiderEntry {
  user_id: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  is_online: boolean;
  last_seen_at: string | null;
  has_active_ride?: boolean;
}

interface DriverEntry {
  user_id: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  is_online: boolean;
  updated_at?: string;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  license_plate?: string | null;
}

interface FeedEntry {
  id: string;
  message: string;
  timestamp: string;
  type: 'ride_request' | 'ride_update' | 'status' | 'system';
}

const ONLINE_THRESHOLD_MS = 5 * 60 * 1000;
let feedIdCounter = 0;

function isRecentlyActive(lastSeen: string | null): boolean {
  if (!lastSeen) return false;
  return (Date.now() - new Date(lastSeen).getTime()) < ONLINE_THRESHOLD_MS;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'N/A';
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function nameOf(entry: { first_name?: string | null; last_name?: string | null; email?: string | null }): string {
  if (entry.first_name || entry.last_name) {
    return [entry.first_name, entry.last_name].filter(Boolean).join(' ');
  }
  return entry.email || 'Unknown';
}

const MSNDispatchPanel: React.FC = () => {
  const [riders, setRiders] = useState<RiderEntry[]>([]);
  const [drivers, setDrivers] = useState<DriverEntry[]>([]);
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const feedRef = useRef<FeedEntry[]>([]);
  const profileCacheRef = useRef<Map<string, { first_name?: string | null; last_name?: string | null; email?: string | null }>>(new Map());

  const pushFeed = useCallback((type: FeedEntry['type'], message: string) => {
    const entry: FeedEntry = {
      id: `feed-${Date.now()}-${++feedIdCounter}`,
      message,
      timestamp: new Date().toISOString(),
      type,
    };
    feedRef.current = [entry, ...feedRef.current].slice(0, 80);
    setFeed([...feedRef.current]);
  }, []);

  const resolveProfile = useCallback(async (userId: string) => {
    if (profileCacheRef.current.has(userId)) return profileCacheRef.current.get(userId)!;
    const { data } = await supabase.from('profiles').select('first_name, last_name, email').eq('user_id', userId).maybeSingle();
    if (data) profileCacheRef.current.set(userId, data);
    return data || { email: userId.slice(0, 8) };
  }, []);

  // Fetch ALL riders from user_roles + their location status
  const fetchRiders = useCallback(async () => {
    const { data: riderRoles } = await supabase.from('user_roles').select('user_id').eq('role', 'rider');
    if (!riderRoles?.length) { setRiders([]); return; }

    const ids = riderRoles.map(r => r.user_id);
    const [profilesRes, locationsRes, ridesRes] = await Promise.all([
      supabase.from('profiles').select('user_id, first_name, last_name, email').in('user_id', ids),
      supabase.from('rider_locations').select('user_id, is_online, last_seen_at').in('user_id', ids),
      supabase.from('rides').select('rider_id').in('status', ['searching', 'pending_payment', 'driver_assigned', 'driver_en_route', 'arrived', 'in_progress']),
    ]);

    const locMap = new Map((locationsRes.data ?? []).map(l => [l.user_id, l]));
    const activeRiderIds = new Set((ridesRes.data ?? []).map(r => r.rider_id).filter(Boolean) as string[]);

    const result: RiderEntry[] = (profilesRes.data ?? []).map(p => {
      const loc = locMap.get(p.user_id);
      profileCacheRef.current.set(p.user_id, p);
      return {
        user_id: p.user_id,
        first_name: p.first_name,
        last_name: p.last_name,
        email: p.email,
        is_online: loc?.is_online ?? false,
        last_seen_at: loc?.last_seen_at ?? null,
        has_active_ride: activeRiderIds.has(p.user_id),
      };
    });

    // Sort: online/active first, then by last_seen
    result.sort((a, b) => {
      const aActive = a.is_online || a.has_active_ride || isRecentlyActive(a.last_seen_at);
      const bActive = b.is_online || b.has_active_ride || isRecentlyActive(b.last_seen_at);
      if (aActive && !bActive) return -1;
      if (!aActive && bActive) return 1;
      return 0;
    });

    setRiders(result);
  }, []);

  // Fetch ALL drivers from user_roles + their profile status
  const fetchDrivers = useCallback(async () => {
    const { data: driverRoles } = await supabase.from('user_roles').select('user_id').eq('role', 'driver');
    if (!driverRoles?.length) { setDrivers([]); return; }

    const ids = driverRoles.map(r => r.user_id);
    const [profilesRes, driverProfilesRes] = await Promise.all([
      supabase.from('profiles').select('user_id, first_name, last_name, email').in('user_id', ids),
      supabase.from('driver_profiles').select('user_id, is_online, updated_at, vehicle_make, vehicle_model, license_plate').in('user_id', ids),
    ]);

    const dpMap = new Map((driverProfilesRes.data ?? []).map(d => [d.user_id, d]));

    const result: DriverEntry[] = (profilesRes.data ?? []).map(p => {
      const dp = dpMap.get(p.user_id);
      profileCacheRef.current.set(p.user_id, p);
      return {
        user_id: p.user_id,
        first_name: p.first_name,
        last_name: p.last_name,
        email: p.email,
        is_online: dp?.is_online ?? false,
        updated_at: dp?.updated_at,
        vehicle_make: dp?.vehicle_make,
        vehicle_model: dp?.vehicle_model,
        license_plate: dp?.license_plate,
      };
    });

    // Online first
    result.sort((a, b) => (a.is_online === b.is_online ? 0 : a.is_online ? -1 : 1));
    setDrivers(result);
  }, []);

  // Load recent rides into feed
  const fetchRecentRides = useCallback(async () => {
    const { data: recentRides } = await supabase
      .from('rides')
      .select('id, rider_id, driver_id, status, pickup_address, dropoff_address, estimated_fare, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(15);

    if (!recentRides?.length) return;

    const riderIds = [...new Set(recentRides.map(r => r.rider_id).filter(Boolean) as string[])];
    if (riderIds.length > 0) {
      const { data: profiles } = await supabase.from('profiles').select('user_id, first_name, last_name, email').in('user_id', riderIds);
      profiles?.forEach(p => profileCacheRef.current.set(p.user_id, p));
    }

    const entries: FeedEntry[] = recentRides.map(ride => {
      const p = ride.rider_id ? profileCacheRef.current.get(ride.rider_id) : null;
      const email = p?.email || 'Unknown';
      const fare = ride.estimated_fare ? ` · $${Number(ride.estimated_fare).toFixed(2)}` : '';
      const statusLabel =
        ride.status === 'searching' ? 'has requested a ride' :
        ride.status === 'pending_payment' ? 'pending payment' :
        ride.status === 'completed' ? 'ride completed' :
        ride.status === 'cancelled' ? 'ride cancelled' :
        ride.status === 'driver_assigned' ? 'driver assigned' :
        ride.status === 'in_progress' ? 'ride in progress' :
        `ride ${ride.status.replace(/_/g, ' ')}`;

      return {
        id: ride.id,
        message: `${email} ${statusLabel}${fare} — ${ride.pickup_address} → ${ride.dropoff_address}`,
        timestamp: ride.updated_at || ride.created_at,
        type: ride.status === 'searching' ? 'ride_request' as const : 'ride_update' as const,
      };
    });
    feedRef.current = entries;
    setFeed(entries);
  }, []);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([fetchRiders(), fetchDrivers(), fetchRecentRides()]);
      setLoading(false);
    };
    init();

    // Realtime: rider locations (online status changes + guest fallback)
    const riderChannel = supabase
      .channel('msn-rider-locs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rider_locations' }, async (payload) => {
        const row = payload.new as any;
        if (!row?.user_id) return;

        setRiders(prev => {
          const exists = prev.some(r => r.user_id === row.user_id);
          if (exists) {
            return prev.map(r =>
              r.user_id === row.user_id
                ? { ...r, is_online: row.is_online ?? r.is_online, last_seen_at: row.last_seen_at ?? r.last_seen_at }
                : r
            );
          }
          // Fallback: user not in list yet — add as Guest/Active
          return [{
            user_id: row.user_id,
            first_name: 'Guest',
            last_name: 'Active',
            email: null,
            is_online: row.is_online ?? true,
            last_seen_at: row.last_seen_at ?? new Date().toISOString(),
            has_active_ride: false,
          }, ...prev];
        });

        // Resolve profile for guest entries and push feed
        if (row.is_online) {
          const p = await resolveProfile(row.user_id);
          const label = p?.email || `${p?.first_name || ''} ${p?.last_name || ''}`.trim() || row.user_id.slice(0, 8);
          pushFeed('status', `📱 ${label} is now online`);
          // Update guest entry with real profile data
          setRiders(prev => prev.map(r =>
            r.user_id === row.user_id && r.first_name === 'Guest'
              ? { ...r, first_name: p?.first_name ?? null, last_name: p?.last_name ?? null, email: p?.email ?? null }
              : r
          ));
        }
      })
      .subscribe();

    // Realtime: driver profiles (online status)
    const driverChannel = supabase
      .channel('msn-driver-profiles')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_profiles' }, (payload) => {
        const row = payload.new as any;
        if (row?.user_id) {
          setDrivers(prev => prev.map(d =>
            d.user_id === row.user_id
              ? { ...d, is_online: row.is_online ?? d.is_online, updated_at: row.updated_at ?? d.updated_at }
              : d
          ));
        }
      })
      .subscribe();

    // Realtime: rides (feed + rider list refresh)
    const ridesChannel = supabase
      .channel('msn-rides-feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'rides' }, async (payload) => {
        const ride = payload.new as any;
        const p = ride.rider_id ? await resolveProfile(ride.rider_id) : null;
        const email = p?.email || nameOf(p || {});
        const fare = ride.estimated_fare ? ` · $${Number(ride.estimated_fare).toFixed(2)}` : '';
        pushFeed('ride_request', `🚗 ${email} has requested a ride${fare} — ${ride.pickup_address} → ${ride.dropoff_address}`);
        fetchRiders();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rides' }, async (payload) => {
        const ride = payload.new as any;
        const old = payload.old as any;
        if (ride.status !== old?.status) {
          const p = ride.rider_id ? await resolveProfile(ride.rider_id) : null;
          const email = p?.email || nameOf(p || {});
          const icon =
            ride.status === 'completed' ? '✅' :
            ride.status === 'cancelled' ? '❌' :
            ride.status === 'driver_assigned' ? '🟢' :
            ride.status === 'in_progress' ? '🏎️' :
            ride.status === 'arrived' ? '📍' : '🔄';
          const label =
            ride.status === 'completed' ? 'ride completed' :
            ride.status === 'cancelled' ? 'ride cancelled' :
            ride.status === 'driver_assigned' ? 'driver assigned' :
            ride.status === 'in_progress' ? 'ride in progress' :
            ride.status === 'arrived' ? 'driver arrived' :
            `ride ${ride.status.replace(/_/g, ' ')}`;
          pushFeed('ride_update', `${icon} ${email} — ${label} — ${ride.pickup_address} → ${ride.dropoff_address}`);
          fetchRiders();
        }
      })
      .subscribe();

    // Polling fallback every 10s
    const interval = setInterval(() => {
      fetchRiders();
      fetchDrivers();
    }, 10000);

    return () => {
      supabase.removeChannel(riderChannel);
      supabase.removeChannel(driverChannel);
      supabase.removeChannel(ridesChannel);
      clearInterval(interval);
    };
  }, [fetchRiders, fetchDrivers, fetchRecentRides, resolveProfile, pushFeed]);

  const onlineRiders = riders.filter(r => r.is_online || r.has_active_ride || isRecentlyActive(r.last_seen_at));
  const offlineRiders = riders.filter(r => !r.is_online && !r.has_active_ride && !isRecentlyActive(r.last_seen_at));
  const onlineDrivers = drivers.filter(d => d.is_online);
  const offlineDrivers = drivers.filter(d => !d.is_online);

  return (
    <div className="rounded-xl border-2 border-neutral-800 bg-neutral-950 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-800 bg-neutral-900">
        <div className="flex items-center gap-2">
          <Radio className="w-5 h-5 text-white" />
          <span className="text-white font-bold text-lg tracking-wider uppercase">MSN Dispatch</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-neutral-500 text-xs font-mono">
            {onlineRiders.length}R · {onlineDrivers.length}D
          </span>
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
            </span>
            <span className="text-neutral-400 text-xs font-mono">LIVE</span>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Activity className="w-6 h-6 text-neutral-500 animate-spin" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-neutral-800">
            {/* Riders Column */}
            <div>
              <div className="flex items-center justify-between px-4 py-2.5 bg-neutral-900/50 border-b border-neutral-800">
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-neutral-300" />
                  <span className="text-neutral-200 font-semibold text-sm uppercase tracking-wide">Riders</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="bg-green-950 text-green-400 border-green-800 text-xs font-mono">
                    {onlineRiders.length} online
                  </Badge>
                  <Badge variant="outline" className="bg-neutral-800 text-neutral-400 border-neutral-700 text-xs font-mono">
                    {riders.length} total
                  </Badge>
                </div>
              </div>
              <ScrollArea className="h-[220px]">
                {riders.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-neutral-600">
                    <WifiOff className="w-8 h-8 mb-2" />
                    <span className="text-xs">No riders registered</span>
                  </div>
                ) : (
                  <div className="divide-y divide-neutral-800/60">
                    {/* Online riders first */}
                    {onlineRiders.map(r => (
                      <div key={r.user_id} className="flex items-center justify-between px-4 py-2.5 hover:bg-neutral-900/80 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="relative">
                            <div className="w-8 h-8 rounded-full bg-neutral-800 flex items-center justify-center">
                              <User className="w-4 h-4 text-neutral-300" />
                            </div>
                            <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-neutral-950" />
                          </div>
                          <div>
                            <p className="text-sm text-white font-medium leading-tight">{nameOf(r)}</p>
                            <p className="text-[11px] text-neutral-500 font-mono">
                              {r.email || 'Rider'}
                              {r.has_active_ride && <span className="ml-1 text-green-400">● Ride Active</span>}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 text-neutral-500">
                          <Clock className="w-3 h-3" />
                          <span className="text-[11px] font-mono">{timeAgo(r.last_seen_at)}</span>
                        </div>
                      </div>
                    ))}
                    {/* Offline riders */}
                    {offlineRiders.map(r => (
                      <div key={r.user_id} className="flex items-center justify-between px-4 py-2 hover:bg-neutral-900/80 transition-colors opacity-40">
                        <div className="flex items-center gap-3">
                          <div className="relative">
                            <div className="w-7 h-7 rounded-full bg-neutral-800/60 flex items-center justify-center">
                              <User className="w-3.5 h-3.5 text-neutral-500" />
                            </div>
                          </div>
                          <div>
                            <p className="text-xs text-neutral-400 font-medium">{nameOf(r)}</p>
                            <p className="text-[10px] text-neutral-600 font-mono">{r.email || 'Offline'}</p>
                          </div>
                        </div>
                        <span className="text-[10px] text-neutral-600 font-mono">{timeAgo(r.last_seen_at)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>

            {/* Drivers Column */}
            <div>
              <div className="flex items-center justify-between px-4 py-2.5 bg-neutral-900/50 border-b border-neutral-800">
                <div className="flex items-center gap-2">
                  <Car className="w-4 h-4 text-neutral-300" />
                  <span className="text-neutral-200 font-semibold text-sm uppercase tracking-wide">Drivers</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="bg-green-950 text-green-400 border-green-800 text-xs font-mono">
                    {onlineDrivers.length} online
                  </Badge>
                  <Badge variant="outline" className="bg-neutral-800 text-neutral-400 border-neutral-700 text-xs font-mono">
                    {drivers.length} total
                  </Badge>
                </div>
              </div>
              <ScrollArea className="h-[220px]">
                {drivers.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-neutral-600">
                    <WifiOff className="w-8 h-8 mb-2" />
                    <span className="text-xs">No drivers registered</span>
                  </div>
                ) : (
                  <div className="divide-y divide-neutral-800/60">
                    {onlineDrivers.map(d => (
                      <div key={d.user_id} className="flex items-center justify-between px-4 py-2.5 hover:bg-neutral-900/80 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="relative">
                            <div className="w-8 h-8 rounded-full bg-neutral-800 flex items-center justify-center">
                              <Car className="w-4 h-4 text-neutral-300" />
                            </div>
                            <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-neutral-950" />
                          </div>
                          <div>
                            <p className="text-sm text-white font-medium leading-tight">{nameOf(d)}</p>
                            <p className="text-[11px] text-neutral-500 font-mono">
                              {d.email || ([d.vehicle_make, d.vehicle_model].filter(Boolean).join(' ') || 'Driver')}
                              {d.license_plate ? ` · ${d.license_plate}` : ''}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 text-neutral-500">
                          <Clock className="w-3 h-3" />
                          <span className="text-[11px] font-mono">{timeAgo(d.updated_at || null)}</span>
                        </div>
                      </div>
                    ))}
                    {offlineDrivers.map(d => (
                      <div key={d.user_id} className="flex items-center justify-between px-4 py-2 hover:bg-neutral-900/80 transition-colors opacity-40">
                        <div className="flex items-center gap-3">
                          <div className="relative">
                            <div className="w-7 h-7 rounded-full bg-neutral-800/60 flex items-center justify-center">
                              <Car className="w-3.5 h-3.5 text-neutral-500" />
                            </div>
                          </div>
                          <div>
                            <p className="text-xs text-neutral-400 font-medium">{nameOf(d)}</p>
                            <p className="text-[10px] text-neutral-600 font-mono">{d.email || 'Offline'}</p>
                          </div>
                        </div>
                        <span className="text-[10px] text-neutral-600 font-mono">offline</span>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>
          </div>

          {/* Live Feed */}
          <div className="border-t border-neutral-800">
            <div className="flex items-center justify-between px-4 py-2 bg-neutral-900/50 border-b border-neutral-800">
              <div className="flex items-center gap-2">
                <Navigation className="w-4 h-4 text-neutral-300" />
                <span className="text-neutral-200 font-semibold text-sm uppercase tracking-wide">Live Feed</span>
              </div>
              <Badge variant="outline" className="bg-neutral-800 text-white border-neutral-700 text-xs font-mono">
                {feed.length}
              </Badge>
            </div>
            <ScrollArea className="h-[180px]">
              {feed.length === 0 ? (
                <div className="flex items-center justify-center py-8 text-neutral-600 text-xs">No activity yet</div>
              ) : (
                <div className="divide-y divide-neutral-800/40">
                  {feed.map(f => (
                    <div key={f.id} className="flex items-start gap-3 px-4 py-2.5 hover:bg-neutral-900/60 transition-colors">
                      <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${
                        f.type === 'ride_request' ? 'bg-blue-400' :
                        f.type === 'ride_update' ? 'bg-yellow-400' :
                        f.type === 'status' ? 'bg-green-400' :
                        'bg-neutral-500'
                      }`} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-neutral-200 leading-snug break-words">{f.message}</p>
                        <p className="text-[10px] text-neutral-600 font-mono mt-0.5">{timeAgo(f.timestamp)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </>
      )}
    </div>
  );
};

export default MSNDispatchPanel;
