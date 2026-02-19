import { useState, useRef, useEffect, useCallback, forwardRef } from 'react';
import { MapPin, Navigation, Loader2, Clock, Star, Edit3, RefreshCw } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import { useMapboxToken } from '@/hooks/useMapboxToken';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

const isIOS = typeof navigator !== 'undefined' && (
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
);
const SEARCH_TIMEOUT_MS = 4000;
const MIN_QUERY_LENGTH = 3;

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

const LocationInput = forwardRef<HTMLDivElement, LocationInputProps>((({
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
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const pendingQueryRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastQueryRef = useRef<string>('');
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
    const trimmed = query.trim();

    // Abort any previous in-flight request
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }

    // Too short: clear loading, show recents or nothing
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setIsSearching(false);
      setErrorMessage(null);
      if (type === 'dropoff' && recentDestinations.length > 0 && trimmed.length === 0) {
        setSuggestions(recentDestinations);
        setShowSuggestions(true);
      } else if (trimmed.length === 0) {
        setSuggestions([]);
        setShowSuggestions(false);
      }
      return;
    }

    // Create new AbortController for this request
    const controller = new AbortController();
    abortRef.current = controller;
    lastQueryRef.current = trimmed;

    if (isIOS) console.log('[Search] searchStarted', { query: trimmed });
    setIsSearching(true);
    setSearchFailed(false);
    setErrorMessage(null);

    // Hard timeout: forcibly abort after SEARCH_TIMEOUT_MS
    const timeoutId = setTimeout(() => {
      if (!controller.signal.aborted) {
        if (isIOS) console.log('[Search] searchTimeout', { query: trimmed });
        controller.abort();
      }
    }, SEARCH_TIMEOUT_MS);

    const doSearch = async (): Promise<Suggestion[]> => {
      const recentResults = searchRecentDestinations(query);
      const customResults = await searchCustomLocations(query);

      let mapboxResults: Suggestion[] = [];
      const currentToken = tokenRef.current;
      if (currentToken) {
        try {
          mapboxResults = await searchMapbox(query, currentToken);
        } catch (err) {
          if ((err as Error)?.name === 'AbortError') throw err;
          console.warn('[LocationInput] Mapbox search failed, showing local results + manual fallback');
          setSearchFailed(true);
        }
      } else {
        pendingQueryRef.current = query;
      }

      const recentIds = new Set(recentResults.map(r => `${r.center[0]}-${r.center[1]}`));
      const customIds = new Set(customResults.map(r => `${r.center[0]}-${r.center[1]}`));
      const filteredMapbox = mapboxResults.filter(m => {
        const key = `${m.center[0]}-${m.center[1]}`;
        return !recentIds.has(key) && !customIds.has(key);
      });

      return [...recentResults, ...customResults, ...filteredMapbox];
    };

    const errorMsg = language === 'fr'
      ? 'Impossible de charger les resultats'
      : "Can't load results - use Enter manually";

    try {
      if (controller.signal.aborted) { const e = new Error('Aborted'); e.name = 'AbortError'; throw e; }

      let combined = await doSearch();

      // Retry once after 500ms if empty and not aborted
      if (combined.length === 0 && !controller.signal.aborted) {
        await new Promise(r => setTimeout(r, 500));
        if (controller.signal.aborted) { const e = new Error('Aborted'); e.name = 'AbortError'; throw e; }
        combined = await doSearch();
      }

      if (controller.signal.aborted) { const e = new Error('Aborted'); e.name = 'AbortError'; throw e; }

      if (combined.length === 0 || searchFailed) {
        combined.push({
          id: 'manual-entry',
          name: language === 'fr' ? 'Entrer manuellement' : 'Enter manually',
          address: query,
          center: [0, 0],
          isManual: true,
        });
      }

      clearTimeout(timeoutId);
      setSuggestions(combined);
      setShowSuggestions(combined.length > 0);
      setIsSearching(false);
      if (isIOS) console.log('[Search] searchFinished', { query: trimmed, count: combined.length });
    } catch (err) {
      clearTimeout(timeoutId);
      const isAbort = (err as Error)?.name === 'AbortError';
      if (isAbort) {
        // Only show error if this was a timeout (not superseded by newer query)
        if (lastQueryRef.current === trimmed) {
          if (isIOS) console.log('[Search] searchTimeout/aborted showing error', { query: trimmed });
          setIsSearching(false);
          setErrorMessage(errorMsg);
          setSuggestions([{
            id: 'manual-entry',
            name: language === 'fr' ? 'Entrer manuellement' : 'Enter manually',
            address: query,
            center: [0, 0],
            isManual: true,
          }]);
          setShowSuggestions(true);
        }
        return;
      }
      console.error('[Search] searchError:', err);
      if (isIOS) console.log('[Search] searchError', { query: trimmed, error: (err as Error)?.message });
      setIsSearching(false);
      setErrorMessage(errorMsg);
      setSuggestions([{
        id: 'manual-entry',
        name: language === 'fr' ? 'Entrer manuellement' : 'Enter manually',
        address: query,
        center: [0, 0],
        isManual: true,
      }]);
      setShowSuggestions(true);
    }
  }, [type, recentDestinations, language]);

  const searchMapbox = async (query: string, accessToken: string): Promise<Suggestion[]> => {
    try {
      const tokenPrefix = accessToken ? accessToken.substring(0, 6) + '...' : 'MISSING';
      console.log(`[LocationInput] Mapbox search: query="${query}", token=${tokenPrefix}`);

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

      const suggestUrl = `https://api.mapbox.com/search/searchbox/v1/suggest?${params}`;
      console.log(`[LocationInput] Suggest URL (no token): ${suggestUrl.replace(accessToken, '***')}`);

      const response = await fetch(suggestUrl);
      console.log(`[LocationInput] Suggest HTTP ${response.status}`);

      if (!response.ok) {
        const errBody = await response.text();
        console.error(`[LocationInput] Suggest failed ${response.status}: ${errBody.substring(0, 200)}`);
        if (response.status === 401 || response.status === 403 || response.status === 404) {
          setSearchFailed(true);
        }
        return await searchMapboxGeocoding(query, accessToken);
      }

      const data = await response.json();
      console.log(`[LocationInput] Suggest returned ${data.suggestions?.length ?? 0} suggestions`);

      if (data.suggestions && data.suggestions.length > 0) {
        data.suggestions.slice(0, 2).forEach((s: any, i: number) => {
          console.log(`[LocationInput] Result ${i}: "${s.name}" - ${s.full_address || s.place_formatted || ''}`);
        });

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

              if (!retrieveResponse.ok) {
                console.warn(`[LocationInput] Retrieve failed for ${s.name}: HTTP ${retrieveResponse.status}`);
                return {
                  id: s.mapbox_id,
                  name: s.name || 'Unknown',
                  address: s.full_address || s.place_formatted || '',
                  center: [0, 0] as [number, number],
                } as Suggestion | null;
              }

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
            } catch (retrieveErr) {
              console.warn(`[LocationInput] Retrieve error for ${s.name}:`, retrieveErr);
              return null;
            }
          })
        );

        const results = detailedSuggestions.filter((s): s is Suggestion => s !== null && s.center[0] !== 0);
        console.log(`[LocationInput] Final results: ${results.length} after retrieve`);

        if (results.length > 0) return results;
        return await searchMapboxGeocoding(query, accessToken);
      } else {
        return await searchMapboxGeocoding(query, accessToken);
      }
    } catch (err) {
      console.error('[LocationInput] Mapbox search error:', err);
      try {
        return await searchMapboxGeocoding(query, accessToken);
      } catch (_e) {
        return [];
      }
    }
  };

  const searchMapboxGeocoding = async (query: string, accessToken: string): Promise<Suggestion[]> => {
    console.log(`[LocationInput] Geocoding fallback for: "${query}"`);
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

    const geocodeUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?${geocodeParams}`;
    const geocodeResponse = await fetch(geocodeUrl);
    console.log(`[LocationInput] Geocoding HTTP ${geocodeResponse.status}`);

    if (!geocodeResponse.ok) {
      console.error(`[LocationInput] Geocoding failed: HTTP ${geocodeResponse.status}`);
      return [];
    }

    const geocodeData = await geocodeResponse.json();
    console.log(`[LocationInput] Geocoding returned ${geocodeData.features?.length ?? 0} features`);

    if (geocodeData.features) {
      geocodeData.features.slice(0, 2).forEach((f: any, i: number) => {
        console.log(`[LocationInput] Geocode ${i}: "${f.place_name}"`);
      });

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
    return [];
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    onChange(newValue);
    setErrorMessage(null);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    // Abort any in-flight request immediately on keystroke
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }

    const trimmed = newValue.trim();
    // Immediately show recents for empty dropoff
    if (trimmed.length === 0 && type === 'dropoff' && recentDestinations.length > 0) {
      setIsSearching(false);
      setSuggestions(recentDestinations);
      setShowSuggestions(true);
      return;
    }
    // Below min length: clear loading state immediately
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setIsSearching(false);
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    debounceRef.current = setTimeout(() => {
      searchPlaces(newValue);
    }, 300);
  };

  const handleSelectSuggestion = (suggestion: Suggestion) => {
    if (suggestion.isManual) {
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
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, []);

  return (
    <div ref={ref || containerRef} className="relative flex gap-2">
      <div className="flex-1 relative" ref={containerRef}>
        <div className="absolute left-3 top-1/2 -translate-y-1/2 z-10">
          {isSearching && value.trim().length >= MIN_QUERY_LENGTH ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : icon}
        </div>
        <Input
          ref={inputRef}
          value={value}
          onChange={handleInputChange}
          onFocus={() => {
            // Show recents on focus for empty dropoff: no search triggered
            if (type === 'dropoff' && !value && recentDestinations.length > 0) {
              setSuggestions(recentDestinations);
              setShowSuggestions(true);
            } else if (value.trim().length >= MIN_QUERY_LENGTH && suggestions.length > 0) {
              setShowSuggestions(true);
            }
          }}
          placeholder={placeholder || t(`booking.${type}`)}
          className="pl-10 py-6 bg-background touch-manipulation"
        />

        {/* Error banner with retry */}
        {errorMessage && !isSearching && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-destructive/50 rounded-lg shadow-lg z-50 p-3 flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">{errorMessage}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0 text-primary"
              onClick={() => {
                setErrorMessage(null);
                searchPlaces(value);
              }}
            >
              <RefreshCw className="h-4 w-4 mr-1" />
              Retry
            </Button>
          </div>
        )}

        {/* Loading skeletons: only when a real request is in-flight */}
        {isSearching && !showSuggestions && !errorMessage && value.trim().length >= MIN_QUERY_LENGTH && (
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
