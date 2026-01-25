import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useMapboxToken } from '@/hooks/useMapboxToken';
import Navbar from '@/components/Navbar';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Radio, Users, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';

interface DriverLocation {
  id: string;
  driver_id: string;
  user_id: string;
  lat: number;
  lng: number;
  heading: number | null;
  speed_kph: number | null;
  is_online: boolean;
  updated_at: string;
  driver_name?: string;
}

const STALE_THRESHOLD_MS = 60000; // 60 seconds

export default function AdminDriversLive() {
  const navigate = useNavigate();
  const { session, authLoading, isAdmin } = useAuth();
  const { token, loading: tokenLoading, error: tokenError } = useMapboxToken();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const [drivers, setDrivers] = useState<DriverLocation[]>([]);
  const [, setTick] = useState(0); // Force re-render for stale check

  // Auth guard
  useEffect(() => {
    if (!authLoading && !session) {
      navigate('/login');
    } else if (!authLoading && session && !isAdmin) {
      toast.error('Admin access required');
      navigate('/');
    }
  }, [authLoading, session, isAdmin, navigate]);

  // Fetch initial drivers and their names
  const fetchDrivers = useCallback(async () => {
    const { data, error } = await supabase
      .from('driver_locations')
      .select('*')
      .eq('is_online', true);

    if (error) {
      console.error('Error fetching drivers:', error);
      return;
    }

    // Fetch driver names from profiles
    const driverIds = data?.map(d => d.user_id) || [];
    if (driverIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, first_name, last_name')
        .in('user_id', driverIds);

      const nameMap = new Map<string, string>();
      profiles?.forEach(p => {
        const name = [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Driver';
        nameMap.set(p.user_id, name);
      });

      const driversWithNames = data?.map(d => ({
        ...d,
        driver_name: nameMap.get(d.user_id) || 'Driver'
      })) || [];

      setDrivers(driversWithNames);
    } else {
      setDrivers([]);
    }
  }, []);

  // Subscribe to realtime updates
  useEffect(() => {
    fetchDrivers();

    const channel = supabase
      .channel('admin-driver-locations')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'driver_locations'
        },
        async (payload) => {
          console.log('[AdminDriversLive] Realtime update:', payload);
          
          if (payload.eventType === 'DELETE') {
            setDrivers(prev => prev.filter(d => d.id !== (payload.old as any).id));
            return;
          }

          const newData = payload.new as DriverLocation;
          
          // Fetch driver name if needed
          const { data: profile } = await supabase
            .from('profiles')
            .select('first_name, last_name')
            .eq('user_id', newData.user_id)
            .single();

          const driverName = profile 
            ? [profile.first_name, profile.last_name].filter(Boolean).join(' ') || 'Driver'
            : 'Driver';

          setDrivers(prev => {
            const existing = prev.find(d => d.id === newData.id);
            if (existing) {
              return prev.map(d => d.id === newData.id 
                ? { ...newData, driver_name: driverName } 
                : d
              );
            } else if (newData.is_online) {
              return [...prev, { ...newData, driver_name: driverName }];
            }
            return prev.filter(d => d.id !== newData.id);
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchDrivers]);

  // Tick every 5s to update stale status
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 5000);
    return () => clearInterval(interval);
  }, []);

  // Initialize map
  useEffect(() => {
    if (!token || !mapContainerRef.current || mapRef.current) return;

    mapboxgl.accessToken = token;
    
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [-73.5673, 45.5017], // Montreal default
      zoom: 11
    });

    map.addControl(new mapboxgl.NavigationControl(), 'top-right');
    mapRef.current = map;

    return () => {
      markersRef.current.forEach(marker => marker.remove());
      markersRef.current.clear();
      map.remove();
      mapRef.current = null;
    };
  }, [token]);

  // Update markers when drivers change
  useEffect(() => {
    if (!mapRef.current) return;

    const onlineDrivers = drivers.filter(d => d.is_online);
    const currentIds = new Set(onlineDrivers.map(d => d.id));

    // Remove markers for drivers no longer online
    markersRef.current.forEach((marker, id) => {
      if (!currentIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    });

    // Update or add markers
    onlineDrivers.forEach(driver => {
      const isStale = Date.now() - new Date(driver.updated_at).getTime() > STALE_THRESHOLD_MS;
      const existingMarker = markersRef.current.get(driver.id);

      const popupContent = `
        <div class="p-2 min-w-[150px]">
          <div class="font-bold text-sm">${driver.driver_name}</div>
          <div class="flex items-center gap-1 mt-1">
            <span class="w-2 h-2 rounded-full ${isStale ? 'bg-yellow-500' : 'bg-green-500'}"></span>
            <span class="text-xs text-gray-400">${isStale ? 'Stale' : 'Online'}</span>
          </div>
          <div class="text-xs text-gray-400 mt-1">
            Updated ${formatDistanceToNow(new Date(driver.updated_at), { addSuffix: true })}
          </div>
          ${driver.speed_kph ? `<div class="text-xs text-gray-400">${driver.speed_kph.toFixed(0)} km/h</div>` : ''}
        </div>
      `;

      if (existingMarker) {
        existingMarker.setLngLat([driver.lng, driver.lat]);
        existingMarker.getPopup()?.setHTML(popupContent);
        // Update marker color based on stale status
        const el = existingMarker.getElement();
        if (el) {
          el.style.backgroundColor = isStale ? '#eab308' : '#22c55e';
        }
      } else {
        // Create new marker
        const el = document.createElement('div');
        el.className = 'driver-marker';
        el.style.cssText = `
          width: 32px;
          height: 32px;
          background-color: ${isStale ? '#eab308' : '#22c55e'};
          border: 3px solid white;
          border-radius: 50%;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        `;
        el.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/></svg>`;

        if (driver.heading !== null) {
          el.style.transform = `rotate(${driver.heading}deg)`;
        }

        const popup = new mapboxgl.Popup({ offset: 25 }).setHTML(popupContent);

        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat([driver.lng, driver.lat])
          .setPopup(popup)
          .addTo(mapRef.current!);

        markersRef.current.set(driver.id, marker);
      }
    });

    // Fit bounds if we have drivers
    if (onlineDrivers.length > 0 && mapRef.current) {
      const bounds = new mapboxgl.LngLatBounds();
      onlineDrivers.forEach(d => bounds.extend([d.lng, d.lat]));
      
      if (onlineDrivers.length === 1) {
        mapRef.current.easeTo({
          center: [onlineDrivers[0].lng, onlineDrivers[0].lat],
          zoom: 14
        });
      } else {
        mapRef.current.fitBounds(bounds, { padding: 80, maxZoom: 14 });
      }
    }
  }, [drivers]);

  const onlineCount = drivers.filter(d => d.is_online).length;
  const staleCount = drivers.filter(d => 
    d.is_online && Date.now() - new Date(d.updated_at).getTime() > STALE_THRESHOLD_MS
  ).length;

  if (authLoading || tokenLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (tokenError) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="container mx-auto px-4 py-8">
          <div className="text-center text-destructive">
            Failed to load map. Please try again later.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate('/admin')}>
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

        <div className="rounded-xl overflow-hidden border border-border shadow-lg">
          <div 
            ref={mapContainerRef} 
            className="w-full h-[calc(100vh-200px)] min-h-[500px]"
          />
        </div>

        {onlineCount === 0 && (
          <div className="mt-4 text-center text-muted-foreground">
            No drivers are currently online.
          </div>
        )}
      </div>
    </div>
  );
}