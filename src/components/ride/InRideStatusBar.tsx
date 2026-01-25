import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Clock, Navigation, MapPin, AlertCircle, Route, Wifi, WifiOff } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useMapboxToken } from '@/hooks/useMapboxToken';

type RidePhase = 'matched' | 'arriving' | 'arrived' | 'inProgress';

interface InRideStatusBarProps {
  phase: RidePhase;
  driverLocation: { lat: number; lng: number } | null;
  pickupLocation: { lat: number; lng: number } | null;
  dropoffLocation: { lat: number; lng: number } | null;
  lastUpdateSeconds?: number;
}

interface ETAInfo {
  minutes: number;
  distanceKm: number;
  isFallback: boolean;
}

// Refresh interval in ms
const REFRESH_INTERVAL = 10000;
const DISTANCE_THRESHOLD = 100; // 100 meters

// Haversine distance in meters
const getDistanceMeters = (
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number => {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// Fallback ETA calculation
const calculateFallbackETA = (
  driverLat: number, driverLng: number,
  targetLat: number, targetLng: number
): ETAInfo => {
  const distanceM = getDistanceMeters(driverLat, driverLng, targetLat, targetLng);
  const distanceKm = distanceM / 1000;
  // Assume 30 km/h average in city
  const avgSpeedKmh = 30;
  const minutes = Math.max(1, Math.round((distanceKm / avgSpeedKmh) * 60));
  return { minutes, distanceKm, isFallback: true };
};

const InRideStatusBar = ({
  phase,
  driverLocation,
  pickupLocation,
  dropoffLocation,
  lastUpdateSeconds = 0,
}: InRideStatusBarProps) => {
  const { language } = useLanguage();
  const { token: mapboxToken } = useMapboxToken();
  const [eta, setEta] = useState<ETAInfo | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastFetchPositionRef = useRef<{ lat: number; lng: number } | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Determine target based on phase
  const targetLocation = phase === 'inProgress' ? dropoffLocation : pickupLocation;

  const fetchETA = useCallback(async (force = false) => {
    if (!driverLocation || !targetLocation) return;

    // Check if we need to update based on distance
    if (!force && lastFetchPositionRef.current && eta) {
      const distance = getDistanceMeters(
        lastFetchPositionRef.current.lat,
        lastFetchPositionRef.current.lng,
        driverLocation.lat,
        driverLocation.lng
      );
      if (distance < DISTANCE_THRESHOLD) {
        return; // Not moved enough
      }
    }

    // If no token, use fallback
    if (!mapboxToken) {
      setEta(calculateFallbackETA(
        driverLocation.lat, driverLocation.lng,
        targetLocation.lat, targetLocation.lng
      ));
      lastFetchPositionRef.current = { lat: driverLocation.lat, lng: driverLocation.lng };
      return;
    }

    // Abort previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch(
        `https://api.mapbox.com/directions/v5/mapbox/driving/${driverLocation.lng},${driverLocation.lat};${targetLocation.lng},${targetLocation.lat}?access_token=${mapboxToken}`,
        { signal: abortControllerRef.current.signal }
      );
      const data = await response.json();

      if (data.routes?.[0]) {
        lastFetchPositionRef.current = { lat: driverLocation.lat, lng: driverLocation.lng };
        setEta({
          minutes: Math.max(1, Math.round(data.routes[0].duration / 60)),
          distanceKm: data.routes[0].distance / 1000,
          isFallback: false,
        });
        setLastUpdated(new Date());
      } else {
        // No routes, use fallback
        setEta(calculateFallbackETA(
          driverLocation.lat, driverLocation.lng,
          targetLocation.lat, targetLocation.lng
        ));
      }
    } catch (err) {
      if ((err as any)?.name !== 'AbortError') {
        console.error('ETA fetch error, using fallback:', err);
        // Use fallback on error
        setEta(calculateFallbackETA(
          driverLocation.lat, driverLocation.lng,
          targetLocation.lat, targetLocation.lng
        ));
      }
    }
  }, [driverLocation, targetLocation, mapboxToken, eta]);

  // Calculate initial fallback immediately when we have locations
  useEffect(() => {
    if (driverLocation && targetLocation && !eta) {
      setEta(calculateFallbackETA(
        driverLocation.lat, driverLocation.lng,
        targetLocation.lat, targetLocation.lng
      ));
    }
  }, [driverLocation, targetLocation, eta]);

  // Initial fetch and set up interval for live updates
  useEffect(() => {
    if (!driverLocation || !targetLocation) return;

    // Initial fetch (with actual API)
    fetchETA(true);

    // Set up interval for live updates
    intervalRef.current = setInterval(() => {
      fetchETA(true);
    }, REFRESH_INTERVAL);

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [driverLocation?.lat, driverLocation?.lng, targetLocation?.lat, targetLocation?.lng, fetchETA]);

  // Update ETA when driver moves significantly
  useEffect(() => {
    if (driverLocation && targetLocation) {
      fetchETA(false);
    }
  }, [driverLocation?.lat, driverLocation?.lng, fetchETA]);

  const getStatusConfig = () => {
    const etaMinutes = eta?.minutes ?? 1;
    
    switch (phase) {
      case 'matched':
        return {
          title: language === 'fr' ? 'Chauffeur trouvé' : 'Driver found',
          subtitle: language === 'fr' ? 'En route vers vous' : 'Heading to you',
          icon: Navigation,
          color: 'bg-primary',
        };
      case 'arriving':
        return {
          title: `${etaMinutes} min`,
          subtitle: language === 'fr' ? 'Le chauffeur arrive' : 'Driver arriving',
          icon: MapPin,
          color: 'bg-primary',
        };
      case 'arrived':
        return {
          title: language === 'fr' ? 'Arrivé' : 'Arrived',
          subtitle: language === 'fr' ? 'Le chauffeur vous attend' : 'Driver is waiting',
          icon: MapPin,
          color: 'bg-success',
        };
      case 'inProgress':
        return {
          title: `${etaMinutes} min`,
          subtitle: language === 'fr' ? 'Vers destination' : 'To destination',
          icon: Navigation,
          color: 'bg-accent',
        };
    }
  };

  const config = getStatusConfig();
  const Icon = config.icon;

  // Format ETA as arrival time
  const getArrivalTime = () => {
    const minutes = eta?.minutes ?? 1;
    const arrivalTime = new Date(Date.now() + minutes * 60 * 1000);
    return arrivalTime.toLocaleTimeString(language === 'fr' ? 'fr-CA' : 'en-CA', {
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  // Format distance
  const formatDistance = (km: number) => {
    if (km < 1) {
      return `${Math.round(km * 1000)} m`;
    }
    return `${km.toFixed(1)} km`;
  };

  // Connection status
  // "Live" when last driver updated_at < 8 seconds old
  const isStale = lastUpdateSeconds > 8;

  return (
    <motion.div
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="absolute top-4 left-4 right-4 z-10 space-y-2"
    >
      {/* Main status bar */}
      <div className={`${config.color} rounded-2xl px-4 py-3 shadow-lg backdrop-blur-sm`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-full">
              <Icon className="h-5 w-5 text-white" />
            </div>
            <div>
              <h3 className="text-white font-bold text-xl">{config.title}</h3>
              <p className="text-white/80 text-sm">{config.subtitle}</p>
            </div>
          </div>

          {eta && phase !== 'arrived' && (
            <div className="text-right">
              <div className="flex items-center gap-1 text-white/80 text-sm">
                <Clock className="h-3 w-3" />
                <span>{getArrivalTime()}</span>
              </div>
              <p className="text-white/60 text-xs">
                {formatDistance(eta.distanceKm)}
                {eta.isFallback && ' ~'}
              </p>
            </div>
          )}

          {phase === 'arrived' && (
            <motion.div
              animate={{ scale: [1, 1.1, 1] }}
              transition={{ duration: 1.5, repeat: Infinity }}
              className="flex items-center gap-1 bg-white/20 px-3 py-1 rounded-full"
            >
              <AlertCircle className="h-4 w-4 text-white" />
              <span className="text-white text-sm font-medium">
                {language === 'fr' ? 'Sortez' : 'Go now'}
              </span>
            </motion.div>
          )}
        </div>
      </div>

      {/* Live distance/time chip - only show during active movement phases */}
      {eta && (phase === 'arriving' || phase === 'inProgress') && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex justify-center"
        >
          <div className="bg-card/95 backdrop-blur-md rounded-full px-4 py-2 shadow-lg border border-border flex items-center gap-3">
            {/* Live indicator */}
            <div className="flex items-center gap-1.5">
              <motion.div
                animate={{ opacity: [1, 0.4, 1] }}
                transition={{ duration: 1.5, repeat: Infinity }}
                className={`w-2 h-2 rounded-full ${isStale ? 'bg-warning' : 'bg-success'}`}
              />
              <span className={`text-xs font-semibold uppercase tracking-wide ${isStale ? 'text-warning' : 'text-success'}`}>
                {isStale 
                  ? (language === 'fr' ? 'Connexion...' : 'Connecting...')
                  : (language === 'fr' ? 'En direct' : 'Live')
                }
              </span>
            </div>

            <div className="w-px h-4 bg-border" />

            {/* Distance */}
            <div className="flex items-center gap-1.5">
              <Route className="h-4 w-4 text-primary" />
              <span className="font-bold text-foreground">
                {formatDistance(eta.distanceKm)}
              </span>
            </div>

            <div className="w-px h-4 bg-border" />

            {/* Time */}
            <div className="flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="font-bold text-foreground">
                {eta.minutes} {language === 'fr' ? 'min' : 'min'}
              </span>
            </div>

            {/* Connection indicator */}
            {isStale && (
              <>
                <div className="w-px h-4 bg-border" />
                <WifiOff className="h-3.5 w-3.5 text-warning" />
              </>
            )}
          </div>
        </motion.div>
      )}
    </motion.div>
  );
};

export default InRideStatusBar;
