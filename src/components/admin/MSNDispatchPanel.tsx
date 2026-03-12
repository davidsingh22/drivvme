import React, { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { User, Car, WifiOff, Clock, Radio, Activity, Navigation } from 'lucide-react';

interface OnlineRider {
  user_id: string;
  lat: number;
  lng: number;
  is_online: boolean;
  last_seen_at: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  has_active_ride?: boolean;
}

interface OnlineDriver {
  user_id: string;
  lat: number;
  lng: number;
  is_online: boolean;
  updated_at: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  license_plate?: string | null;
}

interface FeedEntry {
  id: string;
  message: string;
  timestamp: string;
  type: 'ride_request' | 'ride_update' | 'rider_online' | 'driver_online';
}

const STALE_MINUTES = 5;
let feedIdCounter = 0;

function isActive(lastSeen: string): boolean {
  return (Date.now() - new Date(lastSeen).getTime()) < STALE_MINUTES * 60 * 1000;
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function displayName(entry: { first_name?: string | null; last_name?: string | null; email?: string | null }): string {
  if (entry.first_name || entry.last_name) {
    return [entry.first_name, entry.last_name].filter(Boolean).join(' ');
  }
  return entry.email || 'Unknown';
}

function displayEmail(entry: { email?: string | null }): string {
  return entry.email || '';
}

const MSNDispatchPanel: React.FC = () => {
  const [riders, setRiders] = useState<OnlineRider[]>([]);
  const [drivers, setDrivers] = useState<OnlineDriver[]>([]);
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
    feedRef.current = [entry, ...feedRef.current].slice(0, 50);
    setFeed([...feedRef.current]);
  }, []);

  const resolveProfile = useCallback(async (userId: string) => {
    if (profileCacheRef.current.has(userId)) return profileCacheRef.current.get(userId)!;
    const { data } = await supabase.from('profiles').select('first_name, last_name, email').eq('user_id', userId).maybeSingle();
    if (data) profileCacheRef.current.set(userId, data);
    return data || { email: userId };
  }, []);

  const fetchRiders = useCallback(async () => {
    // Get riders from rider_locations (online + active)
    const { data: locs } = await supabase
      .from('rider_locations')
      .select('user_id, lat, lng, is_online, last_seen_at')
      .eq('is_online', true);

    // Also get riders with active rides (they should always show)
    const { data: activeRides } = await supabase
      .from('rides')
      .select('rider_id')
      .in('status', ['searching', 'pending_payment', 'driver_assigned', 'driver_en_route', 'arrived', 'in_progress']);

    const activeRiderIds = new Set((activeRides || []).map(r => r.rider_id).filter(Boolean) as string[]);

    // Combine: riders from locations + riders with active rides
    const locMap = new Map((locs || []).map(l => [l.user_id, l]));
    
    // Add active ride riders that aren't in locMap
    for (const riderId of activeRiderIds) {
      if (!locMap.has(riderId)) {
        locMap.set(riderId, {
          user_id: riderId,
          lat: 0,
          lng: 0,
          is_online: true,
          last_seen_at: new Date().toISOString(),
        });
      }
    }

    const allUserIds = Array.from(locMap.keys());
    if (allUserIds.length === 0) { setRiders([]); return; }

    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, first_name, last_name, email')
      .in('user_id', allUserIds);

    const profileMap = new Map((profiles || []).map(p => [p.user_id, p]));
    profiles?.forEach(p => profileCacheRef.current.set(p.user_id, p));

    const result: OnlineRider[] = [];
    for (const [userId, loc] of locMap) {
      // Show if active ride OR if location is fresh
      if (activeRiderIds.has(userId) || isActive(loc.last_seen_at)) {
        const p = profileMap.get(userId);
        result.push({
          ...loc,
          first_name: p?.first_name,
          last_name: p?.last_name,
          email: p?.email,
          has_active_ride: activeRiderIds.has(userId),
        });
      }
    }
    setRiders(result);
  }, []);

  const fetchDrivers = useCallback(async () => {
    const { data: driverProfiles } = await supabase
      .from('driver_profiles')
      .select('user_id, current_lat, current_lng, is_online, updated_at, vehicle_make, vehicle_model, license_plate');

    if (!driverProfiles || driverProfiles.length === 0) { setDrivers([]); return; }

    const onlineDrivers = driverProfiles.filter(d => d.is_online);
    const userIds = onlineDrivers.map(d => d.user_id);
    const { data: profiles } = userIds.length > 0
      ? await supabase.from('profiles').select('user_id, first_name, last_name, email').in('user_id', userIds)
      : { data: [] };

    const profileMap = new Map((profiles || []).map(p => [p.user_id, p]));
    profiles?.forEach(p => profileCacheRef.current.set(p.user_id, p));

    setDrivers(onlineDrivers.map(d => {
      const p = profileMap.get(d.user_id);
      return {
        user_id: d.user_id,
        lat: d.current_lat || 0,
        lng: d.current_lng || 0,
        is_online: d.is_online,
        updated_at: d.updated_at,
        first_name: p?.first_name,
        last_name: p?.last_name,
        email: p?.email,
        vehicle_make: d.vehicle_make,
        vehicle_model: d.vehicle_model,
        license_plate: d.license_plate,
      };
    }));
  }, []);

  // Load initial feed from recent rides
  const fetchRecentRides = useCallback(async () => {
    const { data: recentRides } = await supabase
      .from('rides')
      .select('id, rider_id, status, pickup_address, dropoff_address, created_at')
      .order('created_at', { ascending: false })
      .limit(10);

    if (!recentRides) return;

    const riderIds = [...new Set(recentRides.map(r => r.rider_id).filter(Boolean) as string[])];
    const { data: profiles } = riderIds.length > 0
      ? await supabase.from('profiles').select('user_id, first_name, last_name, email').in('user_id', riderIds)
      : { data: [] };
    const profileMap = new Map((profiles || []).map(p => [p.user_id, p]));
    profiles?.forEach(p => profileCacheRef.current.set(p.user_id, p));

    const entries: FeedEntry[] = recentRides.map(ride => {
      const p = ride.rider_id ? profileMap.get(ride.rider_id) : null;
      const name = p ? (p.email || displayName(p)) : 'Unknown';
      const statusLabel = ride.status === 'searching' ? 'requested a ride' :
        ride.status === 'completed' ? 'ride completed' :
        ride.status === 'cancelled' ? 'ride cancelled' :
        `ride ${ride.status.replace(/_/g, ' ')}`;
      return {
        id: ride.id,
        message: `${name} ${statusLabel} — ${ride.pickup_address} → ${ride.dropoff_address}`,
        timestamp: ride.created_at,
        type: 'ride_request' as const,
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

    // Realtime subscriptions
    const riderChannel = supabase
      .channel('msn-rider-locs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rider_locations' }, () => {
        fetchRiders();
      })
      .subscribe();

    const driverChannel = supabase
      .channel('msn-driver-profiles')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_profiles' }, () => {
        fetchDrivers();
      })
      .subscribe();

    // Listen for new/updated rides to update feed + rider list
    const ridesChannel = supabase
      .channel('msn-rides-feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'rides' }, async (payload) => {
        const ride = payload.new as any;
        const p = ride.rider_id ? await resolveProfile(ride.rider_id) : null;
        const name = p?.email || (p ? displayName(p) : 'Unknown');
        pushFeed('ride_request', `${name} has requested a ride — ${ride.pickup_address} → ${ride.dropoff_address}`);
        fetchRiders(); // refresh rider list to show active ride riders
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rides' }, async (payload) => {
        const ride = payload.new as any;
        const old = payload.old as any;
        if (ride.status !== old.status) {
          const p = ride.rider_id ? await resolveProfile(ride.rider_id) : null;
          const name = p?.email || (p ? displayName(p) : 'Unknown');
          const label = ride.status === 'completed' ? 'ride completed' :
            ride.status === 'cancelled' ? 'ride cancelled' :
            ride.status === 'driver_assigned' ? 'driver assigned' :
            ride.status === 'in_progress' ? 'ride in progress' :
            `ride ${ride.status.replace(/_/g, ' ')}`;
          pushFeed('ride_update', `${name} — ${label}`);
          fetchRiders();
        }
      })
      .subscribe();

    // Refresh every 15s
    const interval = setInterval(() => {
      fetchRiders();
      fetchDrivers();
    }, 15000);

    return () => {
      supabase.removeChannel(riderChannel);
      supabase.removeChannel(driverChannel);
      supabase.removeChannel(ridesChannel);
      clearInterval(interval);
    };
  }, [fetchRiders, fetchDrivers, fetchRecentRides, resolveProfile, pushFeed]);

  return (
    <div className="rounded-xl border-2 border-neutral-800 bg-neutral-950 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-800 bg-neutral-900">
        <div className="flex items-center gap-2">
          <Radio className="w-5 h-5 text-white" />
          <span className="text-white font-bold text-lg tracking-wider uppercase">MSN Dispatch</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
          </span>
          <span className="text-neutral-400 text-xs font-mono">LIVE</span>
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
                  <span className="text-neutral-200 font-semibold text-sm uppercase tracking-wide">Online Riders</span>
                </div>
                <Badge variant="outline" className="bg-neutral-800 text-white border-neutral-700 text-xs font-mono">
                  {riders.length}
                </Badge>
              </div>
              <ScrollArea className="h-[220px]">
                {riders.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-neutral-600">
                    <WifiOff className="w-8 h-8 mb-2" />
                    <span className="text-xs">No riders online</span>
                  </div>
                ) : (
                  <div className="divide-y divide-neutral-800/60">
                    {riders.map(r => (
                      <div key={r.user_id} className="flex items-center justify-between px-4 py-2.5 hover:bg-neutral-900/80 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="relative">
                            <div className="w-8 h-8 rounded-full bg-neutral-800 flex items-center justify-center">
                              <User className="w-4 h-4 text-neutral-300" />
                            </div>
                            <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-neutral-950" />
                          </div>
                          <div>
                            <p className="text-sm text-white font-medium leading-tight">{displayName(r)}</p>
                            <p className="text-[11px] text-neutral-500 font-mono">
                              {displayEmail(r) && <span>{displayEmail(r)}</span>}
                              {r.has_active_ride && <span className="ml-1 text-green-400">● Active Ride</span>}
                              {!displayEmail(r) && !r.has_active_ride && 'Rider'}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 text-neutral-500">
                          <Clock className="w-3 h-3" />
                          <span className="text-[11px] font-mono">{timeAgo(r.last_seen_at)}</span>
                        </div>
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
                  <span className="text-neutral-200 font-semibold text-sm uppercase tracking-wide">Online Drivers</span>
                </div>
                <Badge variant="outline" className="bg-neutral-800 text-white border-neutral-700 text-xs font-mono">
                  {drivers.length}
                </Badge>
              </div>
              <ScrollArea className="h-[220px]">
                {drivers.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-neutral-600">
                    <WifiOff className="w-8 h-8 mb-2" />
                    <span className="text-xs">No drivers online</span>
                  </div>
                ) : (
                  <div className="divide-y divide-neutral-800/60">
                    {drivers.map(d => (
                      <div key={d.user_id} className="flex items-center justify-between px-4 py-2.5 hover:bg-neutral-900/80 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="relative">
                            <div className="w-8 h-8 rounded-full bg-neutral-800 flex items-center justify-center">
                              <Car className="w-4 h-4 text-neutral-300" />
                            </div>
                            <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-neutral-950" />
                          </div>
                          <div>
                            <p className="text-sm text-white font-medium leading-tight">{displayName(d)}</p>
                            <p className="text-[11px] text-neutral-500 font-mono">
                              {[d.vehicle_make, d.vehicle_model].filter(Boolean).join(' ') || 'Driver'}
                              {d.license_plate ? ` · ${d.license_plate}` : ''}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 text-neutral-500">
                          <Clock className="w-3 h-3" />
                          <span className="text-[11px] font-mono">{timeAgo(d.updated_at)}</span>
                        </div>
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
            <ScrollArea className="h-[160px]">
              {feed.length === 0 ? (
                <div className="flex items-center justify-center py-8 text-neutral-600 text-xs">No activity yet</div>
              ) : (
                <div className="divide-y divide-neutral-800/40">
                  {feed.map(f => (
                    <div key={f.id} className="flex items-start gap-3 px-4 py-2 hover:bg-neutral-900/60 transition-colors">
                      <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${
                        f.type === 'ride_request' ? 'bg-blue-400' :
                        f.type === 'ride_update' ? 'bg-yellow-400' :
                        'bg-green-400'
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
