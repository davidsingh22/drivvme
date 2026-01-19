import { useRef, useCallback, useState } from 'react';
import { GoogleMap, useJsApiLoader, Marker, DirectionsRenderer } from '@react-google-maps/api';
import { GOOGLE_MAPS_API_KEY } from '@/lib/googleMaps';

const libraries: ("places" | "geometry" | "drawing" | "visualization")[] = ["places"];

const mapContainerStyle = {
  width: '100%',
  height: '100%',
};

const defaultCenter = {
  lat: 45.5017, // Montreal
  lng: -73.5673,
};

const darkMapStyles = [
  { elementType: "geometry", stylers: [{ color: "#1a1a2e" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#1a1a2e" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8a8a8a" }] },
  {
    featureType: "administrative.locality",
    elementType: "labels.text.fill",
    stylers: [{ color: "#d4d4d4" }],
  },
  {
    featureType: "poi",
    elementType: "labels.text.fill",
    stylers: [{ color: "#8a8a8a" }],
  },
  {
    featureType: "poi.park",
    elementType: "geometry",
    stylers: [{ color: "#1e3a2f" }],
  },
  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ color: "#2d2d44" }],
  },
  {
    featureType: "road",
    elementType: "geometry.stroke",
    stylers: [{ color: "#1a1a2e" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry",
    stylers: [{ color: "#3d3d5c" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry.stroke",
    stylers: [{ color: "#1a1a2e" }],
  },
  {
    featureType: "transit",
    elementType: "geometry",
    stylers: [{ color: "#2d2d44" }],
  },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#0e1626" }],
  },
  {
    featureType: "water",
    elementType: "labels.text.fill",
    stylers: [{ color: "#4a4a6a" }],
  },
];

interface MapComponentProps {
  pickup?: { lat: number; lng: number } | null;
  dropoff?: { lat: number; lng: number } | null;
  driverLocation?: { lat: number; lng: number } | null;
  onMapClick?: (lat: number, lng: number) => void;
  directions?: google.maps.DirectionsResult | null;
}

const MapComponent = ({
  pickup,
  dropoff,
  driverLocation,
  onMapClick,
  directions,
}: MapComponentProps) => {
  const mapRef = useRef<google.maps.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
    libraries,
  });

  const onLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
    setMapLoaded(true);
  }, []);

  const handleMapClick = useCallback(
    (e: google.maps.MapMouseEvent) => {
      if (onMapClick && e.latLng) {
        onMapClick(e.latLng.lat(), e.latLng.lng());
      }
    },
    [onMapClick]
  );

  if (loadError) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-card">
        <p className="text-muted-foreground">Error loading maps</p>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-card">
        <div className="animate-pulse text-muted-foreground">Loading map...</div>
      </div>
    );
  }

  return (
    <GoogleMap
      mapContainerStyle={mapContainerStyle}
      center={pickup || defaultCenter}
      zoom={13}
      onLoad={onLoad}
      onClick={handleMapClick}
      options={{
        styles: darkMapStyles,
        disableDefaultUI: true,
        zoomControl: true,
        mapTypeControl: false,
        scaleControl: false,
        streetViewControl: false,
        rotateControl: false,
        fullscreenControl: false,
      }}
    >
      {pickup && (
        <Marker
          position={pickup}
          icon={{
            path: google.maps.SymbolPath.CIRCLE,
            scale: 10,
            fillColor: '#a855f7',
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 3,
          }}
        />
      )}
      {dropoff && (
        <Marker
          position={dropoff}
          icon={{
            path: google.maps.SymbolPath.CIRCLE,
            scale: 10,
            fillColor: '#84cc16',
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 3,
          }}
        />
      )}
      {driverLocation && (
        <Marker
          position={driverLocation}
          icon={{
            path: 'M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z',
            scale: 2,
            fillColor: '#a855f7',
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 1,
            rotation: 0,
            anchor: new google.maps.Point(12, 12),
          }}
        />
      )}
      {directions && (
        <DirectionsRenderer
          directions={directions}
          options={{
            suppressMarkers: true,
            polylineOptions: {
              strokeColor: '#a855f7',
              strokeWeight: 5,
              strokeOpacity: 0.8,
            },
          }}
        />
      )}
    </GoogleMap>
  );
};

export default MapComponent;