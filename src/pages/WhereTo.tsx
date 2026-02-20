import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Navigation, Clock, MapPin, X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { useMapboxToken } from '@/hooks/useMapboxToken';

interface Destination {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  visit_count: number;
  last_visited_at: string;
}

interface Suggestion {
  id: string;
  name: string;
  address: string;
  center: [number, number];
  isRecent?: boolean;
}

const WhereTo = () => {
  const { language } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { token: mapboxToken } = useMapboxToken();
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [currentLocationAddress, setCurrentLocationAddress] = useState<string>('');
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [isLoadingLocation, setIsLoadingLocation] = useState(true);
  const [isSearching, setIsSearching] = useState(false);

  // Auto-focus input on mount
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 300);
    return () => clearTimeout(t);
  }, []);

  // Get current location + reverse geocode immediately
  useEffect(() => {
    if (!navigator.geolocation) {
      setIsLoadingLocation(false);
      return;
    }

    // Try localStorage cache first for instant display
    const cached = localStorage.getItem('drivveme_last_pickup');
    const cachedAddress = localStorage.getItem('last_pickup_address');
    if (cached && cachedAddress) {
      try {
        const coords = JSON.parse(cached);
        setCurrentLocation({ lat: coords.lat, lng: coords.lng });
        setCurrentLocationAddress(cachedAddress);
        setIsLoadingLocation(false);
      } catch {}
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setCurrentLocation({ lat, lng });
        localStorage.setItem('drivveme_last_pickup', JSON.stringify({ lat, lng }));

        // Reverse geocode
        if (mapboxToken) {
          try {
            const res = await fetch(
              `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${mapboxToken}&language=${language}&types=address,poi`
            );
            const data = await res.json();
            const place = data?.features?.[0];
            if (place) {
              let addr = '';
              if (place.properties?.address) addr = place.properties.address;
              else if (place.text && place.address) addr = `${place.address} ${place.text}`;
              else addr = place.place_name?.split(',')[0] || '';
              setCurrentLocationAddress(addr || place.place_name || '');
              localStorage.setItem('last_pickup_address', addr || place.place_name || '');
            }
          } catch {}
        }
        setIsLoadingLocation(false);
      },
      () => setIsLoadingLocation(false),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
    );
  }, [mapboxToken, language]);

  // Fetch recent destinations
  const { data: recentDestinations = [] } = useQuery<Destination[]>({
    queryKey: ['recent-destinations-where-to', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from('rider_destinations')
        .select('*')
        .eq('user_id', user.id)
        .order('last_visited_at', { ascending: false })
        .limit(10);
      if (error) return [];
      return (data as Destination[]) ?? [];
    },
    enabled: !!user?.id,
    staleTime: 60000,
  });

  // Search Mapbox
  const searchMapbox = useCallback(async (q: string): Promise<Suggestion[]> => {
    if (!mapboxToken || q.length < 2) return [];
    try {
      const proximity = currentLocation
        ? `&proximity=${currentLocation.lng},${currentLocation.lat}`
        : '';
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${mapboxToken}&language=${language}&country=CA&types=address,poi,place${proximity}`
      );
      const data = await res.json();
      return (data.features || []).map((f: any) => ({
        id: f.id,
        name: f.text || f.place_name?.split(',')[0] || q,
        address: f.place_name || '',
        center: f.center as [number, number],
      }));
    } catch {
      return [];
    }
  }, [mapboxToken, language, currentLocation]);

  // Search handler with debounce
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim()) {
      setSuggestions([]);
      setIsSearching(false);
      return;
    }

    // Filter recent destinations instantly
    const filtered = recentDestinations
      .filter(d =>
        d.name.toLowerCase().includes(query.toLowerCase()) ||
        d.address.toLowerCase().includes(query.toLowerCase())
      )
      .map(d => ({
        id: d.id,
        name: d.name,
        address: d.address,
        center: [d.lng, d.lat] as [number, number],
        isRecent: true,
      }));

    setSuggestions(filtered);
    setIsSearching(true);

    debounceRef.current = setTimeout(async () => {
      const mapboxResults = await searchMapbox(query);
      // Merge: recents first, then mapbox (deduplicate by address)
      const existingAddresses = new Set(filtered.map(s => s.address.toLowerCase()));
      const merged = [
        ...filtered,
        ...mapboxResults.filter(r => !existingAddresses.has(r.address.toLowerCase())),
      ];
      setSuggestions(merged);
      setIsSearching(false);
    }, 350);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, recentDestinations, searchMapbox]);

  const handleSelectDestination = (dest: { name: string; address: string; lat: number; lng: number }) => {
    // Navigate to /ride with destination pre-filled via state
    navigate('/ride', {
      state: {
        prefilledDropoff: {
          address: dest.address,
          lat: dest.lat,
          lng: dest.lng,
        },
        pickupLocation: currentLocation
          ? {
              address: currentLocationAddress || (language === 'fr' ? 'Position actuelle' : 'Current Location'),
              lat: currentLocation.lat,
              lng: currentLocation.lng,
            }
          : null,
      },
    });
  };

  const handleSelectSuggestion = (s: Suggestion) => {
    handleSelectDestination({
      name: s.name,
      address: s.address,
      lat: s.center[1],
      lng: s.center[0],
    });
  };

  const handleSelectRecent = (d: Destination) => {
    handleSelectDestination({ name: d.name, address: d.address, lat: d.lat, lng: d.lng });
  };

  const getDestinationIcon = (name: string) => {
    const n = name.toLowerCase();
    if (n.includes('airport') || n.includes('aéroport')) return '✈️';
    if (n.includes('work') || n.includes('travail') || n.includes('bureau')) return '💼';
    if (n.includes('home') || n.includes('maison') || n.includes('domicile')) return '🏠';
    if (n.includes('gym') || n.includes('sport') || n.includes('fitness')) return '🏋️';
    if (n.includes('restaurant') || n.includes('café') || n.includes('bar')) return '🍽️';
    if (n.includes('hotel') || n.includes('hôtel')) return '🏨';
    if (n.includes('casino')) return '🎰';
    if (n.includes('hospital') || n.includes('hôpital')) return '🏥';
    if (n.includes('school') || n.includes('école') || n.includes('university') || n.includes('université')) return '🎓';
    return null;
  };

  const showRecents = !query && recentDestinations.length > 0;
  const showSuggestions = !!query && suggestions.length > 0;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background border-b border-border">
        {/* Back + title */}
        <div className="flex items-center gap-3 px-4 pt-safe pt-4 pb-3">
          <button
            onClick={() => navigate(-1)}
            className="h-10 w-10 flex items-center justify-center rounded-full hover:bg-muted transition-colors flex-shrink-0"
            aria-label="Go back"
          >
            <ArrowLeft className="h-5 w-5 text-foreground" />
          </button>
          <h1 className="font-semibold text-lg text-foreground">
            {language === 'fr' ? 'Planifier votre trajet' : 'Plan your ride'}
          </h1>
        </div>

        {/* Location inputs */}
        <div className="px-4 pb-4 space-y-2">
          {/* Current location row */}
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-muted/40 border border-border">
            <div className="flex-shrink-0 h-3 w-3 rounded-full bg-foreground ring-2 ring-foreground/20" />
            <span className="text-sm font-medium text-foreground truncate flex-1">
              {isLoadingLocation
                ? (language === 'fr' ? 'Détection...' : 'Detecting your location...')
                : currentLocationAddress || (language === 'fr' ? 'Position actuelle' : 'Current location')}
            </span>
            {isLoadingLocation && (
              <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin flex-shrink-0" />
            )}
          </div>

          {/* Destination search input */}
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl border-2 border-primary bg-background shadow-sm">
            <div className="flex-shrink-0 h-3 w-3 rounded-sm bg-foreground" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={language === 'fr' ? 'Où allez-vous ?' : 'Where to?'}
              className="flex-1 bg-transparent text-sm font-medium text-foreground placeholder:text-muted-foreground outline-none"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
            {isSearching && (
              <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin flex-shrink-0" />
            )}
            {query && !isSearching && (
              <button
                onClick={() => { setQuery(''); setSuggestions([]); inputRef.current?.focus(); }}
                className="h-5 w-5 flex-shrink-0 rounded-full bg-muted-foreground/30 flex items-center justify-center"
              >
                <X className="h-3 w-3 text-foreground/60" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {/* Mapbox search suggestions */}
        <AnimatePresence mode="wait">
          {showSuggestions && (
            <motion.div
              key="suggestions"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {suggestions.map((s, i) => (
                <motion.button
                  key={s.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  onClick={() => handleSelectSuggestion(s)}
                  className="w-full flex items-center gap-4 px-5 py-4 hover:bg-muted/50 transition-colors text-left border-b border-border/40 last:border-b-0"
                >
                  <div className="flex-shrink-0 h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                    {s.isRecent ? (
                      <Clock className="h-5 w-5 text-muted-foreground" />
                    ) : (
                      <MapPin className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-foreground truncate">{s.name}</p>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{s.address}</p>
                  </div>
                </motion.button>
              ))}
            </motion.div>
          )}

          {/* No results */}
          {query && !isSearching && suggestions.length === 0 && (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center py-16 text-center px-6"
            >
              <MapPin className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground text-sm">
                {language === 'fr' ? 'Aucun résultat trouvé' : 'No results found'}
              </p>
            </motion.div>
          )}

          {/* Recent destinations (shown when no query) */}
          {showRecents && (
            <motion.div
              key="recents"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <p className="px-5 pt-5 pb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {language === 'fr' ? 'Destinations récentes' : 'Recent destinations'}
              </p>
              {recentDestinations.map((dest, i) => {
                const icon = getDestinationIcon(dest.name);
                return (
                  <motion.button
                    key={dest.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    onClick={() => handleSelectRecent(dest)}
                    className="w-full flex items-center gap-4 px-5 py-4 hover:bg-muted/50 active:bg-muted transition-colors text-left border-b border-border/40 last:border-b-0"
                  >
                    <div className="flex-shrink-0 h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                      {icon ? (
                        <span className="text-lg">{icon}</span>
                      ) : (
                        <Clock className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-foreground truncate">{dest.name}</p>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{dest.address}</p>
                    </div>
                    {dest.visit_count > 1 && (
                      <span className="text-xs text-muted-foreground flex-shrink-0">
                        {dest.visit_count}×
                      </span>
                    )}
                  </motion.button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default WhereTo;
