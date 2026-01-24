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
  name: string;
  address: string;
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
      // Use Mapbox Search Box API for superior POI discovery
      // This API has much better coverage for airports, restaurants, hospitals, casinos, etc.
      const sessionToken = crypto.randomUUID();
      
      const params = new URLSearchParams({
        access_token: token,
        session_token: sessionToken,
        q: query,
        country: 'CA',
        language: 'en',
        limit: '10',
        // Include all POI types - this covers airports, restaurants, hospitals, casinos, etc.
        types: 'poi,address,place,street,postcode,locality,neighborhood,district,region',
        // Proximity to Montreal for better local results, but search is Canada-wide
        proximity: '-73.5673,45.5017',
      });
      
      const response = await fetch(
        `https://api.mapbox.com/search/searchbox/v1/suggest?${params}`
      );
      const data = await response.json();

      if (data.suggestions && data.suggestions.length > 0) {
        // For each suggestion, we need to retrieve the full details to get coordinates
        const detailedSuggestions = await Promise.all(
          data.suggestions.slice(0, 8).map(async (s: any) => {
            try {
              const retrieveParams = new URLSearchParams({
                access_token: token,
                session_token: sessionToken,
              });
              const retrieveResponse = await fetch(
                `https://api.mapbox.com/search/searchbox/v1/retrieve/${s.mapbox_id}?${retrieveParams}`
              );
              const retrieveData = await retrieveResponse.json();
              
              if (retrieveData.features && retrieveData.features.length > 0) {
                const feature = retrieveData.features[0];
                return {
                  id: s.mapbox_id,
                  name: s.name || s.full_address || 'Unknown',
                  address: s.place_formatted || s.full_address || '',
                  center: feature.geometry.coordinates as [number, number],
                };
              }
              return null;
            } catch {
              return null;
            }
          })
        );

        const validSuggestions = detailedSuggestions.filter((s): s is Suggestion => s !== null);
        setSuggestions(validSuggestions);
        setShowSuggestions(validSuggestions.length > 0);
      } else {
        // Fallback to geocoding API if Search Box returns no results
        const geocodeParams = new URLSearchParams({
          access_token: token,
          country: 'ca',
          types: 'poi,address,place,locality,neighborhood',
          limit: '10',
          fuzzyMatch: 'true',
          autocomplete: 'true',
          proximity: '-73.5673,45.5017',
          language: 'en,fr',
        });
        
        const geocodeResponse = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?${geocodeParams}`
        );
        const geocodeData = await geocodeResponse.json();

        if (geocodeData.features) {
          setSuggestions(
            geocodeData.features.map((f: any) => {
              // Split place_name into name and address parts
              const parts = f.place_name.split(', ');
              const name = parts[0] || f.place_name;
              const address = parts.slice(1).join(', ') || '';
              return {
                id: f.id,
                name,
                address,
                center: f.center,
              };
            })
          );
          setShowSuggestions(true);
        }
      }
    } catch (err) {
      console.error('Search error:', err);
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
    const fullAddress = suggestion.address ? `${suggestion.name}, ${suggestion.address}` : suggestion.name;
    onChange(fullAddress, {
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
                className="w-full px-4 py-3 text-left hover:bg-muted transition-colors border-b border-border last:border-b-0 flex items-start gap-3"
                onClick={() => handleSelectSuggestion(suggestion)}
              >
                <MapPin className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                <div className="flex flex-col min-w-0">
                  <span className="font-medium text-foreground truncate">{suggestion.name}</span>
                  {suggestion.address && (
                    <span className="text-sm text-muted-foreground truncate">{suggestion.address}</span>
                  )}
                </div>
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
