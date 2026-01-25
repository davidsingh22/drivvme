import React, { useEffect, useMemo, useState, useCallback } from "react";
import MapGl, { Marker, Popup, NavigationControl } from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useMapboxToken } from "@/hooks/useMapboxToken";
import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { 
  ArrowLeft, 
  Radio, 
  Clock, 
  Car, 
  Phone, 
  Mail, 
  MapPin, 
  Loader2,
  DollarSign,
  Star,
  RefreshCw
} from "lucide-react";
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
  avatar_url?: string | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  vehicle_color?: string | null;
  license_plate?: string | null;
  total_rides?: number;
  total_earnings?: number;
  average_rating?: number;
};

const STALE_THRESHOLD_SECONDS = 60;

// Map common car color names to CSS colors
const getCarColor = (colorName: string | null | undefined): string => {
  if (!colorName) return "#a855f7"; // default purple
  const color = colorName.toLowerCase().trim();
  const colorMap: Record<string, string> = {
    black: "#1a1a1a",
    white: "#f5f5f5",
    silver: "#c0c0c0",
    gray: "#6b7280",
    grey: "#6b7280",
    red: "#ef4444",
    blue: "#3b82f6",
    navy: "#1e3a8a",
    green: "#22c55e",
    yellow: "#eab308",
    gold: "#ca8a04",
    orange: "#f97316",
    brown: "#92400e",
    beige: "#d4a574",
    purple: "#a855f7",
    pink: "#ec4899",
    maroon: "#7f1d1d",
    burgundy: "#722f37",
    tan: "#d2b48c",
    cream: "#fffdd0",
    champagne: "#f7e7ce",
  };
  return colorMap[color] || "#a855f7"; // fallback to purple
};

export default function AdminDriversLive() {
  const navigate = useNavigate();
  const { session, authLoading, isAdmin } = useAuth();
  const { token, loading: tokenLoading, error: tokenError } = useMapboxToken();
  const [drivers, setDrivers] = useState<Record<string, DriverLoc>>({});
  const [selected, setSelected] = useState<DriverLoc | null>(null);
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [addressLoading, setAddressLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [, setTick] = useState(0);
  const [mapViewState, setMapViewState] = useState({
    longitude: -73.5673,
    latitude: 45.5017,
    zoom: 11,
  });

  // Filter to only show active (non-stale) drivers
  const driversList = useMemo(() => {
    const now = Date.now();
    return Object.values(drivers).filter((d) => {
      const ageSec = Math.floor((now - new Date(d.updated_at).getTime()) / 1000);
      return ageSec <= STALE_THRESHOLD_SECONDS;
    });
  }, [drivers]);

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
  const loadOnlineDrivers = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("driver_locations")
        .select("*")
        .eq("is_online", true);

      if (error) {
        console.error("Failed to load drivers:", error);
        return;
      }

      if (!data) {
        setDrivers({});
        return;
      }

      // Fetch driver names and contact info
      const userIds = data.map((d) => d.user_id);
      const [{ data: profiles }, { data: driverProfiles }] = await Promise.all([
        supabase
          .from("profiles")
          .select("user_id, first_name, last_name, phone_number, email, avatar_url")
          .in("user_id", userIds),
        supabase
          .from("driver_profiles")
          .select("user_id, vehicle_make, vehicle_model, vehicle_color, license_plate, total_rides, total_earnings, average_rating, profile_picture_url")
          .in("user_id", userIds),
      ]);

      const profileMap = new Map<string, { name: string; phone: string | null; email: string | null; avatar: string | null }>();
      profiles?.forEach((p) => {
        const name = [p.first_name, p.last_name].filter(Boolean).join(" ") || "Driver";
        profileMap.set(p.user_id, { name, phone: p.phone_number, email: p.email, avatar: p.avatar_url });
      });

      const vehicleMap = new Map<string, { 
        make: string | null; 
        model: string | null; 
        color: string | null; 
        plate: string | null;
        total_rides: number;
        total_earnings: number;
        average_rating: number;
        profile_picture_url: string | null;
      }>();
      driverProfiles?.forEach((dp) => {
        vehicleMap.set(dp.user_id, {
          make: dp.vehicle_make,
          model: dp.vehicle_model,
          color: dp.vehicle_color,
          plate: dp.license_plate,
          total_rides: dp.total_rides || 0,
          total_earnings: Number(dp.total_earnings) || 0,
          average_rating: Number(dp.average_rating) || 5,
          profile_picture_url: dp.profile_picture_url,
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
          avatar_url: profile?.avatar || vehicle?.profile_picture_url || null,
          vehicle_make: vehicle?.make || null,
          vehicle_model: vehicle?.model || null,
          vehicle_color: vehicle?.color || null,
          license_plate: vehicle?.plate || null,
          total_rides: vehicle?.total_rides || 0,
          total_earnings: vehicle?.total_earnings || 0,
          average_rating: vehicle?.average_rating || 5,
        };
      });
      setDrivers(next);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOnlineDrivers();
  }, [loadOnlineDrivers]);

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

          // Fetch full profile and vehicle info for new/updated drivers
          let driverInfo: Partial<DriverLoc> = {};
          if (payload.eventType !== "DELETE" && row.is_online) {
            const [{ data: profile }, { data: driverProfile }] = await Promise.all([
              supabase
                .from("profiles")
                .select("first_name, last_name, phone_number, email, avatar_url")
                .eq("user_id", row.user_id)
                .maybeSingle(),
              supabase
                .from("driver_profiles")
                .select("vehicle_make, vehicle_model, vehicle_color, license_plate, total_rides, total_earnings, average_rating, profile_picture_url")
                .eq("user_id", row.user_id)
                .maybeSingle(),
            ]);

            driverInfo = {
              display_name: profile
                ? [profile.first_name, profile.last_name].filter(Boolean).join(" ") || "Driver"
                : null,
              phone_number: profile?.phone_number || null,
              email: profile?.email || null,
              avatar_url: profile?.avatar_url || driverProfile?.profile_picture_url || null,
              vehicle_make: driverProfile?.vehicle_make || null,
              vehicle_model: driverProfile?.vehicle_model || null,
              vehicle_color: driverProfile?.vehicle_color || null,
              license_plate: driverProfile?.license_plate || null,
              total_rides: driverProfile?.total_rides || 0,
              total_earnings: Number(driverProfile?.total_earnings) || 0,
              average_rating: Number(driverProfile?.average_rating) || 5,
            };
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
                ...driverInfo,
                display_name: driverInfo.display_name || prev[row.driver_id]?.display_name || null,
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

  const getTimeSinceLastSeen = (updatedAt: string) => {
    const seconds = Math.floor((Date.now() - new Date(updatedAt).getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
  };

  const getInitials = (driver: DriverLoc) => {
    if (driver.display_name) {
      const parts = driver.display_name.split(' ');
      if (parts.length >= 2) {
        return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
      }
      return driver.display_name[0].toUpperCase();
    }
    return 'D';
  };

  const focusOnDriver = (driver: DriverLoc) => {
    setSelected(driver);
    setMapViewState({
      longitude: driver.lng,
      latitude: driver.lat,
      zoom: 15,
    });
  };

  if (authLoading || tokenLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
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
      <main className="container mx-auto px-4 py-8 pt-20">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate("/admin")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Radio className="h-6 w-6 text-primary animate-pulse" />
                Live Drivers
              </h1>
              <p className="text-muted-foreground">
                {onlineCount} active driver{onlineCount !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
          <Button onClick={loadOnlineDrivers} disabled={isLoading} variant="outline">
            <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Map */}
          <Card className="overflow-hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Driver Locations</CardTitle>
              <CardDescription>Real-time location of active drivers</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="h-[500px] w-full">
                <MapGl
                  mapboxAccessToken={token}
                  {...mapViewState}
                  onMove={(evt) => setMapViewState(evt.viewState)}
                  style={{ width: "100%", height: "100%" }}
                  mapStyle="mapbox://styles/mapbox/dark-v11"
                  onClick={() => setSelected(null)}
                >
                  <NavigationControl position="top-right" />

                  {driversList.map((d) => {
                    const carColor = getCarColor(d.vehicle_color);

                    return (
                      <Marker
                        key={d.driver_id}
                        longitude={d.lng}
                        latitude={d.lat}
                        anchor="bottom"
                        onClick={(e) => {
                          e.originalEvent.stopPropagation();
                          setSelected(d);
                        }}
                      >
                        <div className="flex flex-col items-center cursor-pointer group">
                          {/* Car icon with driver's car color */}
                          <div
                            className="relative w-10 h-10 rounded-full border-2 border-border flex items-center justify-center transition-transform group-hover:scale-110"
                            style={{ backgroundColor: carColor }}
                          >
                            <Car className="h-5 w-5 text-primary-foreground" />
                            {/* Active pulse indicator */}
                            <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full border border-background animate-pulse" />
                          </div>
                          {/* Driver name */}
                          <div className="mt-1 px-2 py-0.5 bg-card border border-border rounded text-xs text-foreground font-medium max-w-[120px] truncate">
                            {d.display_name || "Driver"}
                          </div>
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
                      className="driver-popup"
                    >
                      <div className="p-4 min-w-[280px] text-sm space-y-3 bg-card rounded-lg border border-border">
                        {/* Header */}
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center">
                            <Car className="h-6 w-6 text-primary" />
                          </div>
                          <div className="flex-1">
                            <div className="font-bold text-foreground text-lg">
                              {selected.display_name ?? `Driver ${selected.driver_id.slice(0, 8)}`}
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`w-2.5 h-2.5 rounded-full ${
                                  selected.is_online ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" : "bg-muted"
                                }`}
                              />
                              <span className="text-muted-foreground text-xs font-medium">
                                {selected.is_online ? "Online" : "Offline"}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Current Location */}
                        <div className="bg-muted/50 border border-border rounded-lg p-3">
                          <div className="flex items-start gap-2">
                            <MapPin className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                            <div className="flex-1">
                              <div className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wide">Current Location</div>
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

                        {/* Stats */}
                        <div className="border-t border-border pt-3 flex items-center justify-between text-xs text-muted-foreground">
                          <span>Speed: <span className="text-primary font-medium">{selected.speed_kph ? `${selected.speed_kph.toFixed(1)} km/h` : "—"}</span></span>
                          <span>Updated: <span className="text-foreground">{new Date(selected.updated_at).toLocaleTimeString()}</span></span>
                        </div>
                      </div>
                    </Popup>
                  )}
                </MapGl>
              </div>
            </CardContent>
          </Card>

          {/* Drivers Table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Online Drivers</CardTitle>
              <CardDescription>Detailed information about active drivers</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : driversList.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Car className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>No drivers currently online</p>
                  <p className="text-sm">Drivers appear here when they go online</p>
                </div>
              ) : (
                <div className="max-h-[450px] overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Driver</TableHead>
                        <TableHead>Contact</TableHead>
                        <TableHead>Vehicle</TableHead>
                        <TableHead>Stats</TableHead>
                        <TableHead>Last Seen</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {driversList.map(driver => {
                        const ageSec = Math.floor((now - new Date(driver.updated_at).getTime()) / 1000);
                        const isStale = ageSec > STALE_THRESHOLD_SECONDS;
                        
                        return (
                          <TableRow 
                            key={driver.driver_id}
                            className="cursor-pointer hover:bg-muted/50"
                            onClick={() => focusOnDriver(driver)}
                          >
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Avatar className="w-8 h-8">
                                  <AvatarImage src={driver.avatar_url || undefined} />
                                  <AvatarFallback>{getInitials(driver)}</AvatarFallback>
                                </Avatar>
                                <div>
                                  <p className="font-medium text-sm">{driver.display_name || 'Driver'}</p>
                                  <Badge variant={isStale ? "outline" : "secondary"} className="text-xs">
                                    <Radio className={`w-2 h-2 mr-1 ${isStale ? 'text-destructive' : 'text-primary'}`} />
                                    {isStale ? 'Stale' : 'Online'}
                                  </Badge>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="space-y-1 text-xs">
                                {driver.email && (
                                  <p className="flex items-center gap-1 text-muted-foreground">
                                    <Mail className="w-3 h-3" />
                                    <span className="truncate max-w-[120px]">{driver.email}</span>
                                  </p>
                                )}
                                {driver.phone_number && (
                                  <p className="flex items-center gap-1 text-muted-foreground">
                                    <Phone className="w-3 h-3" />
                                    {driver.phone_number}
                                  </p>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="space-y-1 text-xs">
                                <p className="flex items-center gap-1">
                                  <Car className="w-3 h-3 text-primary" />
                                  {[driver.vehicle_color, driver.vehicle_make, driver.vehicle_model].filter(Boolean).join(' ') || 'Unknown'}
                                </p>
                                {driver.license_plate && (
                                  <p className="font-mono bg-muted px-1.5 py-0.5 rounded text-xs inline-block">
                                    {driver.license_plate}
                                  </p>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="space-y-1 text-xs">
                                <p className="flex items-center gap-1">
                                  <Car className="w-3 h-3 text-primary" />
                                  {driver.total_rides || 0} rides
                                </p>
                                <p className="flex items-center gap-1">
                                  <DollarSign className="w-3 h-3 text-primary" />
                                  ${(driver.total_earnings || 0).toFixed(2)}
                                </p>
                                <p className="flex items-center gap-1">
                                  <Star className="w-3 h-3 text-primary" />
                                  {(driver.average_rating || 5).toFixed(1)}
                                </p>
                              </div>
                            </TableCell>
                            <TableCell>
                              <p className="text-xs flex items-center gap-1 text-muted-foreground">
                                <Clock className="w-3 h-3" />
                                {getTimeSinceLastSeen(driver.updated_at)}
                              </p>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Online Drivers</CardDescription>
              <CardTitle className="text-2xl text-primary">{onlineCount}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Rides (Online)</CardDescription>
              <CardTitle className="text-2xl text-primary">
                {driversList.reduce((sum, d) => sum + (d.total_rides || 0), 0)}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Earnings (Online)</CardDescription>
              <CardTitle className="text-2xl text-primary">
                ${driversList.reduce((sum, d) => sum + (d.total_earnings || 0), 0).toFixed(2)}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Avg Rating</CardDescription>
              <CardTitle className="text-2xl text-primary flex items-center gap-1">
                <Star className="w-5 h-5 text-primary" />
                {driversList.length > 0 
                  ? (driversList.reduce((sum, d) => sum + (d.average_rating || 5), 0) / driversList.length).toFixed(1)
                  : '—'}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>
      </main>
    </div>
  );
}
