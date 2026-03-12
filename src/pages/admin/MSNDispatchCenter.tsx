import React, { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  ArrowLeft,
  Radio,
  Zap,
  Users,
  Car,
  AlertTriangle,
  Skull,
  Power,
  RefreshCw,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────
interface RiderEntry {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  last_seen_at: string | null;
  is_online: boolean;
}

interface DriverEntry {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  is_online: boolean;
}

interface LogEntry {
  id: string;
  ts: Date;
  type: "rider" | "dispatch" | "system" | "cancel";
  message: string;
  ride_id?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────
const isAppOpen = (lastSeen: string | null) => {
  if (!lastSeen) return false;
  return Date.now() - new Date(lastSeen).getTime() < 30_000;
};

const fmtTime = (d: Date) =>
  d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });

const nameOf = (e: { first_name: string | null; last_name: string | null; email: string | null }) =>
  [e.first_name, e.last_name].filter(Boolean).join(" ") || e.email || "Unknown";

// ─── Component ──────────────────────────────────────────────────────────
const MSNDispatchCenter: React.FC = () => {
  const navigate = useNavigate();
  const { user, isAdmin, authLoading } = useAuth();

  const [riders, setRiders] = useState<RiderEntry[]>([]);
  const [drivers, setDrivers] = useState<DriverEntry[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [activeRides, setActiveRides] = useState<Record<string, any>>({});
  const logEndRef = useRef<HTMLDivElement>(null);
  const logIdCounter = useRef(0);
  const driverCacheRef = useRef<Record<string, string>>({});
  const riderCacheRef = useRef<Record<string, { first_name: string | null; last_name: string | null; email: string | null }>>({});

  // ─── Gate ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!authLoading && !isAdmin) {
      toast.error("Access Denied");
      navigate("/rider-home", { replace: true });
    }
  }, [authLoading, isAdmin, navigate]);

  // ─── Push log helper ───────────────────────────────────────────────
  const pushLog = useCallback(
    (type: LogEntry["type"], message: string, ride_id?: string) => {
      logIdCounter.current += 1;
      setLogs((prev) => [
        ...prev.slice(-199),
        { id: `log-${logIdCounter.current}`, ts: new Date(), type, message, ride_id },
      ]);
    },
    []
  );

  // ─── Resolve driver name (cached) ─────────────────────────────────
  const resolveDriverName = useCallback(
    async (driverId: string): Promise<string> => {
      if (driverCacheRef.current[driverId]) return driverCacheRef.current[driverId];
      const { data } = await supabase
        .from("profiles")
        .select("first_name, last_name, email")
        .eq("user_id", driverId)
        .maybeSingle();
      const name = data
        ? [data.first_name, data.last_name].filter(Boolean).join(" ") || data.email || driverId.slice(0, 8)
        : driverId.slice(0, 8);
      driverCacheRef.current[driverId] = name;
      return name;
    },
    []
  );

  const resolveRiderProfile = useCallback(async (userId: string) => {
    if (riderCacheRef.current[userId]) return riderCacheRef.current[userId];
    const { data } = await supabase
      .from("profiles")
      .select("first_name, last_name, email")
      .eq("user_id", userId)
      .maybeSingle();

    if (data) {
      riderCacheRef.current[userId] = data;
      return data;
    }

    return { first_name: "Guest", last_name: "Active", email: null };
  }, []);

  // ─── Fetch riders (profiles + rider_locations) ─────────────────────
  const fetchRiders = useCallback(async () => {
    const { data: riderRoles } = await supabase.from("user_roles").select("user_id").eq("role", "rider");
    if (!riderRoles?.length) {
      setRiders([]);
      return;
    }

    const ids = riderRoles.map((r) => r.user_id);
    const { data: profiles } = await supabase.from("profiles").select("user_id, first_name, last_name, email").in("user_id", ids);
    const { data: locations } = await supabase.from("rider_locations").select("user_id, last_seen_at, is_online").in("user_id", ids);

    const locMap = new Map((locations ?? []).map((l) => [l.user_id, l]));
    const nextRiders = (profiles ?? []).map((p) => {
      riderCacheRef.current[p.user_id] = {
        first_name: p.first_name,
        last_name: p.last_name,
        email: p.email,
      };

      return {
        user_id: p.user_id,
        first_name: p.first_name,
        last_name: p.last_name,
        email: p.email,
        last_seen_at: locMap.get(p.user_id)?.last_seen_at ?? null,
        is_online: locMap.get(p.user_id)?.is_online ?? false,
      };
    });

    nextRiders.sort((a, b) => {
      const aOnline = a.is_online || isAppOpen(a.last_seen_at);
      const bOnline = b.is_online || isAppOpen(b.last_seen_at);
      if (aOnline !== bOnline) return aOnline ? -1 : 1;
      return (b.last_seen_at ? new Date(b.last_seen_at).getTime() : 0) - (a.last_seen_at ? new Date(a.last_seen_at).getTime() : 0);
    });

    setRiders(nextRiders);
  }, []);

  // ─── Fetch drivers ─────────────────────────────────────────────────
  const fetchDrivers = useCallback(async () => {
    const { data: driverRoles } = await supabase.from("user_roles").select("user_id").eq("role", "driver");
    if (!driverRoles?.length) return;

    const ids = driverRoles.map((r) => r.user_id);
    const { data: profiles } = await supabase.from("profiles").select("user_id, first_name, last_name, email").in("user_id", ids);
    const { data: driverProfiles } = await supabase.from("driver_profiles").select("user_id, is_online").in("user_id", ids);

    const dpMap = new Map((driverProfiles ?? []).map((d) => [d.user_id, d]));
    const list = (profiles ?? []).map((p) => ({
      user_id: p.user_id,
      first_name: p.first_name,
      last_name: p.last_name,
      email: p.email,
      is_online: dpMap.get(p.user_id)?.is_online ?? false,
    }));
    setDrivers(list);
    // warm cache
    list.forEach((d) => {
      driverCacheRef.current[d.user_id] = nameOf(d);
    });
  }, []);

  // ─── Fetch active rides ────────────────────────────────────────────
  const fetchActiveRides = useCallback(async () => {
    const { data } = await supabase
      .from("rides")
      .select("id, status, rider_id, driver_id, pickup_address, dropoff_address, notified_driver_ids, created_at")
      .in("status", ["searching", "driver_assigned", "driver_en_route", "arrived", "in_progress"]);
    const map: Record<string, any> = {};
    (data ?? []).forEach((r) => (map[r.id] = r));
    setActiveRides(map);
  }, []);

  // ─── Initial load ──────────────────────────────────────────────────
  useEffect(() => {
    if (!isAdmin) return;
    fetchRiders();
    fetchDrivers();
    fetchActiveRides();
    pushLog("system", "🟢 MSN Dispatch Command Center ONLINE");
  }, [isAdmin, fetchRiders, fetchDrivers, fetchActiveRides, pushLog]);

  // ─── Realtime: rider_locations ─────────────────────────────────────
  useEffect(() => {
    if (!isAdmin) return;

    const ch = supabase
      .channel("msn-rider-locations")
      .on("postgres_changes", { event: "*", schema: "public", table: "rider_locations" }, async (payload) => {
        const row = (payload.new as any) ?? {};
        if (!row.user_id) return;

        const updatedLastSeen = row.last_seen_at ?? new Date().toISOString();

        setRiders((prev) => {
          const index = prev.findIndex((r) => r.user_id === row.user_id);

          if (index >= 0) {
            const next = [...prev];
            next[index] = {
              ...next[index],
              last_seen_at: updatedLastSeen,
              is_online: row.is_online ?? true,
            };

            next.sort((a, b) => {
              const aOnline = a.is_online || isAppOpen(a.last_seen_at);
              const bOnline = b.is_online || isAppOpen(b.last_seen_at);
              if (aOnline !== bOnline) return aOnline ? -1 : 1;
              return (b.last_seen_at ? new Date(b.last_seen_at).getTime() : 0) - (a.last_seen_at ? new Date(a.last_seen_at).getTime() : 0);
            });

            return next;
          }

          return [
            {
              user_id: row.user_id,
              first_name: "Guest",
              last_name: "Active",
              email: null,
              last_seen_at: updatedLastSeen,
              is_online: row.is_online ?? true,
            },
            ...prev,
          ];
        });

        const profile = await resolveRiderProfile(row.user_id);
        setRiders((prev) =>
          prev.map((r) =>
            r.user_id === row.user_id
              ? {
                  ...r,
                  first_name: profile.first_name,
                  last_name: profile.last_name,
                  email: profile.email,
                }
              : r
          )
        );

        pushLog("rider", `📶 Rider ping received: ${nameOf(profile)} is active`);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [isAdmin, pushLog, resolveRiderProfile]);

  // ─── Realtime: driver_profiles (online status) ─────────────────────
  useEffect(() => {
    if (!isAdmin) return;
    const ch = supabase
      .channel("msn-driver-profiles")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "driver_profiles" }, (payload) => {
        const row = payload.new as any;
        setDrivers((prev) =>
          prev.map((d) => (d.user_id === row.user_id ? { ...d, is_online: row.is_online } : d))
        );
        const name = driverCacheRef.current[row.user_id] || row.user_id.slice(0, 8);
        if (row.is_online && !(payload.old as any)?.is_online) {
          pushLog("system", `🟢 DRIVER ${name} came ONLINE`);
        } else if (!row.is_online && (payload.old as any)?.is_online) {
          pushLog("system", `🔴 DRIVER ${name} went OFFLINE`);
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [isAdmin, pushLog]);

  // ─── Realtime: rides (new rides + status changes + dispatch) ───────
  useEffect(() => {
    if (!isAdmin) return;
    const ch = supabase
      .channel("msn-rides")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "rides" }, async (payload) => {
        const ride = payload.new as any;
        setActiveRides((prev) => ({ ...prev, [ride.id]: ride }));

        // Resolve rider name
        const { data: rp } = await supabase
          .from("profiles")
          .select("first_name, last_name, email")
          .eq("user_id", ride.rider_id)
          .maybeSingle();
        const riderName = rp ? [rp.first_name, rp.last_name].filter(Boolean).join(" ") || rp.email : ride.rider_id?.slice(0, 8);
        pushLog("rider", `🚕 RIDER ${riderName} is requesting a ride now → ${ride.pickup_address} ➜ ${ride.dropoff_address}`, ride.id);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "rides" }, async (payload) => {
        const ride = payload.new as any;
        const old = payload.old as any;

        // Update active rides map
        if (["completed", "cancelled"].includes(ride.status)) {
          setActiveRides((prev) => {
            const next = { ...prev };
            delete next[ride.id];
            return next;
          });
        } else {
          setActiveRides((prev) => ({ ...prev, [ride.id]: ride }));
        }

        // Status change events
        if (ride.status !== old.status) {
          if (ride.status === "driver_assigned" && ride.driver_id) {
            const dn = await resolveDriverName(ride.driver_id);
            pushLog("dispatch", `✅ DRIVER ${dn} ACCEPTED ride ${ride.id.slice(0, 8)}`, ride.id);
          } else if (ride.status === "cancelled") {
            pushLog("cancel", `❌ Ride ${ride.id.slice(0, 8)} CANCELLED`, ride.id);
          } else if (ride.status === "in_progress") {
            pushLog("system", `🚗 Ride ${ride.id.slice(0, 8)} IN PROGRESS`);
          } else if (ride.status === "completed") {
            pushLog("system", `🏁 Ride ${ride.id.slice(0, 8)} COMPLETED`);
          }
        }

        // Dispatch notifications (notified_driver_ids changed)
        const oldIds: string[] = old.notified_driver_ids ?? [];
        const newIds: string[] = ride.notified_driver_ids ?? [];
        const freshIds = newIds.filter((id: string) => !oldIds.includes(id));
        for (const dId of freshIds) {
          const dn = await resolveDriverName(dId);
          pushLog("dispatch", `📡 SYSTEM: Sending Ride Request to DRIVER ${dn} — (25s timer started)`, ride.id);
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [isAdmin, pushLog, resolveDriverName]);

  // ─── Auto-scroll logs ──────────────────────────────────────────────
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // ─── Refresh timer for "App Open" indicators ──────────────────────
  const [, setTick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setTick((t) => t + 1), 5000);
    return () => clearInterval(iv);
  }, []);

  // ─── Force Reset ride ──────────────────────────────────────────────
  const forceResetRide = async (rideId: string) => {
    const { error } = await supabase
      .from("rides")
      .update({ status: "cancelled" as any, cancelled_at: new Date().toISOString(), cancel_reason: "Admin force reset via MSN" })
      .eq("id", rideId);
    if (error) {
      toast.error("Force reset failed: " + error.message);
    } else {
      toast.success("Ride force-cancelled");
      pushLog("cancel", `💀 ADMIN force-cancelled ride ${rideId.slice(0, 8)}`);
    }
  };

  // ─── Force Offline driver ─────────────────────────────────────────
  const forceOffline = async (driverUserId: string) => {
    const { error } = await supabase
      .from("driver_profiles")
      .update({ is_online: false })
      .eq("user_id", driverUserId);
    if (error) {
      toast.error("Force offline failed: " + error.message);
    } else {
      toast.success("Driver forced offline");
      const name = driverCacheRef.current[driverUserId] || driverUserId.slice(0, 8);
      pushLog("system", `💀 ADMIN forced DRIVER ${name} OFFLINE`);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="animate-pulse text-green-400 font-mono">INITIALIZING...</div>
      </div>
    );
  }

  if (!isAdmin) return null;

  const logColor: Record<string, string> = {
    rider: "text-cyan-400",
    dispatch: "text-yellow-400",
    system: "text-green-400",
    cancel: "text-red-400",
  };

  return (
    <div className="min-h-screen bg-black text-green-400 font-mono p-4">
      {/* Header */}
      <div className="flex items-center gap-4 mb-4 border-b border-green-900 pb-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/admin")}
          className="text-green-400 hover:text-green-200 hover:bg-green-900/30"
        >
          <ArrowLeft className="h-4 w-4 mr-1" /> BACK
        </Button>
        <Radio className="h-5 w-5 text-red-500 animate-pulse" />
        <h1 className="text-lg font-bold tracking-widest">MSN DISPATCH COMMAND CENTER</h1>
        <Badge variant="outline" className="ml-auto border-green-700 text-green-400 text-xs">
          LIVE
        </Badge>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { fetchRiders(); fetchDrivers(); fetchActiveRides(); }}
          className="text-green-400 hover:text-green-200 hover:bg-green-900/30"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Two-column status board + feed */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-[calc(100vh-100px)]">
        {/* Rider Box */}
        <Card className="bg-gray-950 border-green-900 overflow-hidden">
          <CardHeader className="py-2 px-3 border-b border-green-900">
            <CardTitle className="text-sm text-green-400 flex items-center gap-2">
              <Users className="h-4 w-4" /> RIDERS ({riders.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[calc(50vh-80px)] lg:h-[calc(100vh-180px)]">
              <div className="divide-y divide-green-900/30">
                {riders.map((r) => {
                  const appOpen = isAppOpen(r.last_seen_at);
                  return (
                    <div key={r.user_id} className="flex items-center justify-between px-3 py-2 hover:bg-green-900/10">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={`h-2 w-2 rounded-full flex-shrink-0 ${appOpen ? "bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.6)]" : "bg-gray-600"}`} />
                        <span className="text-xs truncate text-gray-300">{nameOf(r)}</span>
                      </div>
                      <span className={`text-[10px] flex-shrink-0 ${appOpen ? "text-green-500" : "text-gray-600"}`}>
                        {appOpen ? "APP OPEN" : "IDLE"}
                      </span>
                    </div>
                  );
                })}
                {riders.length === 0 && <div className="p-3 text-xs text-gray-600">No riders found</div>}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Driver Box */}
        <Card className="bg-gray-950 border-green-900 overflow-hidden">
          <CardHeader className="py-2 px-3 border-b border-green-900">
            <CardTitle className="text-sm text-green-400 flex items-center gap-2">
              <Car className="h-4 w-4" /> DRIVERS ({drivers.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[calc(50vh-80px)] lg:h-[calc(100vh-180px)]">
              <div className="divide-y divide-green-900/30">
                {drivers.map((d) => (
                  <div key={d.user_id} className="flex items-center justify-between px-3 py-2 hover:bg-green-900/10">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={`h-2 w-2 rounded-full flex-shrink-0 ${d.is_online ? "bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.6)]" : "bg-gray-600"}`} />
                      <span className="text-xs truncate text-gray-300">{nameOf(d)}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`text-[10px] ${d.is_online ? "text-green-500" : "text-gray-600"}`}>
                        {d.is_online ? "ONLINE" : "OFFLINE"}
                      </span>
                      {d.is_online && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => forceOffline(d.user_id)}
                          className="h-6 px-2 text-[10px] text-red-500 hover:text-red-300 hover:bg-red-900/20"
                          title="Force this driver offline"
                        >
                          <Power className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
                {drivers.length === 0 && <div className="p-3 text-xs text-gray-600">No drivers found</div>}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Live Transaction Feed */}
        <Card className="bg-gray-950 border-green-900 overflow-hidden lg:row-span-1">
          <CardHeader className="py-2 px-3 border-b border-green-900">
            <CardTitle className="text-sm text-green-400 flex items-center gap-2">
              <Zap className="h-4 w-4" /> LIVE FEED
              {Object.keys(activeRides).length > 0 && (
                <Badge variant="outline" className="border-yellow-700 text-yellow-400 text-[10px] ml-auto">
                  {Object.keys(activeRides).length} ACTIVE
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 flex flex-col h-[calc(100vh-180px)]">
            {/* Active rides bar */}
            {Object.keys(activeRides).length > 0 && (
              <div className="border-b border-green-900/50 p-2 space-y-1 max-h-32 overflow-y-auto">
                {Object.values(activeRides).map((ride: any) => (
                  <div key={ride.id} className="flex items-center justify-between gap-2 text-[10px]">
                    <div className="flex items-center gap-1 min-w-0 truncate">
                      <AlertTriangle className="h-3 w-3 text-yellow-500 flex-shrink-0" />
                      <span className="text-yellow-400 truncate">
                        {ride.id.slice(0, 8)} · {ride.status}
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => forceResetRide(ride.id)}
                      className="h-5 px-2 text-[10px] text-red-500 hover:text-red-300 hover:bg-red-900/20 flex-shrink-0"
                    >
                      <Skull className="h-3 w-3 mr-1" /> FORCE RESET
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {/* Log feed */}
            <ScrollArea className="flex-1 p-2">
              <div className="space-y-0.5">
                {logs.map((log) => (
                  <div key={log.id} className="flex gap-2 text-[11px] leading-relaxed">
                    <span className="text-gray-600 flex-shrink-0">[{fmtTime(log.ts)}]</span>
                    <span className={logColor[log.type] ?? "text-gray-400"}>{log.message}</span>
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
              {logs.length === 0 && (
                <div className="text-gray-600 text-xs py-4 text-center">Waiting for events...</div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default MSNDispatchCenter;
