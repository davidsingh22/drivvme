import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Clock, Navigation, MapPin, Route, Gauge } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { useLanguage } from '@/contexts/LanguageContext';
import { useMapboxToken } from '@/hooks/useMapboxToken';

interface LiveRideProgressProps {
  driverLocation: { lat: number; lng: number } | null;
  targetLocation: { lat: number; lng: number } | null;
  targetLabel: string;
  phase: 'arriving' | 'arrived' | 'inProgress';
}

interface RouteInfo {
  distanceKm: number;
  durationMinutes: number;
  lastUpdated: Date;
}

// Haversine formula for straight-line distance (fallback)
const haversineDistance = (
  lat1: number, lng1: number, 
  lat2: number, lng2: number
): number => {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const LiveRideProgress = ({
  driverLocation,
  targetLocation,
  targetLabel,
  phase,
}: LiveRideProgressProps) => {
  const { language } = useLanguage();
  const { token: mapboxToken } = useMapboxToken();
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const lastFetchRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Fetch route info from Mapbox Directions API
  useEffect(() => {
    if (!driverLocation || !targetLocation || !mapboxToken) {
      return;
    }

    // Create a key to avoid redundant fetches for same positions
    const fetchKey = `${driverLocation.lat.toFixed(4)},${driverLocation.lng.toFixed(4)}-${targetLocation.lat.toFixed(4)},${targetLocation.lng.toFixed(4)}`;
    
    // Skip if we already fetched for these coordinates
    if (lastFetchRef.current === fetchKey) {
      return;
    }

    // Cancel any pending request
    if (abortRef.current) {
      abortRef.current.abort();
    }

    const controller = new AbortController();
    abortRef.current = controller;

    const fetchRoute = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(
          `https://api.mapbox.com/directions/v5/mapbox/driving/${driverLocation.lng},${driverLocation.lat};${targetLocation.lng},${targetLocation.lat}?access_token=${mapboxToken}`,
          { signal: controller.signal }
        );
        
        const data = await response.json();
        
        if (data.routes?.[0]) {
          const route = data.routes[0];
          setRouteInfo({
            distanceKm: route.distance / 1000,
            durationMinutes: route.duration / 60,
            lastUpdated: new Date(),
          });
          lastFetchRef.current = fetchKey;
        }
      } catch (err) {
        if ((err as any)?.name === 'AbortError') return;
        
        // Fallback to Haversine if API fails
        const straightLine = haversineDistance(
          driverLocation.lat, driverLocation.lng,
          targetLocation.lat, targetLocation.lng
        );
        // Estimate road distance as ~1.3x straight line
        setRouteInfo({
          distanceKm: straightLine * 1.3,
          durationMinutes: (straightLine * 1.3) / 0.5, // Assume 30km/h average
          lastUpdated: new Date(),
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchRoute();

    return () => {
      controller.abort();
    };
  }, [driverLocation, targetLocation, mapboxToken]);

  // Format ETA as arrival time
  const formatETA = (minutes: number): string => {
    const arrivalTime = new Date(Date.now() + minutes * 60 * 1000);
    return arrivalTime.toLocaleTimeString(language === 'fr' ? 'fr-CA' : 'en-CA', {
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  // Format duration in a friendly way
  const formatDuration = (minutes: number): string => {
    if (minutes < 1) {
      return language === 'fr' ? '< 1 min' : '< 1 min';
    }
    if (minutes < 60) {
      return `${Math.round(minutes)} min`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return language === 'fr' ? `${hours}h ${mins}min` : `${hours}h ${mins}m`;
  };

  // Format distance
  const formatDistance = (km: number): string => {
    if (km < 1) {
      return `${Math.round(km * 1000)} m`;
    }
    return `${km.toFixed(1)} km`;
  };

  if (!driverLocation || !targetLocation) {
    return null;
  }

  const phaseConfig = {
    arriving: {
      icon: MapPin,
      color: 'text-primary',
      bgColor: 'bg-primary/10',
      borderColor: 'border-primary/30',
      label: language === 'fr' ? 'Chauffeur en route vers vous' : 'Driver heading to you',
    },
    arrived: {
      icon: MapPin,
      color: 'text-success',
      bgColor: 'bg-success/10',
      borderColor: 'border-success/30',
      label: language === 'fr' ? 'Chauffeur arrivé' : 'Driver arrived',
    },
    inProgress: {
      icon: Navigation,
      color: 'text-accent',
      bgColor: 'bg-accent/10',
      borderColor: 'border-accent/30',
      label: language === 'fr' ? 'En route vers destination' : 'Heading to destination',
    },
  };

  const config = phaseConfig[phase];
  const Icon = config.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-4"
    >
      <Card className={`p-4 ${config.bgColor} ${config.borderColor} border-2`}>
        {/* Phase Header */}
        <div className="flex items-center gap-2 mb-3">
          <div className={`p-2 rounded-full ${config.bgColor}`}>
            <Icon className={`h-4 w-4 ${config.color}`} />
          </div>
          <span className={`font-medium ${config.color}`}>{config.label}</span>
        </div>

        {/* Live Stats Grid */}
        <div className="grid grid-cols-3 gap-3">
          {/* ETA */}
          <div className="text-center p-3 bg-background/50 rounded-lg">
            <div className="flex items-center justify-center gap-1 mb-1">
              <Clock className="h-4 w-4 text-muted-foreground" />
            </div>
            {isLoading && !routeInfo ? (
              <div className="h-6 w-12 mx-auto bg-muted animate-pulse rounded" />
            ) : routeInfo ? (
              <>
                <p className="text-lg font-bold">{formatDuration(routeInfo.durationMinutes)}</p>
                <p className="text-xs text-muted-foreground">
                  {language === 'fr' ? 'Arrivée' : 'ETA'} {formatETA(routeInfo.durationMinutes)}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">--</p>
            )}
          </div>

          {/* Distance Remaining */}
          <div className="text-center p-3 bg-background/50 rounded-lg">
            <div className="flex items-center justify-center gap-1 mb-1">
              <Route className="h-4 w-4 text-muted-foreground" />
            </div>
            {isLoading && !routeInfo ? (
              <div className="h-6 w-12 mx-auto bg-muted animate-pulse rounded" />
            ) : routeInfo ? (
              <>
                <p className="text-lg font-bold">{formatDistance(routeInfo.distanceKm)}</p>
                <p className="text-xs text-muted-foreground">
                  {language === 'fr' ? 'Restant' : 'Remaining'}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">--</p>
            )}
          </div>

          {/* Live Indicator */}
          <div className="text-center p-3 bg-background/50 rounded-lg">
            <div className="flex items-center justify-center gap-1 mb-1">
              <Gauge className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="flex items-center justify-center gap-1.5">
              <motion.div
                animate={{ scale: [1, 1.2, 1] }}
                transition={{ duration: 1.5, repeat: Infinity }}
                className="w-2 h-2 rounded-full bg-success"
              />
              <p className="text-sm font-medium text-success">LIVE</p>
            </div>
            <p className="text-xs text-muted-foreground">
              {language === 'fr' ? 'Suivi actif' : 'Tracking'}
            </p>
          </div>
        </div>

        {/* Target location label */}
        <div className="mt-3 pt-3 border-t border-border/50">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Navigation className="h-3 w-3" />
            <span className="truncate">{targetLabel}</span>
          </div>
        </div>
      </Card>
    </motion.div>
  );
};

export default LiveRideProgress;
