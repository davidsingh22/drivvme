import { useState, useRef, useEffect, useCallback, forwardRef } from 'react';
import { MapPin, Navigation, Loader2, Clock, Star, Edit3 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import { useMapboxToken } from '@/hooks/useMapboxToken';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

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
  isCustom?: boolean;
  isRecent?: boolean;
  visitCount?: number;
  isManual?: boolean;
}

const LocationInput = forwardRef<HTMLDivElement, LocationInputProps>(({
  type,
  value,
  onChange,
  placeholder,
  onUseCurrentLocation,
}, ref) => {
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const { token } = useMapboxToken();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [recentDestinations, setRecentDestinations] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const pendingQueryRef = useRef<string | null>(null);
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const icon = type === 'pickup' ? (
    <MapPin className="h-5 w-5 text-primary" />
  ) : (
    <Navigation className="h-5 w-5 text-accent" />
  );

  // Fetch recent destinations for dropoff field
  useEffect(() => {
    if (type !== 'dropoff' || !user?.id) return;

    const fetchRecent = async () => {
      try {
        const { data, error } = await supabase
          .from('rider_destinations')
          .select('*')
          .eq('user_id', user.id)
          .order('visit_count', { ascending: false })
          .order('last_visited_at', { ascending: false })
          .limit(5);

        if (error) throw error;

        const recent: Suggestion[] = (data || []).map((d: any) => ({
          id: `recent-${d.id}`,
          name: d.name,
          address: d.address,
          center: [d.lng, d.lat] as [number, number],
          isRecent: true,
          visitCount: d.visit_count,
        }));
        setRecentDestinations(recent);
      } catch (err) {
        console.error('Error fetching recent destinations:', err);
      }
    };

    fetchRecent();
  }, [type, user?.id]);

  // Search custom locations from database
  const searchCustomLocations = async (query: string): Promise<Suggestion[]> => {
    if (query.length < 2) return [];
    
    try {
      const { data, error } = await supabase
        .from('custom_locations')
        .select('id, name, address, lat, lng')
        .or(`name.ilike.%${query}%,address.ilike.%${query}%`)
        .eq('is_active', true)
        .limit(5);

      if (error) throw error;

      return (data || []).map(loc => ({
        id: `custom-${loc.id}`,
        name: loc.name,
        address: loc.address,
        center: [loc.lng, loc.lat] as [number, number],
        isCustom: true,
      }));
    } catch (err) {
      console.error('Error searching custom locations:', err);
      return [];
    }
  };

  // Search recent destinations
  const searchRecentDestinations = (query: string): Suggestion[] => {
    if (!query || query.length < 2) return [];
    const lowerQuery = query.toLowerCase();
    return recentDestinations.filter(
      d => d.name.toLowerCase().includes(lowerQuery) || 
           d.address.toLowerCase().includes(lowerQuery)
    );
  };

  // When token arrives and there's a pending query, execute it
  useEffect(() => {
    if (token && pendingQueryRef.current) {
      const query = pendingQueryRef.current;
      pendingQueryRef.current = null;
      searchPlaces(query);
    }
  }, [token]);

  const searchPlaces = useCallback(async (query: string) => {
    if (query.length < 2) {
      // If no query but we have recent destinations (dropoff only), show them
      if (type === 'dropoff' && recentDestinations.length > 0 && query.length === 0) {
        setSuggestions(recentDestinations);
        setShowSuggestions(true);
      } else {
        setSuggestions([]);
      }
      return;
    }

    setIsSearching(true);
    setSearchFailed(false);
    try {
      // Search recent destinations and custom locations (no token needed)
      const recentResults = searchRecentDestinations(query);
      const customResults = await searchCustomLocations(query);
      
      // Search Mapbox only if token is available
      let mapboxResults: Suggestion[] = [];
      const currentToken = tokenRef.current;
      if (currentToken) {
        try {
          mapboxResults = await searchMapbox(query, currentToken);
        } catch (err) {
          console.warn('[LocationInput] Mapbox search failed, showing local results + manual fallback');
          setSearchFailed(true);
        }
      } else {
        // Token not ready yet — save query and retry when token arrives
        pendingQueryRef.current = query;
      }

      // Combine results: recent first, then custom, then Mapbox
      const recentIds = new Set(recentResults.map(r => `${r.center[0]}-${r.center[1]}`));
      const customIds = new Set(customResults.map(r => `${r.center[0]}-${r.center[1]}`));
      
      const filteredMapbox = mapboxResults.filter(m => {
        const key = `${m.center[0]}-${m.center[1]}`;
        return !recentIds.has(key) && !customIds.has(key);
      });

      const combined = [...recentResults, ...customResults, ...filteredMapbox];
      
      // If no results and token failed or missing, add "enter manually" fallback
      if (combined.length === 0 || searchFailed) {
        combined.push({
          id: 'manual-entry',
          name: language === 'fr' ? 'Entrer manuellement' : 'Enter manually',
          address: query,
          center: [0, 0],
          isManual: true,
        });
      }
      
      setSuggestions(combined);
      setShowSuggestions(combined.length > 0);
    } catch (err) {
      console.error('Search error:', err);
      // Show manual entry fallback on error
      setSuggestions([{
        id: 'manual-entry',
        name: language === 'fr' ? 'Entrer manuellement' : 'Enter manually',
        address: query,
        center: [0, 0],
        isManual: true,
      }]);
      setShowSuggestions(true);
    } finally {
      setIsSearching(false);
    }
  }, [type, recentDestinations, language]);

  const searchMapbox = async (query: string, accessToken: string): Promise<Suggestion[]> => {
    try {
      // Use Mapbox Search Box API for superior POI discovery
      const sessionToken = crypto.randomUUID();
      
      const params = new URLSearchParams({
        access_token: accessToken,
        session_token: sessionToken,
        q: query,
        country: 'CA',
        language: 'en',
        limit: '10',
        types: 'poi,address,place,street,postcode,locality,neighborhood,district,region',
        proximity: '-73.5673,45.5017',
      });
      
      const response = await fetch(
        `https://api.mapbox.com/search/searchbox/v1/suggest?${params}`
      );
      const data = await response.json();

      if (data.suggestions && data.suggestions.length > 0) {
        const detailedSuggestions = await Promise.all(
          data.suggestions.slice(0, 8).map(async (s: any) => {
            try {
              const retrieveParams = new URLSearchParams({
                access_token: accessToken,
                session_token: sessionToken,
              });
              const retrieveResponse = await fetch(
                `https://api.mapbox.com/search/searchbox/v1/retrieve/${s.mapbox_id}?${retrieveParams}`
              );
              const retrieveData = await retrieveResponse.json();
              
              if (retrieveData.features && retrieveData.features.length > 0) {
                const feature = retrieveData.features[0];
                const props = feature.properties || {};
                
                const streetParts: string[] = [];
                if (props.address) streetParts.push(props.address);
                if (props.street) streetParts.push(props.street);
                const streetAddress = streetParts.join(' ');
                
                const locationParts: string[] = [];
                if (props.place) locationParts.push(props.place);
                if (props.region) locationParts.push(props.region);
                if (props.postcode) locationParts.push(props.postcode);
                if (props.country) locationParts.push(props.country);
                
                const fullAddress = streetAddress 
                  ? `${streetAddress}, ${locationParts.join(', ')}`
                  : locationParts.join(', ');
                
                return {
                  id: s.mapbox_id,
                  name: s.name || props.name || 'Unknown',
                  address: fullAddress || s.full_address || '',
                  center: feature.geometry.coordinates as [number, number],
                };
              }
              return null;
            } catch {
              return null;
            }
          })
        );

        return detailedSuggestions.filter((s): s is Suggestion => s !== null);
      } else {
        // Fallback to geocoding API
        const geocodeParams = new URLSearchParams({
          access_token: accessToken,
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
          return geocodeData.features.map((f: any) => {
            const parts = f.place_name.split(', ');
            const name = parts[0] || f.place_name;
            const address = parts.slice(1).join(', ') || '';
            return {
              id: f.id,
              name,
              address,
              center: f.center,
            };
          });
        }
      }
      return [];
    } catch (err) {
      console.error('Mapbox search error:', err);
      return [];
    }
  };

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
    if (suggestion.isManual) {
      // Manual entry: use the typed text as the address, no coordinates
      onChange(suggestion.address);
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
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
          onFocus={() => {
            // Show recent destinations when focusing on empty dropoff field
            if (type === 'dropoff' && !value && recentDestinations.length > 0) {
              setSuggestions(recentDestinations);
              setShowSuggestions(true);
            } else if (suggestions.length > 0) {
              setShowSuggestions(true);
            }
          }}
          placeholder={placeholder || t(`booking.${type}`)}
          className="pl-10 py-6 bg-background touch-manipulation"
        />

        {/* Loading skeletons while searching */}
        {isSearching && !showSuggestions && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-50 p-2 space-y-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex items-center gap-3 px-2 py-2">
                <Skeleton className="h-5 w-5 rounded-full shrink-0" />
                <div className="flex-1 space-y-1">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Suggestions dropdown */}
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-50 overflow-hidden max-h-[60vh] overflow-y-auto">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion.id}
                type="button"
                className="w-full px-4 py-3 text-left hover:bg-muted active:bg-muted transition-colors border-b border-border last:border-b-0 flex items-start gap-3 touch-manipulation"
                onTouchEnd={(e) => { e.preventDefault(); handleSelectSuggestion(suggestion); }}
                onClick={() => handleSelectSuggestion(suggestion)}
              >
                {suggestion.isManual ? (
                  <Edit3 className="h-5 w-5 text-accent mt-0.5 shrink-0" />
                ) : suggestion.isRecent ? (
                  <Clock className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                ) : (
                  <MapPin className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                )}
                <div className="flex flex-col min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground truncate">{suggestion.name}</span>
                    {suggestion.isRecent && suggestion.visitCount && suggestion.visitCount > 1 && (
                      <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        {suggestion.visitCount}x
                      </span>
                    )}
                  </div>
                  {suggestion.address && !suggestion.isManual && (
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
