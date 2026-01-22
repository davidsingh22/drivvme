import { useState, useRef, useEffect, useCallback, forwardRef } from 'react';
import { MapPin, Navigation, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useMapboxToken } from '@/hooks/useMapboxToken';

interface LocationInputProps {
  type: 'pickup' | 'dropoff';
  value: string;
  onChange: (value: string, location?: { lat: number; lng: number }) => void;
  placeholder?: string;
  onUseCurrentLocation?: () => void;
}

interface Suggestion {
  id: string;
  place_name: string;
  center: [number, number];
}

const LocationInput = forwardRef<HTMLDivElement, LocationInputProps>(({
  type,
  value,
  onChange,
  placeholder,
  onUseCurrentLocation,
}, ref) => {
  const { t } = useLanguage();
  const { token, loading: tokenLoading } = useMapboxToken();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const icon = type === 'pickup' ? (
    <MapPin className="h-5 w-5 text-primary" />
  ) : (
    <Navigation className="h-5 w-5 text-accent" />
  );

  const searchPlaces = useCallback(async (query: string) => {
    if (!token || query.length < 2) {
      setSuggestions([]);
      return;
    }

    setIsSearching(true);
    try {
      // Enhanced geocoding with broader search types and Montreal proximity
      // types: address, poi, place, locality, neighborhood for better landmark support
      // proximity: Montreal coordinates for better local results
      // fuzzyMatch: true for partial/alternate name matching
      const params = new URLSearchParams({
        access_token: token,
        country: 'ca',
        // Include all POI types for landmarks, airports, train stations, malls, etc.
        types: 'address,poi,poi.landmark,place,locality,neighborhood,region',
        limit: '10',
        fuzzyMatch: 'true',
        autocomplete: 'true',
        proximity: '-73.5673,45.5017', // Montreal center for better local results
        language: 'en,fr', // Support both languages
      });
      
      const response = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?${params}`
      );
      const data = await response.json();

      if (data.features) {
        setSuggestions(
          data.features.map((f: any) => ({
            id: f.id,
            place_name: f.place_name,
            center: f.center,
          }))
        );
        setShowSuggestions(true);
      }
    } catch (err) {
      console.error('Geocoding error:', err);
    } finally {
      setIsSearching(false);
    }
  }, [token]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    onChange(newValue);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      searchPlaces(newValue);
    }, 300);
  };

  const handleSelectSuggestion = (suggestion: Suggestion) => {
    onChange(suggestion.place_name, {
      lat: suggestion.center[1],
      lng: suggestion.center[0],
    });
    setSuggestions([]);
    setShowSuggestions(false);
  };

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  return (
    <div ref={ref || containerRef} className="relative flex gap-2">
      <div className="flex-1 relative" ref={containerRef}>
        <div className="absolute left-3 top-1/2 -translate-y-1/2 z-10">
          {isSearching ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : icon}
        </div>
        <Input
          ref={inputRef}
          value={value}
          onChange={handleInputChange}
          onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
          placeholder={placeholder || t(`booking.${type}`)}
          className="pl-10 py-6 bg-background"
          disabled={tokenLoading}
        />

        {/* Suggestions dropdown */}
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-50 overflow-hidden">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion.id}
                type="button"
                className="w-full px-4 py-3 text-left text-sm hover:bg-muted transition-colors border-b border-border last:border-b-0"
                onClick={() => handleSelectSuggestion(suggestion)}
              >
                <span className="line-clamp-2">{suggestion.place_name}</span>
              </button>
            ))}
          </div>
        )}
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
});

LocationInput.displayName = 'LocationInput';

export default LocationInput;
