import { useState, useRef, useEffect, useCallback } from 'react';
import { useJsApiLoader, Autocomplete } from '@react-google-maps/api';
import { MapPin, Navigation } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';

const libraries: ("places")[] = ["places"];

interface LocationInputProps {
  type: 'pickup' | 'dropoff';
  value: string;
  onChange: (value: string, location?: { lat: number; lng: number }) => void;
  placeholder?: string;
  onUseCurrentLocation?: () => void;
}

const LocationInput = ({
  type,
  value,
  onChange,
  placeholder,
  onUseCurrentLocation,
}: LocationInputProps) => {
  const { t } = useLanguage();
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '',
    libraries,
  });

  const onPlaceChanged = useCallback(() => {
    if (autocompleteRef.current) {
      const place = autocompleteRef.current.getPlace();
      if (place.geometry?.location) {
        onChange(place.formatted_address || '', {
          lat: place.geometry.location.lat(),
          lng: place.geometry.location.lng(),
        });
      }
    }
  }, [onChange]);

  const onAutocompleteLoad = useCallback((autocomplete: google.maps.places.Autocomplete) => {
    autocompleteRef.current = autocomplete;
  }, []);

  const icon = type === 'pickup' ? (
    <MapPin className="h-5 w-5 text-primary" />
  ) : (
    <Navigation className="h-5 w-5 text-accent" />
  );

  if (!isLoaded) {
    return (
      <div className="relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 z-10">
          {icon}
        </div>
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder || t(`booking.${type}`)}
          className="pl-10 py-6 bg-background"
        />
      </div>
    );
  }

  return (
    <div className="relative flex gap-2">
      <div className="flex-1 relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 z-10">
          {icon}
        </div>
        <Autocomplete
          onLoad={onAutocompleteLoad}
          onPlaceChanged={onPlaceChanged}
          options={{
            componentRestrictions: { country: 'ca' },
            types: ['geocode', 'establishment'],
          }}
        >
          <Input
            ref={inputRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder || t(`booking.${type}`)}
            className="pl-10 py-6 bg-background"
          />
        </Autocomplete>
      </div>
      {type === 'pickup' && onUseCurrentLocation && (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-[52px] w-[52px] shrink-0"
          onClick={onUseCurrentLocation}
          title="Use current location"
        >
          <Navigation className="h-5 w-5" />
        </Button>
      )}
    </div>
  );
};

export default LocationInput;