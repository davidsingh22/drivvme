import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import Navbar from '@/components/Navbar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { 
  ArrowLeft, 
  RefreshCw, 
  User,
  MapPin,
  Phone,
  Mail,
  Car,
  DollarSign,
  Clock,
  Loader2,
  Radio
} from 'lucide-react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useMapboxToken } from '@/hooks/useMapboxToken';

interface OnlineRider {
  user_id: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  last_seen_at: string;
  is_online: boolean;
  profile?: {
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone_number: string | null;
    avatar_url: string | null;
  };
  stats?: {
    total_rides: number;
    total_spent: number;
  };
}

const STALE_THRESHOLD_MINUTES = 30; // visual badge only, not a filter

const LiveRidersMap = () => {
  const { user, isLoading: authLoading, roles } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { token: mapboxToken } = useMapboxToken();
  
  const [riders, setRiders] = useState<OnlineRider[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedRider, setSelectedRider] = useState<OnlineRider | null>(null);
  
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const popupRef = useRef<mapboxgl.Popup | null>(null);

  const isAdmin = roles.includes('admin' as any);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/login');
    } else if (!authLoading && !isAdmin) {
      navigate('/');
      toast({
        title: 'Access Denied',
        description: 'You do not have admin privileges.',
        variant: 'destructive',
      });
    }
  }, [user, authLoading, isAdmin, navigate, toast]);

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || !mapboxToken || mapRef.current) return;

    mapboxgl.accessToken = mapboxToken;
    
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [-73.5673, 45.5017], // Montreal
      zoom: 10,
    });

    map.addControl(new mapboxgl.NavigationControl(), 'top-right');
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [mapboxToken]);

  const fetchOnlineRiders = useCallback(async () => {
    try {
      setIsLoading(true);
      
      // Show riders who had activity in the last 10 minutes (app open or backgrounded)
      const recentThreshold = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      
      const { data: locations, error: locError } = await supabase
        .from('rider_locations')
        .select('*')
        .gte('last_seen_at', recentThreshold);

      if (locError) throw locError;

      if (!locations || locations.length === 0) {
        setRiders([]);
        setIsLoading(false);
        return;
      }

      const userIds = locations.map(l => l.user_id);

      const { data: profiles, error: profError } = await supabase
        .from('profiles')
        .select('user_id, first_name, last_name, email, phone_number, avatar_url')
        .in('user_id', userIds);

      if (profError) throw profError;

      const { data: rideStats, error: statsError } = await supabase
        .from('rides')
        .select('rider_id, actual_fare, estimated_fare, status')
        .in('rider_id', userIds);

      if (statsError) throw statsError;

      const statsMap: Record<string, { total_rides: number; total_spent: number }> = {};
      rideStats?.forEach(ride => {
        if (!ride.rider_id) return;
        if (!statsMap[ride.rider_id]) {
          statsMap[ride.rider_id] = { total_rides: 0, total_spent: 0 };
        }
        if (ride.status === 'completed') {
          statsMap[ride.rider_id].total_rides += 1;
          statsMap[ride.rider_id].total_spent += (ride.actual_fare || ride.estimated_fare || 0);
        }
      });

      const profilesMap: Record<string, any> = {};
      profiles?.forEach(p => {
        profilesMap[p.user_id] = p;
      });

      const onlineRiders: OnlineRider[] = locations.map(loc => ({
        user_id: loc.user_id,
        lat: loc.lat,
        lng: loc.lng,
        accuracy: loc.accuracy,
        last_seen_at: loc.last_seen_at,
        is_online: loc.is_online,
        profile: profilesMap[loc.user_id] || null,
        stats: statsMap[loc.user_id] || { total_rides: 0, total_spent: 0 }
      }));

      setRiders(onlineRiders);
    } catch (error: any) {
      console.error('Error fetching online riders:', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch online riders',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  // Update markers when riders change
  useEffect(() => {
    if (!mapRef.current) return;

    // Remove old markers
    markersRef.current.forEach((marker, id) => {
      if (!riders.find(r => r.user_id === id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    });

    // Add/update markers
    riders.forEach(rider => {
      const existing = markersRef.current.get(rider.user_id);
      
      if (existing) {
        existing.setLngLat([rider.lng, rider.lat]);
      } else {
        const el = document.createElement('div');
        el.innerHTML = `
          <div class="relative cursor-pointer">
            <div class="w-10 h-10 bg-purple-500 rounded-full flex items-center justify-center border-2 border-white shadow-lg">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
            </div>
            <div class="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-white animate-pulse"></div>
          </div>
        `;

        el.addEventListener('click', () => {
          setSelectedRider(rider);
          showPopup(rider);
        });

        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat([rider.lng, rider.lat])
          .addTo(mapRef.current!);

        markersRef.current.set(rider.user_id, marker);
      }
    });

    // Fit bounds if we have riders
    if (riders.length > 0 && mapRef.current) {
      const bounds = new mapboxgl.LngLatBounds();
      riders.forEach(r => bounds.extend([r.lng, r.lat]));
      mapRef.current.fitBounds(bounds, { padding: 50, maxZoom: 14 });
    }
  }, [riders]);

  const showPopup = (rider: OnlineRider) => {
    if (!mapRef.current) return;
    
    if (popupRef.current) {
      popupRef.current.remove();
    }

    const name = rider.profile?.first_name || rider.profile?.email?.split('@')[0] || 'Unknown';
    
    popupRef.current = new mapboxgl.Popup({ closeOnClick: true, offset: 25 })
      .setLngLat([rider.lng, rider.lat])
      .setHTML(`
        <div class="p-2 min-w-[180px]">
          <p class="font-medium text-sm">${name}</p>
          <p class="text-xs text-gray-500">${getTimeSinceLastSeen(rider.last_seen_at)}</p>
          <div class="mt-2 space-y-1 text-xs">
            <p>🚗 ${rider.stats?.total_rides || 0} rides</p>
            <p>💵 $${(rider.stats?.total_spent || 0).toFixed(2)} spent</p>
          </div>
        </div>
      `)
      .addTo(mapRef.current);
  };

  useEffect(() => {
    if (user && isAdmin) {
      fetchOnlineRiders();

      const channel = supabase
        .channel('rider-locations-realtime')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'rider_locations' },
          () => fetchOnlineRiders()
        )
        .subscribe();

      const interval = setInterval(fetchOnlineRiders, 30000);

      return () => {
        supabase.removeChannel(channel);
        clearInterval(interval);
      };
    }
  }, [user, isAdmin, fetchOnlineRiders]);

  const getTimeSinceLastSeen = (lastSeenAt: string) => {
    const seconds = Math.floor((Date.now() - new Date(lastSeenAt).getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
  };

  const getRiderName = (rider: OnlineRider) => {
    if (rider.profile?.first_name || rider.profile?.last_name) {
      return `${rider.profile.first_name || ''} ${rider.profile.last_name || ''}`.trim();
    }
    return rider.profile?.email?.split('@')[0] || 'Unknown Rider';
  };

  const getInitials = (rider: OnlineRider) => {
    if (rider.profile?.first_name && rider.profile?.last_name) {
      return `${rider.profile.first_name[0]}${rider.profile.last_name[0]}`.toUpperCase();
    }
    if (rider.profile?.email) {
      return rider.profile.email[0].toUpperCase();
    }
    return 'R';
  };

  const focusOnRider = (rider: OnlineRider) => {
    setSelectedRider(rider);
    if (mapRef.current) {
      mapRef.current.flyTo({ center: [rider.lng, rider.lat], zoom: 15 });
      showPopup(rider);
    }
  };

  if (authLoading || (!isAdmin && user)) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      <main className="container mx-auto px-4 py-8 pt-20">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate('/admin')}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                <Radio className="w-6 h-6 text-primary animate-pulse" />
                Live Riders
              </h1>
              <p className="text-muted-foreground">
                {riders.length} rider{riders.length !== 1 ? 's' : ''} online
              </p>
            </div>
          </div>
          <Button onClick={fetchOnlineRiders} disabled={isLoading} variant="outline">
            <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Map */}
          <Card className="overflow-hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Rider Locations</CardTitle>
              <CardDescription>Real-time location of active riders</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div ref={mapContainerRef} className="h-[500px] w-full" />
            </CardContent>
          </Card>

          {/* Riders Table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Online Riders</CardTitle>
              <CardDescription>Detailed information about active riders</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : riders.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <User className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>No riders currently online</p>
                  <p className="text-sm">Riders appear here when they open the app</p>
                </div>
              ) : (
                <div className="max-h-[450px] overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Rider</TableHead>
                        <TableHead>Contact</TableHead>
                        <TableHead>Stats</TableHead>
                        <TableHead>Last Seen</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {riders.map(rider => (
                        <TableRow 
                          key={rider.user_id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => focusOnRider(rider)}
                        >
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Avatar className="w-8 h-8">
                                <AvatarImage src={rider.profile?.avatar_url || undefined} />
                                <AvatarFallback>{getInitials(rider)}</AvatarFallback>
                              </Avatar>
                              <div>
                                <p className="font-medium text-sm">{getRiderName(rider)}</p>
                                <Badge variant="secondary" className="text-xs">
                                  <Radio className="w-2 h-2 mr-1 text-primary" />
                                  Online
                                </Badge>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1 text-xs">
                              {rider.profile?.email && (
                                <p className="flex items-center gap-1 text-muted-foreground">
                                  <Mail className="w-3 h-3" />
                                  {rider.profile.email}
                                </p>
                              )}
                              {rider.profile?.phone_number && (
                                <p className="flex items-center gap-1 text-muted-foreground">
                                  <Phone className="w-3 h-3" />
                                  {rider.profile.phone_number}
                                </p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1 text-xs">
                              <p className="flex items-center gap-1">
                                <Car className="w-3 h-3 text-primary" />
                                {rider.stats?.total_rides || 0} rides
                              </p>
                              <p className="flex items-center gap-1">
                                <DollarSign className="w-3 h-3 text-primary" />
                                ${(rider.stats?.total_spent || 0).toFixed(2)}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <p className="text-xs flex items-center gap-1 text-muted-foreground">
                              <Clock className="w-3 h-3" />
                              {getTimeSinceLastSeen(rider.last_seen_at)}
                            </p>
                          </TableCell>
                        </TableRow>
                      ))}
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
              <CardDescription>Online Riders</CardDescription>
              <CardTitle className="text-2xl text-primary">{riders.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Rides (Online)</CardDescription>
              <CardTitle className="text-2xl text-primary">
                {riders.reduce((sum, r) => sum + (r.stats?.total_rides || 0), 0)}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Spent (Online)</CardDescription>
              <CardTitle className="text-2xl text-primary">
                ${riders.reduce((sum, r) => sum + (r.stats?.total_spent || 0), 0).toFixed(2)}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Avg Spent/Rider</CardDescription>
              <CardTitle className="text-2xl text-primary">
                ${riders.length > 0 
                  ? (riders.reduce((sum, r) => sum + (r.stats?.total_spent || 0), 0) / riders.length).toFixed(2)
                  : '0.00'
                }
              </CardTitle>
            </CardHeader>
          </Card>
        </div>
      </main>
    </div>
  );
};

export default LiveRidersMap;
