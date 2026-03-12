import React, { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { User, Car, Wifi, WifiOff, Clock, Radio, Activity } from 'lucide-react';

interface OnlineRider {
  user_id: string;
  lat: number;
  lng: number;
  is_online: boolean;
  last_seen_at: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
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

const STALE_MINUTES = 5;

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

const MSNDispatchPanel: React.FC = () => {
  const [riders, setRiders] = useState<OnlineRider[]>([]);
  const [drivers, setDrivers] = useState<OnlineDriver[]>([]);
  const [loading, setLoading] = useState(true);
  const pulseRef = useRef(false);

  const fetchRiders = useCallback(async () => {
    const { data: locs } = await supabase
      .from('rider_locations')
      .select('user_id, lat, lng, is_online, last_seen_at')
      .eq('is_online', true);

    if (!locs || locs.length === 0) { setRiders([]); return; }

    const userIds = locs.map(l => l.user_id);
    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, first_name, last_name, email')
      .in('user_id', userIds);

    const profileMap = new Map((profiles || []).map(p => [p.user_id, p]));

    setRiders(locs.filter(l => isActive(l.last_seen_at)).map(l => {
      const p = profileMap.get(l.user_id);
      return { ...l, first_name: p?.first_name, last_name: p?.last_name, email: p?.email };
    }));
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

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([fetchRiders(), fetchDrivers()]);
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

    // Refresh every 15s
    const interval = setInterval(() => {
      fetchRiders();
      fetchDrivers();
      pulseRef.current = !pulseRef.current;
    }, 15000);

    return () => {
      supabase.removeChannel(riderChannel);
      supabase.removeChannel(driverChannel);
      clearInterval(interval);
    };
  }, [fetchRiders, fetchDrivers]);

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
            <ScrollArea className="h-[280px]">
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
                          <p className="text-[11px] text-neutral-500 font-mono">Rider</p>
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
            <ScrollArea className="h-[280px]">
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
      )}
    </div>
  );
};

export default MSNDispatchPanel;
