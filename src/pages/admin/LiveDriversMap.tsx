import React, { useEffect, useMemo, useState } from "react";
import MapGl, { Marker, Popup, NavigationControl } from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useMapboxToken } from "@/hooks/useMapboxToken";
import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Radio, Users, Clock, Car, Phone, Mail, MapPin, Loader2 } from "lucide-react";
import { toast } from "sonner";

type DriverLoc = {
  driver_id: string;
  user_id: string;
  lat: number;
  lng: number;
  heading: number | null;
  speed_kph: number | null;
  is_online: boolean;
  updated_at: string;
  display_name?: string | null;
  phone_number?: string | null;
  email?: string | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  vehicle_color?: string | null;
  license_plate?: string | null;
};

const STALE_THRESHOLD_SECONDS = 60;

export default function AdminDriversLive() {
  const navigate = useNavigate();
  const { session, authLoading, isAdmin } = useAuth();
  const { token, loading: tokenLoading, error: tokenError } = useMapboxToken();
  const [drivers, setDrivers] = useState<Record<string, DriverLoc>>({});
  const [selected, setSelected] = useState<DriverLoc | null>(null);
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [addressLoading, setAddressLoading] = useState(false);
  const [, setTick] = useState(0);

  const driversList = useMemo(() => Object.values(drivers), [drivers]);

  // Auth guard
  useEffect(() => {
    if (!authLoading && !session) {
      navigate("/login");
    } else if (!authLoading && session && !isAdmin) {
      toast.error("Admin access required");
      navigate("/");
    }
  }, [authLoading, session, isAdmin, navigate]);

  // Load initial online drivers with names
  useEffect(() => {
    let mounted = true;

    async function loadOnline() {
      const { data, error } = await supabase
        .from("driver_locations")
        .select("*")
        .eq("is_online", true);

      if (error) {
        console.error("Failed to load drivers:", error);
        return;
      }

      if (!mounted || !data) return;

      // Fetch driver names and contact info
      const userIds = data.map((d) => d.user_id);
      const [{ data: profiles }, { data: driverProfiles }] = await Promise.all([
        supabase
          .from("profiles")
          .select("user_id, first_name, last_name, phone_number, email")
          .in("user_id", userIds),
        supabase
          .from("driver_profiles")
          .select("user_id, vehicle_make, vehicle_model, vehicle_color, license_plate")
          .in("user_id", userIds),
      ]);

      const profileMap = new Map<string, { name: string; phone: string | null; email: string | null }>();
      profiles?.forEach((p) => {
        const name = [p.first_name, p.last_name].filter(Boolean).join(" ") || "Driver";
        profileMap.set(p.user_id, { name, phone: p.phone_number, email: p.email });
      });

      const vehicleMap = new Map<string, { make: string | null; model: string | null; color: string | null; plate: string | null }>();
      driverProfiles?.forEach((dp) => {
        vehicleMap.set(dp.user_id, {
          make: dp.vehicle_make,
          model: dp.vehicle_model,
          color: dp.vehicle_color,
          plate: dp.license_plate,
        });
      });

      const next: Record<string, DriverLoc> = {};
      data.forEach((d) => {
        const profile = profileMap.get(d.user_id);
        const vehicle = vehicleMap.get(d.user_id);
        next[d.driver_id] = {
          ...d,
          display_name: profile?.name || null,
          phone_number: profile?.phone || null,
          email: profile?.email || null,
          vehicle_make: vehicle?.make || null,
          vehicle_model: vehicle?.model || null,
          vehicle_color: vehicle?.color || null,
          license_plate: vehicle?.plate || null,
        };
      });
      setDrivers(next);
    }

    loadOnline();
    return () => {
      mounted = false;
    };
  }, []);

  // Reverse geocode address when driver is selected
  useEffect(() => {
    if (!selected || !token) {
      setSelectedAddress(null);
      return;
    }

    let cancelled = false;
    setAddressLoading(true);
    setSelectedAddress(null);

    async function fetchAddress() {
      try {
        const res = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${selected!.lng},${selected!.lat}.json?access_token=${token}&limit=1`
        );
        const data = await res.json();
        if (!cancelled && data.features?.[0]?.place_name) {
          setSelectedAddress(data.features[0].place_name);
        }
      } catch (err) {
        console.error("Reverse geocode failed:", err);
      } finally {
        if (!cancelled) setAddressLoading(false);
      }
    }

    fetchAddress();
    return () => {
      cancelled = true;
    };
  }, [selected, token]);

  // Realtime updates
  useEffect(() => {
    const channel = supabase
      .channel("admin-driver-locations")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "driver_locations" },
        async (payload) => {
          const row = (payload.new ?? payload.old) as DriverLoc | undefined;
          if (!row?.driver_id) return;

          // Fetch name for new drivers
          let displayName: string | null = null;
          if (payload.eventType !== "DELETE" && row.is_online) {
            const { data: profile } = await supabase
              .from("profiles")
              .select("first_name, last_name")
              .eq("user_id", row.user_id)
              .maybeSingle();

            displayName = profile
              ? [profile.first_name, profile.last_name].filter(Boolean).join(" ") || "Driver"
              : null;
          }

          setDrivers((prev) => {
            const next = { ...prev };

            if (payload.eventType === "DELETE" || row.is_online === false) {
              delete next[row.driver_id];
              return next;
            }

            if (row.is_online === true) {
              next[row.driver_id] = {
                ...row,
                display_name: displayName || prev[row.driver_id]?.display_name || null,
              };
            }
            return next;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Tick for stale check
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 5000);
    return () => clearInterval(interval);
  }, []);

  const now = Date.now();
  const onlineCount = driversList.length;
  const staleCount = driversList.filter(
    (d) => Math.floor((now - new Date(d.updated_at).getTime()) / 1000) > STALE_THRESHOLD_SECONDS
  ).length;

  if (authLoading || tokenLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (tokenError || !token) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="container mx-auto px-4 py-8">
          <div className="text-center text-destructive">Failed to load map. Please try again later.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate("/admin")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Radio className="h-6 w-6 text-primary" />
                Live Drivers Map
              </h1>
              <p className="text-muted-foreground text-sm">Real-time driver tracking</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm">
              <Users className="h-4 w-4 text-emerald-500" />
              <span>{onlineCount} online</span>
            </div>
            {staleCount > 0 && (
              <div className="flex items-center gap-2 text-sm text-amber-500">
                <Clock className="h-4 w-4" />
                <span>{staleCount} stale</span>
              </div>
            )}
          </div>
        </div>

        {/* Map */}
        <div className="rounded-xl overflow-hidden border border-border shadow-lg h-[calc(100vh-200px)] min-h-[500px]">
          <MapGl
            mapboxAccessToken={token}
            initialViewState={{
              longitude: -73.5673,
              latitude: 45.5017,
              zoom: 11,
            }}
            style={{ width: "100%", height: "100%" }}
            mapStyle="mapbox://styles/mapbox/dark-v11"
            onClick={() => setSelected(null)}
          >
            <NavigationControl position="top-right" />

            {driversList.map((d) => {
              const ageSec = Math.floor((now - new Date(d.updated_at).getTime()) / 1000);
              const isStale = ageSec > STALE_THRESHOLD_SECONDS;

              return (
                <Marker
                  key={d.driver_id}
                  longitude={d.lng}
                  latitude={d.lat}
                  anchor="center"
                  onClick={(e) => {
                    e.originalEvent.stopPropagation();
                    setSelected(d);
                  }}
                >
                  <div
                    className={`w-8 h-8 rounded-full border-2 border-white flex items-center justify-center shadow-lg cursor-pointer transition-colors ${
                      isStale ? "bg-amber-500" : "bg-emerald-500"
                    }`}
                    style={{
                      transform: d.heading ? `rotate(${d.heading}deg)` : undefined,
                    }}
                  >
                    <Car className="h-4 w-4 text-white" />
                  </div>
                </Marker>
              );
            })}

            {selected && (
              <Popup
                longitude={selected.lng}
                latitude={selected.lat}
                anchor="bottom"
                onClose={() => setSelected(null)}
                closeOnClick={false}
                maxWidth="320px"
              >
                <div className="p-3 min-w-[280px] text-sm space-y-3">
                  {/* Header */}
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                      <Car className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1">
                      <div className="font-bold text-foreground text-base">
                        {selected.display_name ?? `Driver ${selected.driver_id.slice(0, 8)}`}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            selected.is_online ? "bg-green-500" : "bg-muted"
                          }`}
                        />
                        <span className="text-muted-foreground text-xs">
                          {selected.is_online ? "Online" : "Offline"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Current Location */}
                  <div className="bg-muted/50 rounded-lg p-2.5">
                    <div className="flex items-start gap-2">
                      <MapPin className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                      <div className="flex-1">
                        <div className="text-xs font-medium text-muted-foreground mb-0.5">Current Location</div>
                        {addressLoading ? (
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            <span className="text-xs">Loading address...</span>
                          </div>
                        ) : selectedAddress ? (
                          <div className="text-foreground text-sm leading-snug">{selectedAddress}</div>
                        ) : (
                          <div className="text-muted-foreground text-xs font-mono">
                            {selected.lat.toFixed(5)}, {selected.lng.toFixed(5)}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Contact Info */}
                  {(selected.phone_number || selected.email) && (
                    <div className="space-y-1.5">
                      {selected.phone_number && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Phone className="h-3.5 w-3.5" />
                          <span>{selected.phone_number}</span>
                        </div>
                      )}
                      {selected.email && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Mail className="h-3.5 w-3.5" />
                          <span className="truncate">{selected.email}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Vehicle Info */}
                  {(selected.vehicle_make || selected.license_plate) && (
                    <div className="border-t border-border pt-2.5">
                      <div className="text-xs font-medium text-muted-foreground mb-1">Vehicle</div>
                      <div className="flex items-center justify-between">
                        <span className="text-foreground">
                          {[selected.vehicle_color, selected.vehicle_make, selected.vehicle_model]
                            .filter(Boolean)
                            .join(" ") || "Unknown"}
                        </span>
                        {selected.license_plate && (
                          <span className="bg-muted px-2 py-0.5 rounded text-xs font-mono font-medium">
                            {selected.license_plate}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Stats */}
                  <div className="border-t border-border pt-2.5 flex items-center justify-between text-xs text-muted-foreground">
                    <span>Speed: {selected.speed_kph ? `${selected.speed_kph.toFixed(1)} km/h` : "—"}</span>
                    <span>Updated: {new Date(selected.updated_at).toLocaleTimeString()}</span>
                  </div>
                </div>
              </Popup>
            )}
          </MapGl>
        </div>

        {onlineCount === 0 && (
          <div className="mt-4 text-center text-muted-foreground">No drivers are currently online.</div>
        )}
      </div>
    </div>
  );
}