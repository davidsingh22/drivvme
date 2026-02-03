import { useRef, useEffect, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useMapboxToken, clearMapboxTokenCache } from '@/hooks/useMapboxToken';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

type GeoJSONSourceLike = mapboxgl.GeoJSONSource;

type RouteMode = 'pickup-dropoff' | 'driver-to-pickup' | 'driver-to-dropoff';

interface MapComponentProps {
  pickup?: { lat: number; lng: number } | null;
  dropoff?: { lat: number; lng: number } | null;
  driverLocation?: { lat: number; lng: number } | null;
  riderLocation?: { lat: number; lng: number } | null;
  routeMode?: RouteMode;
  onMapClick?: (lat: number, lng: number) => void;
  showUserLocation?: boolean;
  followDriver?: boolean;
  pickupAddress?: string;
  use3DStyle?: boolean;
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
  riderLocation,
  routeMode = 'pickup-dropoff',
  onMapClick,
  showUserLocation = true,
  followDriver = false,
  pickupAddress,
  use3DStyle = false,
}: MapComponentProps) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const pickupMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const dropoffMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const driverMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const driverMarkerElementRef = useRef<HTMLDivElement | null>(null);
  const riderMarkerRef = useRef<mapboxgl.Marker | null>(null);
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

  // Initialize map with rich, luxurious 3D effects
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
      // Use standard style for the most realistic, premium look
      style: use3DStyle ? 'mapbox://styles/mapbox/standard' : 'mapbox://styles/mapbox/dark-v11',
      center: initialCenter as [number, number],
      zoom: use3DStyle ? 17 : 16,
      pitch: use3DStyle ? 62 : 0,
      bearing: use3DStyle ? -25 : 0,
      antialias: true, // Smoother edges for premium feel
    });

    // Add terrain for realistic elevation
    if (use3DStyle) {
      map.on('style.load', () => {
        // Add terrain source for realistic hills and elevation
        if (!map.getSource('mapbox-dem')) {
          map.addSource('mapbox-dem', {
            'type': 'raster-dem',
            'url': 'mapbox://mapbox.mapbox-terrain-dem-v1',
            'tileSize': 512,
            'maxzoom': 14,
          });
          map.setTerrain({ 'source': 'mapbox-dem', 'exaggeration': 1.2 });
        }
      });
    }

    // Add map padding for bottom sheet visibility
    if (use3DStyle) {
      const bottomPadding = Math.round(window.innerHeight * 0.55);
      map.setPadding({ top: 80, bottom: bottomPadding, left: 30, right: 30 });
    }

    // Hide navigation controls for cleaner luxury feel
    // map.addControl(new mapboxgl.NavigationControl(), 'top-right');

    map.on('load', () => {
      setMapLoaded(true);
      
      // Add rich, luxurious 3D effects
      if (use3DStyle) {
        // Set golden hour lighting for warm, luxurious ambiance
        try {
          map.setConfigProperty('basemap', 'lightPreset', 'dusk');
          // Enable 3D buildings in standard style
          map.setConfigProperty('basemap', 'showPlaceLabels', true);
          map.setConfigProperty('basemap', 'showRoadLabels', true);
          map.setConfigProperty('basemap', 'showPointOfInterestLabels', true);
          map.setConfigProperty('basemap', 'showTransitLabels', false);
        } catch (e) {
          console.log('Standard style config not available, using fallback');
        }
        
        // Premium atmospheric fog with warm golden tones
        map.setFog({
          'color': 'rgb(45, 35, 55)', // Warm purple-gray base
          'high-color': 'rgb(80, 50, 90)', // Rich purple-rose sky
          'horizon-blend': 0.12, // Smooth horizon blend
          'space-color': 'rgb(25, 15, 35)', // Deep luxurious night sky
          'star-intensity': 0.25, // Subtle stars
        });

        // Add luxurious 3D building extrusions with realistic lighting
        if (!map.getLayer('3d-buildings')) {
          const layers = map.getStyle().layers;
          let labelLayerId: string | undefined;
          for (let i = 0; i < layers.length; i++) {
            if (layers[i].type === 'symbol' && (layers[i] as any).layout?.['text-field']) {
              labelLayerId = layers[i].id;
              break;
            }
          }

          map.addLayer(
            {
              'id': '3d-buildings',
              'source': 'composite',
              'source-layer': 'building',
              'filter': ['==', 'extrude', 'true'],
              'type': 'fill-extrusion',
              'minzoom': 14,
              'paint': {
                // Realistic building colors with warm evening glow
                'fill-extrusion-color': [
                  'interpolate',
                  ['linear'],
                  ['get', 'height'],
                  0, '#3d3545',    // Dark base - street level
                  20, '#4a4052',   // Low-rise warm gray
                  50, '#5a4d65',   // Mid-rise with purple hint
                  100, '#6b5878',  // High-rise elegant purple
                  150, '#7c658a',  // Skyscraper warm lavender
                  200, '#8d729c',  // Landmark buildings
                ],
                'fill-extrusion-height': ['get', 'height'],
                'fill-extrusion-base': ['get', 'min_height'],
                'fill-extrusion-opacity': 0.92,
                'fill-extrusion-vertical-gradient': true,
                // Add ambient occlusion for depth
                'fill-extrusion-ambient-occlusion-intensity': 0.4,
                'fill-extrusion-ambient-occlusion-radius': 3,
              },
            },
            labelLayerId
          );
        }

        // Add subtle road glow layer for premium feel
        if (!map.getLayer('road-glow')) {
          try {
            map.addLayer({
              'id': 'road-glow',
              'type': 'line',
              'source': 'composite',
              'source-layer': 'road',
              'filter': ['in', 'class', 'motorway', 'trunk', 'primary'],
              'paint': {
                'line-color': 'rgba(168, 85, 247, 0.15)',
                'line-width': 12,
                'line-blur': 8,
              },
            }, '3d-buildings');
          } catch (e) {
            // Road layer might not be available
          }
        }

        // Luxurious cinematic camera entrance animation
        setTimeout(() => {
          map.easeTo({
            pitch: 68,
            bearing: map.getBearing() + 20,
            zoom: map.getZoom() + 0.3,
            duration: 2500,
            easing: (t) => 1 - Math.pow(1 - t, 3), // Smooth ease out cubic
          });
        }, 300);
      }
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

  // Create driver marker element with prominent car icon
  const createDriverMarkerElement = useCallback(() => {
    const wrapper = document.createElement('div');
    wrapper.className = 'driver-marker-wrapper';
    wrapper.style.width = '70px';
    wrapper.style.height = '70px';
    wrapper.style.position = 'relative';

    const pulse = document.createElement('div');
    pulse.className = 'driver-pulse';
    pulse.style.position = 'absolute';
    pulse.style.inset = '0';
    pulse.style.borderRadius = '50%';
    pulse.style.backgroundColor = 'rgba(168, 85, 247, 0.3)';
    pulse.style.animation = 'driver-pulse 2s infinite';
    
    const marker = document.createElement('div');
    marker.className = 'driver-arrow';
    marker.style.position = 'absolute';
    marker.style.top = '50%';
    marker.style.left = '50%';
    marker.style.transform = 'translate(-50%, -50%)';
    marker.style.width = '54px';
    marker.style.height = '54px';
    marker.style.borderRadius = '50%';
    marker.style.backgroundColor = '#a855f7';
    marker.style.border = '4px solid white';
    marker.style.boxShadow = '0 6px 20px rgba(168, 85, 247, 0.7)';
    marker.style.display = 'flex';
    marker.style.alignItems = 'center';
    marker.style.justifyContent = 'center';
    marker.style.transition = 'transform 0.3s ease-out';
    
    // Large prominent car icon SVG
    marker.innerHTML = `<svg width="32" height="32" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
      <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/>
    </svg>`;

    // Add label
    const label = document.createElement('div');
    label.style.position = 'absolute';
    label.style.bottom = '-20px';
    label.style.left = '50%';
    label.style.transform = 'translateX(-50%)';
    label.style.backgroundColor = '#a855f7';
    label.style.color = 'white';
    label.style.padding = '2px 8px';
    label.style.borderRadius = '10px';
    label.style.fontSize = '10px';
    label.style.fontWeight = 'bold';
    label.style.whiteSpace = 'nowrap';
    label.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
    label.textContent = 'DRIVER';
    
    wrapper.appendChild(pulse);
    wrapper.appendChild(marker);
    wrapper.appendChild(label);

    // Add pulse animation styles
    if (!document.getElementById('driver-marker-styles')) {
      const style = document.createElement('style');
      style.id = 'driver-marker-styles';
      style.textContent = `
        @keyframes driver-pulse {
          0% { transform: scale(0.85); opacity: 1; }
          50% { transform: scale(1.2); opacity: 0.3; }
          100% { transform: scale(0.85); opacity: 1; }
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

  // Create teardrop pin marker with address label (for 3D style)
  const createTeardropMarker = useCallback((address?: string) => {
    const wrapper = document.createElement('div');
    wrapper.style.position = 'relative';
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    wrapper.style.alignItems = 'center';

    // Teardrop pin SVG
    const pin = document.createElement('div');
    pin.innerHTML = `
      <svg width="36" height="48" viewBox="0 0 36 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M18 0C8.059 0 0 8.059 0 18c0 13.5 18 30 18 30s18-16.5 18-30C36 8.059 27.941 0 18 0z" fill="#a855f7"/>
        <circle cx="18" cy="18" r="8" fill="white"/>
      </svg>
    `;
    pin.style.filter = 'drop-shadow(0 4px 12px rgba(168, 85, 247, 0.5))';
    wrapper.appendChild(pin);

    // Address pill below the pin
    if (address) {
      const pill = document.createElement('div');
      pill.style.marginTop = '4px';
      pill.style.backgroundColor = 'rgba(40, 40, 50, 0.95)';
      pill.style.color = 'white';
      pill.style.padding = '8px 14px';
      pill.style.borderRadius = '20px';
      pill.style.fontSize = '14px';
      pill.style.fontWeight = '500';
      pill.style.whiteSpace = 'nowrap';
      pill.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
      pill.style.maxWidth = '200px';
      pill.style.overflow = 'hidden';
      pill.style.textOverflow = 'ellipsis';
      pill.textContent = address.split(',')[0]; // Just the street address
      wrapper.appendChild(pill);
    }

    return wrapper;
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
      // Remove existing marker to recreate with potentially new address
      if (pickupMarkerRef.current) {
        pickupMarkerRef.current.remove();
        pickupMarkerRef.current = null;
      }
      
      // Use teardrop marker with address pill for 3D style, otherwise simple circle
      const markerElement = use3DStyle 
        ? createTeardropMarker(pickupAddress)
        : createMarkerElement('#a855f7');
      
      pickupMarkerRef.current = new mapboxgl.Marker(markerElement)
        .setLngLat([pickup.lng, pickup.lat])
        .addTo(mapRef.current);
    } else if (pickupMarkerRef.current) {
      pickupMarkerRef.current.remove();
      pickupMarkerRef.current = null;
    }
  }, [pickup, pickupAddress, mapLoaded, createMarkerElement, createTeardropMarker, use3DStyle]);

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

  // Create rider marker element with prominent person icon
  const createRiderMarkerElement = useCallback(() => {
    const wrapper = document.createElement('div');
    wrapper.className = 'rider-marker-wrapper';
    wrapper.style.width = '60px';
    wrapper.style.height = '60px';
    wrapper.style.position = 'relative';

    const pulse = document.createElement('div');
    pulse.className = 'rider-pulse';
    pulse.style.position = 'absolute';
    pulse.style.inset = '0';
    pulse.style.borderRadius = '50%';
    pulse.style.backgroundColor = 'rgba(59, 130, 246, 0.35)';
    pulse.style.animation = 'rider-pulse 2s infinite';
    
    const marker = document.createElement('div');
    marker.style.position = 'absolute';
    marker.style.top = '50%';
    marker.style.left = '50%';
    marker.style.transform = 'translate(-50%, -50%)';
    marker.style.width = '44px';
    marker.style.height = '44px';
    marker.style.borderRadius = '50%';
    marker.style.backgroundColor = '#3b82f6';
    marker.style.border = '4px solid white';
    marker.style.boxShadow = '0 6px 20px rgba(59, 130, 246, 0.6)';
    marker.style.display = 'flex';
    marker.style.alignItems = 'center';
    marker.style.justifyContent = 'center';
    
    // Car icon (so both driver + rider are shown as vehicles on the map)
    marker.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
      <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/>
    </svg>`;

    // Add label
    const label = document.createElement('div');
    label.style.position = 'absolute';
    label.style.bottom = '-20px';
    label.style.left = '50%';
    label.style.transform = 'translateX(-50%)';
    label.style.backgroundColor = '#3b82f6';
    label.style.color = 'white';
    label.style.padding = '2px 8px';
    label.style.borderRadius = '10px';
    label.style.fontSize = '10px';
    label.style.fontWeight = 'bold';
    label.style.whiteSpace = 'nowrap';
    label.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
    label.textContent = 'YOU';
    
    wrapper.appendChild(pulse);
    wrapper.appendChild(marker);
    wrapper.appendChild(label);

    // Add rider pulse animation styles
    if (!document.getElementById('rider-marker-styles')) {
      const style = document.createElement('style');
      style.id = 'rider-marker-styles';
      style.textContent = `
        @keyframes rider-pulse {
          0% { transform: scale(0.85); opacity: 1; }
          50% { transform: scale(1.2); opacity: 0.3; }
          100% { transform: scale(0.85); opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }

    return wrapper;
  }, []);

  // Update rider location marker (real-time during ride)
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;

    if (riderLocation) {
      if (riderMarkerRef.current) {
        riderMarkerRef.current.setLngLat([riderLocation.lng, riderLocation.lat]);
      } else {
        riderMarkerRef.current = new mapboxgl.Marker(createRiderMarkerElement())
          .setLngLat([riderLocation.lng, riderLocation.lat])
          .addTo(mapRef.current);
      }
    } else if (riderMarkerRef.current) {
      riderMarkerRef.current.remove();
      riderMarkerRef.current = null;
    }
  }, [riderLocation, mapLoaded, createRiderMarkerElement]);

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
            // Preserve centering translate while rotating (otherwise the marker can jump off-center)
            arrow.style.transform = `translate(-50%, -50%) rotate(${bearing}deg)`;
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

  // Draw route line based on routeMode
  useEffect(() => {
    if (!mapRef.current || !mapLoaded || !token) return;

    // Determine route start and end based on mode
    let routeStart: { lat: number; lng: number } | null = null;
    let routeEnd: { lat: number; lng: number } | null = null;

    switch (routeMode) {
      case 'driver-to-pickup':
        routeStart = driverLocation || null;
        routeEnd = pickup || null;
        break;
      case 'driver-to-dropoff':
        routeStart = driverLocation || null;
        routeEnd = dropoff || null;
        break;
      case 'pickup-dropoff':
      default:
        routeStart = pickup || null;
        routeEnd = dropoff || null;
        break;
    }

    // If we don't have both points, remove any existing route
    if (!routeStart || !routeEnd) {
      if (mapRef.current.getLayer('route')) mapRef.current.removeLayer('route');
      if (mapRef.current.getSource('route')) mapRef.current.removeSource('route');
      return;
    }

    const abort = new AbortController();

    const fetchRoute = async () => {
      try {
        const response = await fetch(
          `https://api.mapbox.com/directions/v5/mapbox/driving/${routeStart!.lng},${routeStart!.lat};${routeEnd!.lng},${routeEnd!.lat}?geometries=geojson&access_token=${token}`,
          { signal: abort.signal }
        );
        const data = await response.json();

        const route = data?.routes?.[0]?.geometry;
        if (!route) return;

        const feature: GeoJSON.Feature<GeoJSON.LineString> = {
          type: 'Feature',
          properties: {},
          geometry: route,
        };

        // Determine route color based on mode
        const routeColor = routeMode === 'driver-to-pickup' ? '#a855f7' : 
                           routeMode === 'driver-to-dropoff' ? '#84cc16' : '#a855f7';

        // Update existing source instead of removing/re-adding layers (reduces UI freezes on mobile).
        const existingSource = mapRef.current?.getSource('route') as GeoJSONSourceLike | undefined;
        if (existingSource) {
          existingSource.setData(feature as any);
          // Update line color if layer exists
          if (mapRef.current?.getLayer('route')) {
            mapRef.current.setPaintProperty('route', 'line-color', routeColor);
          }
          return;
        }

        mapRef.current?.addSource('route', {
          type: 'geojson',
          data: feature as any,
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
            'line-color': routeColor,
            'line-width': 5,
            'line-opacity': 0.8,
          },
        });
      } catch (err) {
        // Ignore abort errors
        if ((err as any)?.name === 'AbortError') return;
        console.error('Error fetching route:', err);
      }
    };

    fetchRoute();

    return () => abort.abort();
  }, [pickup, dropoff, driverLocation, routeMode, mapLoaded, token]);

  // Fit bounds when markers change OR follow driver mode
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;

    let raf = 0;

    raf = requestAnimationFrame(() => {
      // Follow driver mode: center on driver with smooth animation
      if (followDriver && driverLocation) {
        mapRef.current?.easeTo({
          center: [driverLocation.lng, driverLocation.lat],
          zoom: 17, // Street-level zoom to see exact location
          duration: 800,
        });
        return;
      }

      // Default: fit all points in view
      const points: [number, number][] = [];
      if (pickup) points.push([pickup.lng, pickup.lat]);
      if (dropoff) points.push([dropoff.lng, dropoff.lat]);
      if (driverLocation) points.push([driverLocation.lng, driverLocation.lat]);
      if (riderLocation) points.push([riderLocation.lng, riderLocation.lat]);

      if (points.length >= 2) {
        const bounds = points.reduce(
          (bounds, coord) => bounds.extend(coord),
          new mapboxgl.LngLatBounds(points[0], points[0])
        );
        mapRef.current?.fitBounds(bounds, { padding: 80, duration: 600, maxZoom: 17 });
      } else if (points.length === 1) {
        mapRef.current?.flyTo({ center: points[0], zoom: 17, duration: 600 });
      }
    });

    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [pickup, dropoff, driverLocation, riderLocation, mapLoaded, followDriver]);

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
    const handleRetry = () => {
      clearMapboxTokenCache();
      window.location.reload();
    };

    return (
      <div className="w-full h-full flex items-center justify-center bg-card p-4">
        <div className="max-w-md text-center space-y-3">
          <AlertCircle className="h-12 w-12 text-destructive mx-auto" />
          <p className="text-foreground font-medium">Map configuration error</p>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleRetry}
            className="mt-2"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div ref={mapContainerRef} className="w-full h-full" />
  );
};

export default MapComponent;
