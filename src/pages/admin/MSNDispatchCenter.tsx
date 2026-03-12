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
  type: "rider" | "driver" | "dispatch" | "system" | "cancel";
  message: string;
  ride_id?: string;
}

type UserStatus = "online" | "searching" | "accepted" | "in_progress" | "completed" | "cancelled" | "offline";

// ─── Helpers ────────────────────────────────────────────────────────────
const GHOST_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

const hasFreshHeartbeat = (lastSeen: string | null) => {
  if (!lastSeen) return false;
  return Date.now() - new Date(lastSeen).getTime() <= GHOST_TIMEOUT_MS;
};

const fmtTime = (d: Date) =>
  d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });

const nameOf = (e: { first_name: string | null; last_name: string | null; email: string | null }) =>
  [e.first_name, e.last_name].filter(Boolean).join(" ") || e.email || "Unknown";

const riderToken = (userId: string) => `{{rider:${userId}}}`;
const riderFallback = (userId: string) => userId.slice(0, 6);

// ─── Component ──────────────────────────────────────────────────────────
const MSNDispatchCenter: React.FC = () => {
  const navigate = useNavigate();
  const { isAdmin, authLoading } = useAuth();

  const [riders, setRiders] = useState<RiderEntry[]>([]);
  const [drivers, setDrivers] = useState<DriverEntry[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [activeRides, setActiveRides] = useState<Record<string, any>>({});
  const logIdCounter = useRef(0);
  const driverCacheRef = useRef<Record<string, string>>({});
  const riderCacheRef = useRef<Record<string, { first_name: string | null; last_name: string | null; email: string | null }>>({});
  const userStatusRef = useRef<Record<string, UserStatus>>({});
  const lastLogPerUser = useRef<Record<string, string>>({});
  const [riderDisplayVersion, setRiderDisplayVersion] = useState(0);

  // ─── Gate ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!authLoading && !isAdmin) {
      toast.error("Access Denied");
      navigate("/rider-home", { replace: true });
    }
  }, [authLoading, isAdmin, navigate]);

  // ─── Identity helpers ───────────────────────────────────────────────
  const riderDisplay = useCallback(
    (userId: string) => {
      const cached = riderCacheRef.current[userId];
      return cached?.email || [cached?.first_name, cached?.last_name].filter(Boolean).join(" ") || riderFallback(userId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [riderDisplayVersion]
  );

  const riderLabel = useCallback(
    (entry: RiderEntry) => entry.email || [entry.first_name, entry.last_name].filter(Boolean).join(" ") || riderFallback(entry.user_id),
    []
  );

  const renderTimelineMessage = useCallback(
    (message: string) => {
      const tokenRegex = /\{\{rider:([^}]+)\}\}/g;
      const parts: React.ReactNode[] = [];
      let lastIndex = 0;
      let tokenMatch: RegExpExecArray | null = null;

      while ((tokenMatch = tokenRegex.exec(message))) {
        const [rawToken, tokenUserId] = tokenMatch;
        if (tokenMatch.index > lastIndex) {
          parts.push(<span key={`txt-${tokenMatch.index}`}>{message.slice(lastIndex, tokenMatch.index)}</span>);
        }
        parts.push(
          <span key={`rider-${tokenMatch.index}`} className="text-sky-400 text-[13px]">
            {riderDisplay(tokenUserId)}
          </span>
        );
        lastIndex = tokenMatch.index + rawToken.length;
      }

      if (lastIndex < message.length) {
        parts.push(<span key="txt-end">{message.slice(lastIndex)}</span>);
      }

      return parts.length ? parts : message;
    },
    [riderDisplay, riderDisplayVersion]
  );

  // ─── De-duplicated push log ────────────────────────────────────────
  const pushLog = useCallback(
    (type: LogEntry["type"], message: string, ride_id?: string) => {
      // Extract userId from token for per-user dedup
      const tokenMatch = message.match(/\{\{rider:([^}]+)\}\}/);
      if (tokenMatch) {
        const userId = tokenMatch[1];
        const lastMsg = lastLogPerUser.current[userId];
        if (lastMsg === message) return; // exact same message for this user — skip
        lastLogPerUser.current[userId] = message;
      }

      logIdCounter.current += 1;
      setLogs((prev) => [{ id: `log-${logIdCounter.current}`, ts: new Date(), type, message, ride_id }, ...prev].slice(0, 200));
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
        ? data.email || [data.first_name, data.last_name].filter(Boolean).join(" ") || driverId.slice(0, 8)
        : driverId.slice(0, 8);
      driverCacheRef.current[driverId] = name;
      return name;
    },
    []
  );

  const resolveRiderProfile = useCallback(async (userId: string, bypassCache = false) => {
    const cached = riderCacheRef.current[userId];
    if (!bypassCache && cached?.email) return cached;

    let profile: { first_name: string | null; last_name: string | null; email: string | null } | null = null;

    const { data: byUserId, error: byUserIdError } = await supabase
      .from("profiles")
      .select("first_name, last_name, email")
      .eq("user_id", userId)
      .maybeSingle();

    if (byUserIdError) {
      console.warn("[MSN] profile lookup by user_id failed:", byUserIdError);
    } else if (byUserId) {
      profile = byUserId;
    }

    if (!profile) {
      const { data: byId, error: byIdError } = await supabase
        .from("profiles")
        .select("first_name, last_name, email")
        .eq("id", userId)
        .maybeSingle();

      if (byIdError) {
        console.warn("[MSN] profile lookup by id failed:", byIdError);
      } else if (byId) {
        profile = byId;
      }
    }

    if (profile) {
      riderCacheRef.current[userId] = profile;
      setRiderDisplayVersion((v) => v + 1);
      return profile;
    }

    return null;
  }, []);

  const ensureRiderVisible = useCallback(
    (userId: string, lastSeenAt?: string | null) => {
      if (!userId) return;
      const heartbeat = lastSeenAt ?? new Date().toISOString();

      setRiders((prev) => {
        const idx = prev.findIndex((r) => r.user_id === userId);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], last_seen_at: heartbeat, is_online: true };
          return next;
        }
        return [
          { user_id: userId, first_name: null, last_name: null, email: null, last_seen_at: heartbeat, is_online: true },
          ...prev,
        ];
      });

      const shouldForceIdentityFetch = !riderCacheRef.current[userId]?.email;
      void resolveRiderProfile(userId, shouldForceIdentityFetch)
        .then((profile) => {
          if (!profile) return;
          setRiders((prev) => {
            const idx = prev.findIndex((r) => r.user_id === userId);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = {
                ...next[idx],
                first_name: profile.first_name,
                last_name: profile.last_name,
                email: profile.email,
              };
              return next;
            }
            return [
              {
                user_id: userId,
                first_name: profile.first_name,
                last_name: profile.last_name,
                email: profile.email,
                last_seen_at: heartbeat,
                is_online: true,
              },
              ...prev,
            ];
          });
        })
        .catch(() => undefined);
    },
    [resolveRiderProfile]
  );

  // ─── Ghost killer: evict stale riders every 30s ────────────────────
  useEffect(() => {
    const iv = setInterval(() => {
      setRiders((prev) =>
        prev.map((r) => {
          if (!hasFreshHeartbeat(r.last_seen_at) && r.is_online) {
            // Mark offline
            if (userStatusRef.current[r.user_id] !== "offline") {
              userStatusRef.current[r.user_id] = "offline";
            }
            return { ...r, is_online: false };
          }
          return r;
        })
      );
    }, 30_000);
    return () => clearInterval(iv);
  }, []);

  // ─── Fetch riders ─────────────────────────────────────────────────
  const fetchRiders = useCallback(async () => {
    const { data: locations } = await supabase
      .from("rider_locations")
      .select("user_id, last_seen_at, is_online")
      .order("last_seen_at", { ascending: false })
      .limit(500);

    const locationRows = locations ?? [];
    const allIds = Array.from(new Set(locationRows.map((l) => l.user_id)));

    if (!allIds.length) { setRiders([]); return; }

    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, first_name, last_name, email")
      .in("user_id", allIds);

    const profileMap = new Map((profiles ?? []).map((p) => [p.user_id, p]));

    const nextRiders = locationRows.map((loc) => {
      const profile = profileMap.get(loc.user_id);
      if (profile) {
        riderCacheRef.current[loc.user_id] = {
          first_name: profile.first_name,
          last_name: profile.last_name,
          email: profile.email,
        };
      }
      return {
        user_id: loc.user_id,
        first_name: profile?.first_name ?? null,
        last_name: profile?.last_name ?? null,
        email: profile?.email ?? null,
        last_seen_at: loc.last_seen_at ?? null,
        is_online: hasFreshHeartbeat(loc.last_seen_at),
      };
    });

    // Deduplicate by user_id
    const seen = new Set<string>();
    const deduped = nextRiders.filter((r) => {
      if (seen.has(r.user_id)) return false;
      seen.add(r.user_id);
      return true;
    });

    deduped.sort((a, b) => {
      if (a.is_online !== b.is_online) return a.is_online ? -1 : 1;
      return (
        (b.last_seen_at ? new Date(b.last_seen_at).getTime() : 0) -
        (a.last_seen_at ? new Date(a.last_seen_at).getTime() : 0)
      );
    });

    setRiders(deduped);
    setRiderDisplayVersion((v) => v + 1);
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
    list.forEach((d) => {
      driverCacheRef.current[d.user_id] = d.email || nameOf(d);
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

  // ─── Initial load (no system noise) ───────────────────────────────
  useEffect(() => {
    if (!isAdmin) return;
    fetchRiders();
    fetchDrivers();
    fetchActiveRides();
  }, [isAdmin, fetchRiders, fetchDrivers, fetchActiveRides]);

  // ─── Realtime: rider_locations ─────────────────────────────────────
  useEffect(() => {
    if (!isAdmin) return;

    const ch = supabase
      .channel("msn-rider-locations")
      .on("postgres_changes", { event: "*", schema: "public", table: "rider_locations" }, async (payload) => {
        if (payload.eventType === "DELETE") return;

        const row = (payload.new as any) ?? {};
        if (!row.user_id) return;

        const updatedLastSeen = row.last_seen_at ?? new Date().toISOString();

        // Identity Force: if email is missing, force immediate profile fetch now.
        const shouldForceIdentityFetch = !riderCacheRef.current[row.user_id]?.email;
        const profile = await resolveRiderProfile(row.user_id, shouldForceIdentityFetch);

        if (profile) {
          setRiders((prev) => {
            const idx = prev.findIndex((r) => r.user_id === row.user_id);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = {
                ...next[idx],
                first_name: profile.first_name,
                last_name: profile.last_name,
                email: profile.email,
              };
              return next;
            }
            return [
              {
                user_id: row.user_id,
                first_name: profile.first_name,
                last_name: profile.last_name,
                email: profile.email,
                last_seen_at: updatedLastSeen,
                is_online: row.is_online !== false,
              },
              ...prev,
            ];
          });
        }

        // If is_online is explicitly false, mark offline instantly
        if (row.is_online === false) {
          setRiders((prev) => {
            const idx = prev.findIndex((r) => r.user_id === row.user_id);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = { ...next[idx], is_online: false, last_seen_at: updatedLastSeen };
              return next;
            }
            return [
              {
                user_id: row.user_id,
                first_name: profile?.first_name ?? null,
                last_name: profile?.last_name ?? null,
                email: profile?.email ?? null,
                is_online: false,
                last_seen_at: updatedLastSeen,
              },
              ...prev,
            ];
          });
          if (userStatusRef.current[row.user_id] !== "offline") {
            userStatusRef.current[row.user_id] = "offline";
            pushLog("system", `🔴 ${riderToken(row.user_id)} went Offline`);
          }
          return;
        }

        ensureRiderVisible(row.user_id, updatedLastSeen);

        // Only log "Online" once per session (offline→online transition)
        const prevStatus = userStatusRef.current[row.user_id];
        if (!prevStatus || prevStatus === "offline") {
          userStatusRef.current[row.user_id] = "online";
          pushLog("system", `🟢 ${riderToken(row.user_id)} is Online`);
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [ensureRiderVisible, isAdmin, pushLog, resolveRiderProfile]);

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
          pushLog("driver", `🟢 ${name} came online`);
        } else if (!row.is_online && (payload.old as any)?.is_online) {
          pushLog("driver", `🔴 ${name} went offline`);
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [isAdmin, pushLog]);

  // ─── Realtime: rides ───────────────────────────────────────────────
  useEffect(() => {
    if (!isAdmin) return;

    const riderRef = (ride: any) => (ride?.rider_id ? riderToken(ride.rider_id) : "unknown");

    const ch = supabase
      .channel("msn-rides")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "rides" }, async (payload) => {
        const ride = payload.new as any;
        setActiveRides((prev) => ({ ...prev, [ride.id]: ride }));

        if (ride.rider_id) {
          ensureRiderVisible(ride.rider_id, new Date().toISOString());
          const prev = userStatusRef.current[ride.rider_id];
          if (prev !== "searching") {
            userStatusRef.current[ride.rider_id] = "searching";
            pushLog("rider", `🚕 ${riderRef(ride)} is searching for a ride`, ride.id);
          }
        }
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "rides" }, async (payload) => {
        const ride = payload.new as any;
        const old = payload.old as any;

        if (ride.rider_id) {
          ensureRiderVisible(ride.rider_id, ride.updated_at ?? new Date().toISOString());
        }

        if (["completed", "cancelled"].includes(ride.status)) {
          setActiveRides((prev) => { const next = { ...prev }; delete next[ride.id]; return next; });
        } else {
          setActiveRides((prev) => ({ ...prev, [ride.id]: ride }));
        }

        if (ride.status !== old.status) {
          const riderId = ride.rider_id;
          if (ride.status === "driver_assigned" && ride.driver_id) {
            if (riderId) userStatusRef.current[riderId] = "accepted";
            const dn = await resolveDriverName(ride.driver_id);
            pushLog("dispatch", `✅ ${riderRef(ride)} ride accepted by ${dn}`, ride.id);
          } else if (ride.status === "cancelled") {
            if (riderId) userStatusRef.current[riderId] = "cancelled";
            pushLog("cancel", `❌ ${riderRef(ride)} ride cancelled`, ride.id);
          } else if (ride.status === "in_progress") {
            if (riderId) userStatusRef.current[riderId] = "in_progress";
            pushLog("rider", `🚗 ${riderRef(ride)} ride in progress`, ride.id);
          } else if (ride.status === "completed") {
            if (riderId) userStatusRef.current[riderId] = "completed";
            pushLog("rider", `🏁 ${riderRef(ride)} ride completed`, ride.id);
          } else if (ride.status === "driver_en_route") {
            pushLog("driver", `🚙 Driver en route to ${riderRef(ride)}`, ride.id);
          } else if (ride.status === "arrived") {
            pushLog("driver", `📍 Driver arrived for ${riderRef(ride)}`, ride.id);
          } else if (ride.status === "searching") {
            if (riderId) {
              const prevS = userStatusRef.current[riderId];
              if (prevS !== "searching") {
                userStatusRef.current[riderId] = "searching";
                pushLog("rider", `🚕 ${riderRef(ride)} is searching for a ride`, ride.id);
              }
            }
          }
        }

        const oldIds: string[] = old.notified_driver_ids ?? [];
        const newIds: string[] = ride.notified_driver_ids ?? [];
        const freshIds = newIds.filter((id: string) => !oldIds.includes(id));
        for (const dId of freshIds) {
          const dn = await resolveDriverName(dId);
          pushLog("dispatch", `📡 Ride request sent to ${dn} (25s timer)`, ride.id);
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [ensureRiderVisible, isAdmin, pushLog, resolveDriverName]);

  // UI timestamps refresh removed — relying 100% on realtime events

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
    rider: "text-sky-400",
    driver: "text-purple-400",
    dispatch: "text-yellow-400",
    system: "text-green-400",
    cancel: "text-red-400",
  };

  // Online = is_online flag from realtime (instant, no heartbeat delay)
  const onlineRiders = riders.filter((r) => r.is_online);
  const offlineRiders = riders.filter((r) => !r.is_online);

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

      {/* Layout: left half = riders+drivers stacked, right half = feed */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 h-[calc(100vh-100px)]">
        {/* Left: Riders + Drivers stacked */}
        <div className="flex flex-col gap-4 overflow-hidden">
          {/* Rider Box */}
          <Card className="bg-gray-950 border-green-900 overflow-hidden flex-1">
            <CardHeader className="py-2 px-3 border-b border-green-900">
              <CardTitle className="text-sm text-green-400 flex items-center gap-2">
                <Users className="h-4 w-4" /> RIDERS — Online: {onlineRiders.length} / Total: {riders.length}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-full max-h-[calc(50vh-100px)]">
                <div className="divide-y divide-green-900/30">
                  {onlineRiders.map((r) => (
                    <div key={r.user_id} className="flex items-center justify-between px-3 py-1.5 hover:bg-green-900/10">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="h-2 w-2 rounded-full flex-shrink-0 bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.6)]" />
                        <span className="text-[13px] truncate text-sky-400">{riderLabel(r)}</span>
                      </div>
                      <span className="text-[9px] flex-shrink-0 text-green-500">ONLINE</span>
                    </div>
                  ))}
                  {offlineRiders.slice(0, 20).map((r) => (
                    <div key={r.user_id} className="flex items-center justify-between px-3 py-1.5 hover:bg-green-900/10 opacity-50">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="h-2 w-2 rounded-full flex-shrink-0 bg-gray-600" />
                        <span className="text-[13px] truncate text-gray-500">{riderLabel(r)}</span>
                      </div>
                      <span className="text-[9px] flex-shrink-0 text-gray-600">OFFLINE</span>
                    </div>
                  ))}
                  {riders.length === 0 && (
                    <div className="p-3 text-xs text-gray-600">Waiting for rider heartbeats...</div>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Driver Box */}
          <Card className="bg-gray-950 border-green-900 overflow-hidden flex-1">
            <CardHeader className="py-2 px-3 border-b border-green-900">
              <CardTitle className="text-sm text-green-400 flex items-center gap-2">
                <Car className="h-4 w-4" /> DRIVERS ({drivers.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-full max-h-[calc(50vh-100px)]">
                <div className="divide-y divide-green-900/30">
                  {drivers.map((d) => (
                    <div key={d.user_id} className="flex items-center justify-between px-3 py-1.5 hover:bg-green-900/10">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={`h-2 w-2 rounded-full flex-shrink-0 ${d.is_online ? "bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.6)]" : "bg-gray-600"}`} />
                        <span className={`text-[13px] truncate ${d.is_online ? "text-purple-400" : "text-gray-400"}`}>{d.email || nameOf(d)}</span>
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
        </div>

        {/* Right: Live Feed full-height */}
        <Card className="bg-gray-950 border-green-900 overflow-hidden">
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
          <CardContent className="p-0 flex flex-col h-[calc(100vh-160px)]">
            <ScrollArea className="flex-1 px-2 py-1">
              <div className="space-y-px font-mono text-[11px] leading-tight">
                {logs.map((log) => (
                  <div key={log.id} className="flex gap-1.5 py-px">
                    <span className="text-gray-600 flex-shrink-0 tabular-nums">[{fmtTime(log.ts)}]</span>
                    <span className={logColor[log.type] ?? "text-gray-400"}>{renderTimelineMessage(log.message)}</span>
                  </div>
                ))}
              </div>
              {logs.length === 0 && (
                <div className="text-gray-600 text-[11px] py-4 text-center">Waiting for events...</div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default MSNDispatchCenter;
