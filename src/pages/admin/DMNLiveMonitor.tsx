import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  ArrowLeft,
  Users,
  Car,
  Activity,
  Wifi,
  WifiOff,
  MapPin,
  Clock,
  Zap,
  Eye,
  CheckCircle,
  Search,
  CreditCard,
  Bell,
  Navigation,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────
interface OnlineRider {
  user_id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  last_seen_at: string;
  is_active: boolean; // heartbeat within 60s
}

interface OnlineDriver {
  user_id: string;
  name: string;
  is_online: boolean;
  lat: number | null;
  lng: number | null;
  updated_at: string;
}

interface FeedEntry {
  id: string;
  ts: Date;
  role: 'rider' | 'driver';
  icon: React.ReactNode;
  message: string;
  gps?: string;
}

interface Stats5m {
  totalOpens: number;
  confirmedRides: number;
}

// ── Helpers ────────────────────────────────────────────────────────
const ACTIVE_THRESHOLD_S = 60;

function ago(dateStr: string): string {
  const s = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function isActive(lastSeen: string): boolean {
  return (Date.now() - new Date(lastSeen).getTime()) / 1000 < ACTIVE_THRESHOLD_S;
}

function nameOf(p: { first_name?: string | null; last_name?: string | null; email?: string | null }): string {
  const n = [p.first_name, p.last_name].filter(Boolean).join(' ');
  return n || p.email?.split('@')[0] || 'Unknown';
}

function gpsLabel(lat: number | null, lng: number | null): string {
  if (lat == null || lng == null) return '';
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

let feedIdCounter = 0;
function nextFeedId(): string {
  return `f-${Date.now()}-${++feedIdCounter}`;
}

// Ping audio for toast
function playPing() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.value = 0.15;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
  } catch { /* silent */ }
}

// ── Component ──────────────────────────────────────────────────────
const DMNLiveMonitor: React.FC = () => {
  const { session, isAdmin } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [riders, setRiders] = useState<OnlineRider[]>([]);
  const [drivers, setDrivers] = useState<OnlineDriver[]>([]);
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [stats, setStats] = useState<Stats5m>({ totalOpens: 0, confirmedRides: 0 });

  const feedRef = useRef<HTMLDivElement>(null);
  const profileCache = useRef<Map<string, { first_name: string | null; last_name: string | null; email: string | null }>>(new Map());

  // ── Auth gate ────────────────────────────────────────────────────
  useEffect(() => {
    if (!session) navigate('/login', { replace: true });
    else if (!isAdmin) { navigate('/', { replace: true }); toast({ title: 'Access denied', variant: 'destructive' }); }
  }, [session, isAdmin, navigate, toast]);

  // ── Resolve name via profile cache ──────────────────────────────
  const resolveName = useCallback(async (userId: string): Promise<string> => {
    const cached = profileCache.current.get(userId);
    if (cached) return nameOf(cached);
    const { data } = await supabase.from('profiles').select('first_name, last_name, email').eq('user_id', userId).maybeSingle();
    if (data) { profileCache.current.set(userId, data); return nameOf(data); }
    return userId.slice(0, 8);
  }, []);

  // ── Push to feed (max 80 entries) ───────────────────────────────
  const pushFeed = useCallback((role: FeedEntry['role'], icon: React.ReactNode, message: string, gps?: string) => {
    setFeed(prev => [{ id: nextFeedId(), ts: new Date(), role, icon, message, gps }, ...prev].slice(0, 80));
  }, []);

  // ── Auto-scroll feed ────────────────────────────────────────────
  useEffect(() => {
    feedRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [feed.length]);

  // ── 5-minute stats window ───────────────────────────────────────
  const opensWindow = useRef<number[]>([]);
  const ridesWindow = useRef<number[]>([]);

  const recordOpen = useCallback(() => {
    const now = Date.now();
    opensWindow.current.push(now);
    opensWindow.current = opensWindow.current.filter(t => now - t < 300_000);
    setStats(s => ({ ...s, totalOpens: opensWindow.current.length }));
  }, []);

  const recordRide = useCallback(() => {
    const now = Date.now();
    ridesWindow.current.push(now);
    ridesWindow.current = ridesWindow.current.filter(t => now - t < 300_000);
    setStats(s => ({ ...s, confirmedRides: ridesWindow.current.length }));
  }, []);

  // ── Refresh 5m stats every 10s ──────────────────────────────────
  useEffect(() => {
    const iv = setInterval(() => {
      const now = Date.now();
      opensWindow.current = opensWindow.current.filter(t => now - t < 300_000);
      ridesWindow.current = ridesWindow.current.filter(t => now - t < 300_000);
      setStats({ totalOpens: opensWindow.current.length, confirmedRides: ridesWindow.current.length });
    }, 10_000);
    return () => clearInterval(iv);
  }, []);

  // ── Fetch initial riders ────────────────────────────────────────
  const fetchRiders = useCallback(async () => {
    const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: locs } = await supabase
      .from('rider_locations')
      .select('user_id, lat, lng, last_seen_at, is_online')
      .eq('is_online', true)
      .gte('last_seen_at', cutoff);

    if (!locs) return;
    const enriched: OnlineRider[] = await Promise.all(
      locs.map(async l => ({
        user_id: l.user_id,
        name: await resolveName(l.user_id),
        lat: l.lat,
        lng: l.lng,
        last_seen_at: l.last_seen_at,
        is_active: isActive(l.last_seen_at),
      }))
    );
    setRiders(enriched);
  }, [resolveName]);

  // ── Fetch initial drivers ───────────────────────────────────────
  const fetchDrivers = useCallback(async () => {
    const { data: dps } = await supabase
      .from('driver_profiles')
      .select('user_id, is_online, current_lat, current_lng, updated_at');

    if (!dps) return;
    const enriched: OnlineDriver[] = await Promise.all(
      dps
        .filter(d => d.is_online)
        .map(async d => ({
          user_id: d.user_id,
          name: await resolveName(d.user_id),
          is_online: d.is_online,
          lat: d.current_lat,
          lng: d.current_lng,
          updated_at: d.updated_at,
        }))
    );
    setDrivers(enriched);
  }, [resolveName]);

  // ── Initial load ────────────────────────────────────────────────
  useEffect(() => {
    if (!isAdmin) return;
    fetchRiders();
    fetchDrivers();
  }, [isAdmin, fetchRiders, fetchDrivers]);

  // ── Heartbeat: re-evaluate active/inactive every 20s ────────────
  useEffect(() => {
    const iv = setInterval(() => {
      setRiders(prev => prev.map(r => ({ ...r, is_active: isActive(r.last_seen_at) })));
    }, 20_000);
    return () => clearInterval(iv);
  }, []);

  // ── Realtime: rider_locations ───────────────────────────────────
  useEffect(() => {
    if (!isAdmin) return;
    const ch = supabase.channel('dmn-rider-locs').on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'rider_locations' },
      async (payload) => {
        const row = (payload.new as any);
        if (!row?.user_id) return;
        const name = await resolveName(row.user_id);
        const active = isActive(row.last_seen_at ?? new Date().toISOString());

        setRiders(prev => {
          const exists = prev.find(r => r.user_id === row.user_id);
          if (exists) {
            return prev.map(r => r.user_id === row.user_id
              ? { ...r, lat: row.lat, lng: row.lng, last_seen_at: row.last_seen_at ?? r.last_seen_at, is_active: active, name }
              : r
            );
          }
          if (row.is_online) {
            // New rider appeared — toast + ping
            playPing();
            toast({ title: '🟢 New Rider Online', description: name });
            recordOpen();
            pushFeed('rider', <Eye className="w-3.5 h-3.5" />, `${name} opened the app`, gpsLabel(row.lat, row.lng));
            return [{ user_id: row.user_id, name, lat: row.lat, lng: row.lng, last_seen_at: row.last_seen_at ?? new Date().toISOString(), is_active: active }, ...prev];
          }
          return prev;
        });

        // Remove if went offline
        if (row.is_online === false) {
          setRiders(prev => prev.filter(r => r.user_id !== row.user_id));
        }
      }
    ).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [isAdmin, resolveName, toast, pushFeed, recordOpen]);

  // ── Realtime: driver_profiles (online/offline) ──────────────────
  useEffect(() => {
    if (!isAdmin) return;
    const ch = supabase.channel('dmn-driver-profiles').on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'driver_profiles' },
      async (payload) => {
        const row = (payload.new as any);
        if (!row?.user_id) return;
        const name = await resolveName(row.user_id);

        if (row.is_online) {
          setDrivers(prev => {
            const exists = prev.find(d => d.user_id === row.user_id);
            if (exists) return prev.map(d => d.user_id === row.user_id ? { ...d, lat: row.current_lat, lng: row.current_lng, updated_at: row.updated_at, name } : d);
            return [{ user_id: row.user_id, name, is_online: true, lat: row.current_lat, lng: row.current_lng, updated_at: row.updated_at }, ...prev];
          });
        } else {
          setDrivers(prev => prev.filter(d => d.user_id !== row.user_id));
        }
      }
    ).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [isAdmin, resolveName]);

  // ── Realtime: activity_events (intent feed) ─────────────────────
  useEffect(() => {
    if (!isAdmin) return;
    const ch = supabase.channel('dmn-activity').on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'activity_events' },
      async (payload) => {
        const row = (payload.new as any);
        if (!row) return;
        const name = await resolveName(row.user_id);
        const role: 'rider' | 'driver' = (row.role ?? 'RIDER').toLowerCase().includes('driver') ? 'driver' : 'rider';
        const gps = row.meta?.lat && row.meta?.lng ? gpsLabel(row.meta.lat, row.meta.lng) : undefined;

        let icon: React.ReactNode = <Activity className="w-3.5 h-3.5" />;
        const et = (row.event_type ?? '').toLowerCase();
        if (et.includes('open') || et.includes('book')) { icon = <Eye className="w-3.5 h-3.5" />; recordOpen(); }
        if (et.includes('search') || et.includes('estimate')) icon = <Search className="w-3.5 h-3.5" />;
        if (et.includes('paid') || et.includes('payment')) icon = <CreditCard className="w-3.5 h-3.5" />;
        if (et.includes('accept')) icon = <CheckCircle className="w-3.5 h-3.5" />;
        if (et.includes('complete')) { icon = <CheckCircle className="w-3.5 h-3.5" />; recordRide(); }
        if (et.includes('offer') || et.includes('request')) icon = <Bell className="w-3.5 h-3.5" />;

        pushFeed(role, icon, `${name} — ${row.message}`, gps);
      }
    ).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [isAdmin, resolveName, pushFeed, recordOpen, recordRide]);

  // ── Realtime: rides (status changes for feed) ───────────────────
  useEffect(() => {
    if (!isAdmin) return;
    const ch = supabase.channel('dmn-rides').on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'rides' },
      async (payload) => {
        const nw = (payload.new as any);
        const old = (payload.old as any);
        if (!nw || nw.status === old?.status) return;

        const riderName = nw.rider_id ? await resolveName(nw.rider_id) : 'Rider';
        const driverName = nw.driver_id ? await resolveName(nw.driver_id) : null;

        switch (nw.status) {
          case 'searching':
            pushFeed('rider', <Search className="w-3.5 h-3.5" />, `Ride Paid — Searching for Driver (${riderName})`, gpsLabel(nw.pickup_lat, nw.pickup_lng));
            break;
          case 'driver_assigned':
            if (driverName) pushFeed('driver', <CheckCircle className="w-3.5 h-3.5" />, `${driverName} accepted ride from ${riderName}`);
            pushFeed('rider', <Navigation className="w-3.5 h-3.5" />, `Driver Found for ${riderName}`);
            break;
          case 'completed':
            if (driverName) pushFeed('driver', <CheckCircle className="w-3.5 h-3.5" />, `${driverName} completed ride`);
            pushFeed('rider', <CheckCircle className="w-3.5 h-3.5" />, `Ride Completed — ${riderName}`);
            recordRide();
            break;
          case 'in_progress':
            pushFeed('rider', <Car className="w-3.5 h-3.5" />, `${riderName} ride in progress`);
            break;
          case 'cancelled':
            pushFeed('rider', <Activity className="w-3.5 h-3.5" />, `Ride cancelled — ${riderName}`);
            break;
        }
      }
    ).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [isAdmin, resolveName, pushFeed, recordRide]);

  // ── Realtime: notifications (driver ride offers) ────────────────
  useEffect(() => {
    if (!isAdmin) return;
    const ch = supabase.channel('dmn-notifs').on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: 'type=eq.new_ride' },
      async (payload) => {
        const row = (payload.new as any);
        if (!row?.user_id) return;
        const name = await resolveName(row.user_id);
        pushFeed('driver', <Bell className="w-3.5 h-3.5" />, `${name} is receiving ride request`);
      }
    ).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [isAdmin, resolveName, pushFeed]);

  // ── Render ──────────────────────────────────────────────────────
  if (!isAdmin) return null;

  return (
    <div className="min-h-screen bg-[hsl(240,10%,6%)] text-foreground">
      {/* Header */}
      <div className="sticky top-0 z-40 border-b border-white/5 bg-[hsl(240,10%,6%)]/90 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/admin')} className="text-white/60 hover:text-white">
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-primary animate-pulse" />
              <h1 className="text-lg font-bold tracking-tight text-white">DMN Live Monitor</h1>
            </div>
            <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs animate-pulse">● LIVE</Badge>
          </div>
          <span className="text-xs text-white/30 font-mono">{new Date().toLocaleTimeString()}</span>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-4 space-y-4">
        {/* ── Stats Bar ──────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Riders Online" value={riders.length} color="azure" icon={<Users className="w-4 h-4" />} />
          <StatCard label="Drivers Online" value={drivers.length} color="purple" icon={<Car className="w-4 h-4" />} />
          <StatCard label="Opens (5m)" value={stats.totalOpens} color="azure" icon={<Eye className="w-4 h-4" />} />
          <StatCard label="Rides (5m)" value={stats.confirmedRides} color="purple" icon={<CheckCircle className="w-4 h-4" />} />
        </div>

        {/* ── Two-Column Live Pulse ─────────────────────────────── */}
        <div className="grid md:grid-cols-2 gap-4">
          {/* Riders */}
          <Card className="bg-white/[0.03] border-[hsl(210,100%,55%)]/20 backdrop-blur-md">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2 text-[hsl(210,100%,65%)]">
                <Users className="w-4 h-4" />
                ONLINE RIDERS
                <Badge variant="outline" className="ml-auto text-xs border-[hsl(210,100%,55%)]/30 text-[hsl(210,100%,65%)]">{riders.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[200px]">
                {riders.length === 0 && <p className="text-center text-xs text-white/30 py-8">No riders online</p>}
                {riders.map(r => (
                  <div key={r.user_id} className="flex items-center justify-between px-4 py-2 border-b border-white/5 hover:bg-white/[0.02]">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${r.is_active ? 'bg-green-400 animate-pulse' : 'bg-yellow-500'}`} />
                      <span className="text-sm text-white/90 truncate">{r.name}</span>
                      {r.lat && r.lng && (
                        <span className="text-[10px] text-white/25 font-mono hidden md:inline">{gpsLabel(r.lat, r.lng)}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {!r.is_active && <Badge variant="outline" className="text-[10px] border-yellow-600/40 text-yellow-500">Inactive</Badge>}
                      <span className="text-[10px] text-white/30">{ago(r.last_seen_at)}</span>
                    </div>
                  </div>
                ))}
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Drivers */}
          <Card className="bg-white/[0.03] border-primary/20 backdrop-blur-md">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2 text-primary">
                <Car className="w-4 h-4" />
                ONLINE DRIVERS
                <Badge variant="outline" className="ml-auto text-xs border-primary/30 text-primary">{drivers.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[200px]">
                {drivers.length === 0 && <p className="text-center text-xs text-white/30 py-8">No drivers online</p>}
                {drivers.map(d => (
                  <div key={d.user_id} className="flex items-center justify-between px-4 py-2 border-b border-white/5 hover:bg-white/[0.02]">
                    <div className="flex items-center gap-2 min-w-0">
                      <Wifi className="w-3 h-3 text-green-400 shrink-0" />
                      <span className="text-sm text-white/90 truncate">{d.name}</span>
                      {d.lat && d.lng && (
                        <span className="text-[10px] text-white/25 font-mono hidden md:inline">{gpsLabel(d.lat, d.lng)}</span>
                      )}
                    </div>
                    <span className="text-[10px] text-white/30 shrink-0">{ago(d.updated_at)}</span>
                  </div>
                ))}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* ── Intent-Based Live Feed ───────────────────────────── */}
        <Card className="bg-white/[0.03] border-white/10 backdrop-blur-md">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2 text-white/80">
              <Activity className="w-4 h-4 text-primary animate-pulse" />
              LIVE FEED
              <Badge variant="outline" className="ml-auto text-xs border-white/10 text-white/40">{feed.length} events</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[340px]" ref={feedRef}>
              {feed.length === 0 && <p className="text-center text-xs text-white/20 py-12">Waiting for events…</p>}
              {feed.map(e => (
                <div key={e.id} className="flex items-start gap-3 px-4 py-2.5 border-b border-white/5 hover:bg-white/[0.015]">
                  <div className={`mt-0.5 shrink-0 ${e.role === 'rider' ? 'text-[hsl(210,100%,65%)]' : 'text-primary'}`}>
                    {e.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white/85 leading-snug">{e.message}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-white/25">{e.ts.toLocaleTimeString()}</span>
                      {e.gps && (
                        <span className="text-[10px] text-white/20 font-mono flex items-center gap-0.5">
                          <MapPin className="w-2.5 h-2.5" /> {e.gps}
                        </span>
                      )}
                    </div>
                  </div>
                  <Badge variant="outline" className={`text-[9px] shrink-0 ${e.role === 'rider' ? 'border-[hsl(210,100%,55%)]/30 text-[hsl(210,100%,60%)]' : 'border-primary/30 text-primary'}`}>
                    {e.role === 'rider' ? 'RIDER' : 'DRIVER'}
                  </Badge>
                </div>
              ))}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

// ── Stat Card ──────────────────────────────────────────────────────
function StatCard({ label, value, color, icon }: { label: string; value: number; color: 'azure' | 'purple'; icon: React.ReactNode }) {
  const border = color === 'azure' ? 'border-[hsl(210,100%,55%)]/20' : 'border-primary/20';
  const text = color === 'azure' ? 'text-[hsl(210,100%,65%)]' : 'text-primary';
  return (
    <Card className={`bg-white/[0.03] ${border} backdrop-blur-md`}>
      <CardHeader className="pb-1 pt-3 px-4">
        <p className="text-[10px] uppercase tracking-widest text-white/30">{label}</p>
      </CardHeader>
      <CardContent className="px-4 pb-3 flex items-end justify-between">
        <span className={`text-2xl font-bold ${text}`}>{value}</span>
        <span className={`${text} opacity-60`}>{icon}</span>
      </CardContent>
    </Card>
  );
}

export default DMNLiveMonitor;
