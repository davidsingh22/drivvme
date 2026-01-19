import { useRef, useEffect, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useMapboxToken } from '@/hooks/useMapboxToken';
import { AlertCircle, Loader2 } from 'lucide-react';

interface MapComponentProps {
  pickup?: { lat: number; lng: number } | null;
  dropoff?: { lat: number; lng: number } | null;
  driverLocation?: { lat: number; lng: number } | null;
  onMapClick?: (lat: number, lng: number) => void;
  showUserLocation?: boolean;
}

const defaultCenter: [number, number] = [-73.5673, 45.5017]; // Montreal [lng, lat]

// Animation duration in ms
const ANIMATION_DURATION = 1000;

// Lerp helper for smooth interpolation
const lerp = (start: number, end: number, t: number) => start + (end - start) * t;

// Easing function for smooth animation
const easeInOutCubic = (t: number) => 
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

// Calculate bearing between two points
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

const MapComponent = ({
  pickup,
  dropoff,
  driverLocation,
  onMapClick,
  showUserLocation = true,
}: MapComponentProps) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const pickupMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const dropoffMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const driverMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const driverMarkerElementRef = useRef<HTMLDivElement | null>(null);
  const userMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const previousDriverLocationRef = useRef<{ lat: number; lng: number } | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  const { token, loading, error } = useMapboxToken();

  // Get user location
  useEffect(() => {
    if (!showUserLocation) return;

    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
        },
        (err) => {
          console.log('Geolocation error:', err.message);
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    }
  }, [showUserLocation]);

  // Initialize map
  useEffect(() => {
    if (!token || !mapContainerRef.current || mapRef.current) return;

    mapboxgl.accessToken = token;

    const initialCenter = pickup
      ? [pickup.lng, pickup.lat]
      : userLocation
      ? [userLocation.lng, userLocation.lat]
      : defaultCenter;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: initialCenter as [number, number],
      zoom: 13,
    });

    map.addControl(new mapboxgl.NavigationControl(), 'top-right');

    map.on('load', () => {
      setMapLoaded(true);
    });

    map.on('click', (e) => {
      if (onMapClick) {
        onMapClick(e.lngLat.lat, e.lngLat.lng);
      }
    });

    mapRef.current = map;

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      map.remove();
      mapRef.current = null;
      setMapLoaded(false);
    };
  }, [token, onMapClick]);

  // Create driver marker element with rotation support
  const createDriverMarkerElement = useCallback(() => {
    const wrapper = document.createElement('div');
    wrapper.className = 'driver-marker-wrapper';
    wrapper.style.width = '48px';
    wrapper.style.height = '48px';
    wrapper.style.position = 'relative';
    wrapper.style.transition = 'transform 0.3s ease-out';

    const pulse = document.createElement('div');
    pulse.className = 'driver-pulse';
    pulse.style.position = 'absolute';
    pulse.style.inset = '0';
    pulse.style.borderRadius = '50%';
    pulse.style.backgroundColor = 'rgba(168, 85, 247, 0.3)';
    pulse.style.animation = 'pulse 2s infinite';
    
    const marker = document.createElement('div');
    marker.style.position = 'absolute';
    marker.style.top = '50%';
    marker.style.left = '50%';
    marker.style.transform = 'translate(-50%, -50%)';
    marker.style.width = '36px';
    marker.style.height = '36px';
    marker.style.borderRadius = '50%';
    marker.style.backgroundColor = '#a855f7';
    marker.style.border = '3px solid white';
    marker.style.boxShadow = '0 4px 14px rgba(168, 85, 247, 0.5)';
    marker.style.display = 'flex';
    marker.style.alignItems = 'center';
    marker.style.justifyContent = 'center';
    
    const arrow = document.createElement('div');
    arrow.className = 'driver-arrow';
    arrow.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/></svg>`;
    arrow.style.transition = 'transform 0.3s ease-out';
    
    marker.appendChild(arrow);
    wrapper.appendChild(pulse);
    wrapper.appendChild(marker);

    // Add pulse animation styles
    if (!document.getElementById('driver-marker-styles')) {
      const style = document.createElement('style');
      style.id = 'driver-marker-styles';
      style.textContent = `
        @keyframes pulse {
          0% { transform: scale(0.8); opacity: 1; }
          50% { transform: scale(1.2); opacity: 0.5; }
          100% { transform: scale(0.8); opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }

    return wrapper;
  }, []);

  // Create marker element helper
  const createMarkerElement = useCallback((color: string) => {
    const el = document.createElement('div');
    el.style.width = '24px';
    el.style.height = '24px';
    el.style.borderRadius = '50%';
    el.style.backgroundColor = color;
    el.style.border = '3px solid white';
    el.style.boxShadow = '0 2px 10px rgba(0,0,0,0.3)';
    return el;
  }, []);

  // Update user location marker
  useEffect(() => {
    if (!mapRef.current || !mapLoaded || !userLocation) return;

    if (userMarkerRef.current) {
      userMarkerRef.current.setLngLat([userLocation.lng, userLocation.lat]);
    } else {
      const el = document.createElement('div');
      el.style.width = '16px';
      el.style.height = '16px';
      el.style.borderRadius = '50%';
      el.style.backgroundColor = '#3b82f6';
      el.style.border = '3px solid white';
      el.style.boxShadow = '0 0 0 8px rgba(59, 130, 246, 0.2)';

      userMarkerRef.current = new mapboxgl.Marker(el)
        .setLngLat([userLocation.lng, userLocation.lat])
        .addTo(mapRef.current);
    }
  }, [userLocation, mapLoaded]);

  // Update pickup marker
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;

    if (pickup) {
      if (pickupMarkerRef.current) {
        pickupMarkerRef.current.setLngLat([pickup.lng, pickup.lat]);
      } else {
        pickupMarkerRef.current = new mapboxgl.Marker(createMarkerElement('#a855f7'))
          .setLngLat([pickup.lng, pickup.lat])
          .addTo(mapRef.current);
      }
    } else if (pickupMarkerRef.current) {
      pickupMarkerRef.current.remove();
      pickupMarkerRef.current = null;
    }
  }, [pickup, mapLoaded, createMarkerElement]);

  // Update dropoff marker
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;

    if (dropoff) {
      if (dropoffMarkerRef.current) {
        dropoffMarkerRef.current.setLngLat([dropoff.lng, dropoff.lat]);
      } else {
        dropoffMarkerRef.current = new mapboxgl.Marker(createMarkerElement('#84cc16'))
          .setLngLat([dropoff.lng, dropoff.lat])
          .addTo(mapRef.current);
      }
    } else if (dropoffMarkerRef.current) {
      dropoffMarkerRef.current.remove();
      dropoffMarkerRef.current = null;
    }
  }, [dropoff, mapLoaded, createMarkerElement]);

  // Update driver marker with smooth animation
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;

    if (driverLocation) {
      // Create marker if it doesn't exist
      if (!driverMarkerRef.current) {
        const el = createDriverMarkerElement();
        driverMarkerElementRef.current = el;
        driverMarkerRef.current = new mapboxgl.Marker(el)
          .setLngLat([driverLocation.lng, driverLocation.lat])
          .addTo(mapRef.current);
        previousDriverLocationRef.current = driverLocation;
        return;
      }

      const prevLocation = previousDriverLocationRef.current;
      
      // If we have a previous location, animate to new location
      if (prevLocation && (prevLocation.lat !== driverLocation.lat || prevLocation.lng !== driverLocation.lng)) {
        // Calculate bearing for arrow rotation
        const bearing = calculateBearing(prevLocation, driverLocation);
        
        // Update arrow rotation
        if (driverMarkerElementRef.current) {
          const arrow = driverMarkerElementRef.current.querySelector('.driver-arrow') as HTMLElement;
          if (arrow) {
            arrow.style.transform = `rotate(${bearing}deg)`;
          }
        }

        // Cancel any ongoing animation
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }

        const startTime = performance.now();
        const startLat = prevLocation.lat;
        const startLng = prevLocation.lng;
        const endLat = driverLocation.lat;
        const endLng = driverLocation.lng;

        const animate = (currentTime: number) => {
          const elapsed = currentTime - startTime;
          const progress = Math.min(elapsed / ANIMATION_DURATION, 1);
          const easedProgress = easeInOutCubic(progress);

          const currentLat = lerp(startLat, endLat, easedProgress);
          const currentLng = lerp(startLng, endLng, easedProgress);

          driverMarkerRef.current?.setLngLat([currentLng, currentLat]);

          if (progress < 1) {
            animationFrameRef.current = requestAnimationFrame(animate);
          } else {
            previousDriverLocationRef.current = driverLocation;
          }
        };

        animationFrameRef.current = requestAnimationFrame(animate);
      } else {
        // Just update position without animation (first render or same position)
        driverMarkerRef.current.setLngLat([driverLocation.lng, driverLocation.lat]);
        previousDriverLocationRef.current = driverLocation;
      }
    } else if (driverMarkerRef.current) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      driverMarkerRef.current.remove();
      driverMarkerRef.current = null;
      driverMarkerElementRef.current = null;
      previousDriverLocationRef.current = null;
    }
  }, [driverLocation, mapLoaded, createDriverMarkerElement]);

  // Draw route line between pickup and dropoff
  useEffect(() => {
    if (!mapRef.current || !mapLoaded || !pickup || !dropoff || !token) return;

    const fetchRoute = async () => {
      try {
        const response = await fetch(
          `https://api.mapbox.com/directions/v5/mapbox/driving/${pickup.lng},${pickup.lat};${dropoff.lng},${dropoff.lat}?geometries=geojson&access_token=${token}`
        );
        const data = await response.json();

        if (data.routes && data.routes[0]) {
          const route = data.routes[0].geometry;

          // Remove existing route layer and source
          if (mapRef.current?.getLayer('route')) {
            mapRef.current.removeLayer('route');
          }
          if (mapRef.current?.getSource('route')) {
            mapRef.current.removeSource('route');
          }

          // Add route source and layer
          mapRef.current?.addSource('route', {
            type: 'geojson',
            data: {
              type: 'Feature',
              properties: {},
              geometry: route,
            },
          });

          mapRef.current?.addLayer({
            id: 'route',
            type: 'line',
            source: 'route',
            layout: {
              'line-join': 'round',
              'line-cap': 'round',
            },
            paint: {
              'line-color': '#a855f7',
              'line-width': 5,
              'line-opacity': 0.8,
            },
          });

          // Fit map to show entire route
          const coordinates = route.coordinates;
          const bounds = coordinates.reduce(
            (bounds: mapboxgl.LngLatBounds, coord: [number, number]) => {
              return bounds.extend(coord);
            },
            new mapboxgl.LngLatBounds(coordinates[0], coordinates[0])
          );

          mapRef.current?.fitBounds(bounds, { padding: 50 });
        }
      } catch (err) {
        console.error('Error fetching route:', err);
      }
    };

    fetchRoute();

    return () => {
      if (mapRef.current?.getLayer('route')) {
        mapRef.current.removeLayer('route');
      }
      if (mapRef.current?.getSource('route')) {
        mapRef.current.removeSource('route');
      }
    };
  }, [pickup, dropoff, mapLoaded, token]);

  // Fit bounds when markers change
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;

    const points: [number, number][] = [];
    if (pickup) points.push([pickup.lng, pickup.lat]);
    if (dropoff) points.push([dropoff.lng, dropoff.lat]);
    if (driverLocation) points.push([driverLocation.lng, driverLocation.lat]);

    if (points.length >= 2) {
      const bounds = points.reduce(
        (bounds, coord) => bounds.extend(coord),
        new mapboxgl.LngLatBounds(points[0], points[0])
      );
      mapRef.current.fitBounds(bounds, { padding: 80 });
    } else if (points.length === 1) {
      mapRef.current.flyTo({ center: points[0], zoom: 14 });
    }
  }, [pickup, dropoff, driverLocation, mapLoaded]);

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-card">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading map...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-card p-4">
        <div className="max-w-md text-center space-y-3">
          <AlertCircle className="h-12 w-12 text-destructive mx-auto" />
          <p className="text-foreground font-medium">Map configuration error</p>
          <p className="text-sm text-muted-foreground">{error}</p>
          <p className="text-xs text-muted-foreground">
            Please ensure MAPBOX_ACCESS_TOKEN is configured in Cloud → Secrets
          </p>
        </div>
      </div>
    );
  }

  return (
    <div ref={mapContainerRef} className="w-full h-full" />
  );
};

export default MapComponent;
