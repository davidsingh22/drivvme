import { useRef, useEffect, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useMapboxToken } from '@/hooks/useMapboxToken';
import { AlertCircle, Loader2, Navigation, MapPin, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import DriverRideActionBar from '@/components/DriverRideActionBar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useLanguage } from '@/contexts/LanguageContext';

interface NavigationStep {
  instruction: string;
  distance: number;
  duration: number;
  maneuver: string;
}

interface DriverNavigationMapProps {
  driverLocation: { lat: number; lng: number } | null;
  destination: { lat: number; lng: number; address: string };
  destinationType: 'pickup' | 'dropoff';
  rideStatus?: string;
  hideDestination?: boolean;
  onClose?: () => void;
  onArrived?: () => void;
  onStartRide?: () => void;
  onCompleteRide?: () => void;
  onCancelRide?: () => void;
  hasArrived?: boolean;
}

const DriverNavigationMap = ({
  driverLocation,
  destination,
  destinationType,
  rideStatus,
  hideDestination,
  onClose,
  onArrived,
  onStartRide,
  onCompleteRide,
  onCancelRide,
  hasArrived,
}: DriverNavigationMapProps) => {
  const { language } = useLanguage();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const driverMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const destinationMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [navigationSteps, setNavigationSteps] = useState<NavigationStep[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [totalDistance, setTotalDistance] = useState<number>(0);
  const [totalDuration, setTotalDuration] = useState<number>(0);
  const [isFollowing, setIsFollowing] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const previousLocationRef = useRef<{ lat: number; lng: number } | null>(null);

  // Use a ref for driver location to avoid re-running heavy effects on every GPS tick
  const driverLocationRef = useRef(driverLocation);
  driverLocationRef.current = driverLocation;

  // Track whether we've done the initial directions fetch
  const hasFetchedDirectionsRef = useRef(false);
  const lastDirectionsFetchRef = useRef(0);

  const { token, loading: tokenLoading, error: tokenError } = useMapboxToken();

  // --- GPS: acquire position lazily AFTER render (no blocking) ---
  const [localGPS, setLocalGPS] = useState<{ lat: number; lng: number } | null>(driverLocation);
  useEffect(() => {
    // If parent already provides location, use it
    if (driverLocation) {
      setLocalGPS(driverLocation);
      return;
    }
    // Otherwise start watching here (deferred, non-blocking)
    const wid = navigator.geolocation.watchPosition(
      (pos) => setLocalGPS({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => { /* silent */ },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 3000 }
    );
    return () => navigator.geolocation.clearWatch(wid);
  }, [!!driverLocation]);

  // Effective location: prefer parent prop, fallback to local
  const effectiveLocation = driverLocation ?? localGPS;

  const calculateBearing = (
    start: { lat: number; lng: number },
    end: { lat: number; lng: number }
  ): number => {
    const startLat = (start.lat * Math.PI) / 180;
    const startLng = (start.lng * Math.PI) / 180;
    const endLat = (end.lat * Math.PI) / 180;
    const endLng = (end.lng * Math.PI) / 180;
    const dLng = endLng - startLng;
    const x = Math.sin(dLng) * Math.cos(endLat);
    const y = Math.cos(startLat) * Math.sin(endLat) - Math.sin(startLat) * Math.cos(endLat) * Math.cos(dLng);
    let bearing = (Math.atan2(x, y) * 180) / Math.PI;
    return (bearing + 360) % 360;
  };

  const formatDistanceLabel = (meters: number): string => {
    if (meters < 1000) return `${Math.round(meters)} m`;
    return `${(meters / 1000).toFixed(1)} km`;
  };

  const formatDurationLabel = (seconds: number): string => {
    const mins = Math.round(seconds / 60);
    if (mins < 60) return `${mins} min`;
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return `${hours}h ${remainingMins}m`;
  };

  const createDriverMarkerElement = useCallback(() => {
    const wrapper = document.createElement('div');
    wrapper.className = 'nav-driver-marker';
    wrapper.style.width = '48px';
    wrapper.style.height = '48px';
    wrapper.style.position = 'relative';

    const pulse = document.createElement('div');
    pulse.style.position = 'absolute';
    pulse.style.inset = '0';
    pulse.style.borderRadius = '50%';
    pulse.style.backgroundColor = 'rgba(59, 130, 246, 0.3)';
    pulse.style.animation = 'nav-pulse 2s infinite';

    const arrow = document.createElement('div');
    arrow.className = 'nav-arrow';
    arrow.style.position = 'absolute';
    arrow.style.top = '50%';
    arrow.style.left = '50%';
    arrow.style.transform = 'translate(-50%, -50%)';
    arrow.style.width = '36px';
    arrow.style.height = '36px';
    arrow.style.borderRadius = '50%';
    arrow.style.backgroundColor = '#3b82f6';
    arrow.style.border = '3px solid white';
    arrow.style.boxShadow = '0 4px 14px rgba(59, 130, 246, 0.5)';
    arrow.style.display = 'flex';
    arrow.style.alignItems = 'center';
    arrow.style.justifyContent = 'center';
    arrow.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/></svg>`;

    wrapper.appendChild(pulse);
    wrapper.appendChild(arrow);

    if (!document.getElementById('nav-marker-styles')) {
      const style = document.createElement('style');
      style.id = 'nav-marker-styles';
      style.textContent = `
        @keyframes nav-pulse {
          0% { transform: scale(0.9); opacity: 1; }
          50% { transform: scale(1.2); opacity: 0.4; }
          100% { transform: scale(0.9); opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }

    return wrapper;
  }, []);

  const createDestinationMarkerElement = useCallback(() => {
    const el = document.createElement('div');
    el.style.width = '32px';
    el.style.height = '32px';
    el.style.borderRadius = '50%';
    el.style.backgroundColor = destinationType === 'pickup' ? '#a855f7' : '#22c55e';
    el.style.border = '3px solid white';
    el.style.boxShadow = '0 4px 14px rgba(0,0,0,0.3)';
    el.style.display = 'flex';
    el.style.alignItems = 'center';
    el.style.justifyContent = 'center';
    el.innerHTML = destinationType === 'pickup'
      ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="white"><circle cx="12" cy="8" r="4"/><path d="M12 14c-4.42 0-8 1.79-8 4v2h16v-2c0-2.21-3.58-4-8-4z"/></svg>`
      : `<svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/></svg>`;
    return el;
  }, [destinationType]);

  // Initialize map (non-blocking, after render)
  useEffect(() => {
    if (!token || !mapContainerRef.current || mapRef.current) return;

    mapboxgl.accessToken = token;

    const center = effectiveLocation
      ? [effectiveLocation.lng, effectiveLocation.lat]
      : [destination.lng, destination.lat];

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/navigation-night-v1',
      center: center as [number, number],
      zoom: 16,
      pitch: 60,
      bearing: 0,
    });

    map.on('load', () => setMapLoaded(true));
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      setMapLoaded(false);
    };
  }, [token]);

  // Fetch directions (throttled to every 10s)
  const fetchDirections = useCallback(async () => {
    const loc = driverLocationRef.current ?? localGPS;
    if (!token || !loc) return;

    const now = Date.now();
    if (hasFetchedDirectionsRef.current && now - lastDirectionsFetchRef.current < 10000) return;
    lastDirectionsFetchRef.current = now;
    hasFetchedDirectionsRef.current = true;

    try {
      const response = await fetch(
        `https://api.mapbox.com/directions/v5/mapbox/driving/${loc.lng},${loc.lat};${destination.lng},${destination.lat}?steps=true&geometries=geojson&access_token=${token}`
      );
      const data = await response.json();

      if (data.routes?.[0]) {
        const route = data.routes[0];
        setTotalDistance(route.distance);
        setTotalDuration(route.duration);
        setNavigationSteps(route.legs[0].steps.map((step: any) => ({
          instruction: step.maneuver.instruction,
          distance: step.distance,
          duration: step.duration,
          maneuver: step.maneuver.type,
        })));

        if (mapRef.current && mapLoaded) {
          const geojson: GeoJSON.Feature<GeoJSON.LineString> = {
            type: 'Feature',
            properties: {},
            geometry: route.geometry,
          };
          const source = mapRef.current.getSource('nav-route') as mapboxgl.GeoJSONSource;
          if (source) {
            source.setData(geojson);
          } else {
            mapRef.current.addSource('nav-route', { type: 'geojson', data: geojson });
            mapRef.current.addLayer({
              id: 'nav-route-bg',
              type: 'line',
              source: 'nav-route',
              layout: { 'line-join': 'round', 'line-cap': 'round' },
              paint: { 'line-color': '#1e3a5f', 'line-width': 12 },
            });
            mapRef.current.addLayer({
              id: 'nav-route',
              type: 'line',
              source: 'nav-route',
              layout: { 'line-join': 'round', 'line-cap': 'round' },
              paint: {
                'line-color': destinationType === 'pickup' ? '#a855f7' : '#22c55e',
                'line-width': 6,
              },
            });
          }
        }
      }
    } catch (err) {
      console.error('Failed to fetch directions:', err);
    }
  }, [token, destination, destinationType, mapLoaded, localGPS]);

  // Fetch directions once map is loaded, then periodically
  useEffect(() => {
    if (!mapLoaded) return;
    fetchDirections();
    const id = setInterval(fetchDirections, 10000);
    return () => clearInterval(id);
  }, [mapLoaded, fetchDirections]);

  // Update driver marker via ref (no state-driven re-render)
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;

    const id = setInterval(() => {
      const loc = driverLocationRef.current ?? localGPS;
      if (!loc) return;

      if (!driverMarkerRef.current) {
        driverMarkerRef.current = new mapboxgl.Marker(createDriverMarkerElement())
          .setLngLat([loc.lng, loc.lat])
          .addTo(mapRef.current!);
      } else {
        driverMarkerRef.current.setLngLat([loc.lng, loc.lat]);
      }

      if (previousLocationRef.current) {
        const bearing = calculateBearing(previousLocationRef.current, loc);
        const arrow = document.querySelector('.nav-arrow') as HTMLElement;
        if (arrow) arrow.style.transform = `translate(-50%, -50%) rotate(${bearing}deg)`;
      }

      if (isFollowing && mapRef.current) {
        const bearing = calculateBearing(loc, destination);
        mapRef.current.easeTo({
          center: [loc.lng, loc.lat],
          bearing,
          duration: 1000,
        });
      }

      previousLocationRef.current = loc;
    }, 2000);

    return () => clearInterval(id);
  }, [mapLoaded, isFollowing, destination, createDriverMarkerElement, localGPS]);

  // Add destination marker
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;
    if (!destinationMarkerRef.current) {
      destinationMarkerRef.current = new mapboxgl.Marker(createDestinationMarkerElement())
        .setLngLat([destination.lng, destination.lat])
        .addTo(mapRef.current);
    }
  }, [destination, mapLoaded, createDestinationMarkerElement]);

  const recenterCamera = () => {
    const loc = driverLocationRef.current ?? localGPS;
    if (!mapRef.current || !loc) return;
    setIsFollowing(true);
    const bearing = calculateBearing(loc, destination);
    mapRef.current.flyTo({
      center: [loc.lng, loc.lat],
      zoom: 16,
      pitch: 60,
      bearing,
      duration: 1000,
    });
  };

  const getManeuverIcon = (maneuver: string) => {
    switch (maneuver) {
      case 'turn-left': return '↰';
      case 'turn-right': return '↱';
      case 'sharp-left': return '↲';
      case 'sharp-right': return '↳';
      case 'slight-left': return '↖';
      case 'slight-right': return '↗';
      case 'straight': return '↑';
      case 'arrive': return '🏁';
      default: return '→';
    }
  };

  const currentStep = navigationSteps[currentStepIndex];

  // Action buttons are always rendered, even during loading states
  const actionButtons = (
    <div className="space-y-2">
      {onArrived && onStartRide && onCompleteRide && onCancelRide && (
        <DriverRideActionBar
          rideStatus={rideStatus}
          onArrived={onArrived}
          onStartRide={onStartRide}
          onCompleteRide={onCompleteRide}
          onCancelRide={onCancelRide}
          compact
        />
      )}
      <div className="flex items-center gap-2">
        {onClose && (
          <Button
            variant="outline"
            className="flex-1 h-10 bg-white/10 hover:bg-white/20 border-white/20 text-white text-sm"
            onClick={onClose}
          >
            {language === 'fr' ? 'Fermer' : 'Exit Navigation'}
          </Button>
        )}
      </div>
    </div>
  );

  // Show GPS screen immediately with loading overlay if map/token still loading
  const isMapReady = mapLoaded && !tokenLoading && !tokenError;

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Loading overlay — map renders behind it */}
      {!isMapReady && (
        <div className="absolute inset-0 z-20 bg-background/90 flex flex-col items-center justify-center p-4">
          {tokenError ? (
            <>
              <AlertCircle className="h-10 w-10 text-destructive mb-4" />
              <p className="text-center text-muted-foreground mb-6">{tokenError}</p>
            </>
          ) : (
            <>
              <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
              <p className="text-muted-foreground text-sm mb-6">
                {language === 'fr' ? 'Chargement GPS...' : 'Loading GPS...'}
              </p>
            </>
          )}
          <div className="w-full max-w-sm">
            {actionButtons}
            {tokenError && (
              <Button
                variant="outline"
                className="w-full mt-2"
                onClick={() => {
                  import('@/hooks/useMapboxToken').then(m => {
                    m.clearMapboxTokenCache();
                    window.location.reload();
                  });
                }}
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                {language === 'fr' ? 'Réessayer' : 'Retry'}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Navigation Header */}
      {isMapReady && (
        <div className="absolute top-0 left-0 right-0 z-10 p-3 bg-gradient-to-b from-black/80 to-transparent">
          {currentStep && (
            <Card className="p-3 bg-black/90 border-primary/30 backdrop-blur-sm">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center text-2xl">
                  {getManeuverIcon(currentStep.maneuver)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-base font-bold text-white truncate">{currentStep.instruction}</p>
                  <p className="text-xs text-muted-foreground">{formatDistanceLabel(currentStep.distance)}</p>
                </div>
              </div>
            </Card>
          )}
          <div className="flex items-center justify-between mt-2 px-1">
            <Badge variant="secondary" className="text-xs py-0.5 px-2">
              <Navigation className="h-3 w-3 mr-1" />
              {formatDistanceLabel(totalDistance)}
            </Badge>
            <Badge variant="secondary" className="text-xs py-0.5 px-2">
              ⏱ {formatDurationLabel(totalDuration)}
            </Badge>
            <Badge className={`text-xs py-0.5 px-2 ${
              destinationType === 'pickup'
                ? 'bg-primary/20 text-primary'
                : 'bg-green-500/20 text-green-400'
            }`}>
              {destinationType === 'pickup'
                ? (language === 'fr' ? 'Ramassage' : 'Pickup')
                : (language === 'fr' ? 'Dépose' : 'Dropoff')}
            </Badge>
          </div>
        </div>
      )}

      {/* Map container — always rendered so it initializes in background */}
      <div ref={mapContainerRef} className="flex-1 w-full" />

      {/* Bottom controls */}
      {isMapReady && (
        <div className="absolute bottom-0 left-0 right-0 z-10 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-gradient-to-t from-black via-black/95 to-transparent">
          <div className="flex items-center gap-2 mb-2 px-2 py-1.5 rounded-lg bg-black/80 border border-white/10">
             <MapPin className={`h-4 w-4 shrink-0 ${
              destinationType === 'pickup' ? 'text-primary' : 'text-green-400'
            }`} />
            <p className="text-xs text-white truncate flex-1">
              {hideDestination 
                ? (language === 'fr' ? 'Destination révélée au démarrage' : 'Destination revealed at start')
                : destination.address}
            </p>
          </div>

          <div className="space-y-2">
            {onArrived && onStartRide && onCompleteRide && onCancelRide && (
              <DriverRideActionBar
                rideStatus={rideStatus}
                onArrived={onArrived}
                onStartRide={onStartRide}
                onCompleteRide={onCompleteRide}
                onCancelRide={onCancelRide}
                compact
              />
            )}
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="icon"
                className="h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 shrink-0"
                onClick={() => setIsMuted(!isMuted)}
              >
                {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </Button>
              <Button
                variant="secondary"
                size="icon"
                className="h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 shrink-0"
                onClick={recenterCamera}
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
              {onClose && (
                <Button
                  variant="outline"
                  className="flex-1 h-10 bg-white/10 hover:bg-white/20 border-white/20 text-white text-sm"
                  onClick={onClose}
                >
                  {language === 'fr' ? 'Fermer' : 'Exit Navigation'}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Next steps preview */}
      {isMapReady && navigationSteps.length > 1 && currentStepIndex < navigationSteps.length - 1 && (
        <div className="absolute right-3 top-36 z-10 w-44">
          <Card className="p-2 bg-black/70 border-white/10 backdrop-blur-sm">
            <p className="text-[10px] text-muted-foreground mb-1">
              {language === 'fr' ? 'Ensuite' : 'Then'}
            </p>
            {navigationSteps.slice(currentStepIndex + 1, currentStepIndex + 3).map((step, idx) => (
              <div key={idx} className="flex items-center gap-2 py-1 text-xs text-white/70">
                <span>{getManeuverIcon(step.maneuver)}</span>
                <span className="truncate">{step.instruction}</span>
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  );
};

export default DriverNavigationMap;
