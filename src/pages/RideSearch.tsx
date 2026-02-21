import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, MapPin, Navigation, Clock, Search, RotateCcw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useMapboxToken, clearMapboxTokenCache } from '@/hooks/useMapboxToken';

interface SavedDestination {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  visit_count: number;
  last_visited_at: string;
}

const RideSearch = () => {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const { user } = useAuth();
  const { token: mapboxToken, loading: tokenLoading } = useMapboxToken();
  const mapboxTokenRef = useRef<string | null>(null);
  // Keep ref always in sync so callbacks never see stale token
  useEffect(() => { mapboxTokenRef.current = mapboxToken ?? null; }, [mapboxToken]);

  const [pickupLabel, setPickupLabel] = useState(
    language === 'fr' ? 'Position actuelle' : 'Current location'
  );
  const [pickupCoords, setPickupCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [destinationQuery, setDestinationQuery] = useState('');
  const [destinations, setDestinations] = useState<SavedDestination[]>([]);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchTimedOut, setSearchTimedOut] = useState(false);
  const [apiReady, setApiReady] = useState(false);
  const destRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const pendingQueryRef = useRef<string | null>(null);

  const CACHE_KEY = 'drivveme_recent_destinations';

  // ── Init Guard: track when mapbox token is ready ──
  useEffect(() => {
    if (mapboxToken && !tokenLoading) {
      console.log('[RideSearch] API ready, token available');
      setApiReady(true);
      // If user typed while API was booting, auto-fire that search now
      if (pendingQueryRef.current && pendingQueryRef.current.length >= 2) {
        const q = pendingQueryRef.current;
        pendingQueryRef.current = null;
        // Use setTimeout(0) to ensure the ref is updated before searchMapbox reads it
        setTimeout(() => searchMapbox(q), 0);
      }
    } else {
      setApiReady(false);
    }
  }, [mapboxToken, tokenLoading]);

  // ── Load cached destinations IMMEDIATELY (local cache priority) ──
  useEffect(() => {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) setDestinations(JSON.parse(cached));
    } catch { /* ignore */ }
  }, []);

  // ── Cold-start GPS wake-up with 5s high-priority timeout ──
  useEffect(() => {
    // Read cached GPS first for instant proximity
    try {
      const raw = localStorage.getItem('drivveme_gps_warm');
      if (raw) {
        const data = JSON.parse(raw);
        if (Date.now() - data.ts < 600_000) {
          setPickupCoords({ lat: data.lat, lng: data.lng });
          reverseGeocode(data.lat, data.lng);
        }
      }
    } catch { /* ignore */ }

    // Then force a high-priority fresh GPS lock
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setPickupCoords(coords);
          reverseGeocode(coords.lat, coords.lng);
          localStorage.setItem('drivveme_gps_warm', JSON.stringify({ ...coords, ts: Date.now() }));
        },
        () => {},
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
      );
    }
  }, []);

  // Load past destinations from DB
  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('rider_destinations')
      .select('*')
      .eq('user_id', user.id)
      .order('last_visited_at', { ascending: false })
      .limit(20)
      .then(({ data }) => {
        if (data && data.length > 0) {
          setDestinations(data as SavedDestination[]);
          localStorage.setItem(CACHE_KEY, JSON.stringify(data));
        }
      });
  }, [user?.id]);

  // Auto-focus destination input
  useEffect(() => {
    const t = setTimeout(() => destRef.current?.focus(), 200);
    return () => clearTimeout(t);
  }, []);

  // 'Slap-Awake': re-init search API on visibility/focus
  useEffect(() => {
    const wakeUp = () => {
      if (document.visibilityState === 'visible' || !document.hidden) {
        console.log('[RideSearch] Waking up search API');
        clearMapboxTokenCache();
        retryCountRef.current = 0;
        setApiReady(false); // will re-set to true once token reloads
      }
    };
    document.addEventListener('visibilitychange', wakeUp);
    window.addEventListener('focus', wakeUp);
    return () => {
      document.removeEventListener('visibilitychange', wakeUp);
      window.removeEventListener('focus', wakeUp);
    };
  }, []);

  const reverseGeocode = useCallback(
    async (lat: number, lng: number) => {
      const token = mapboxTokenRef.current || mapboxToken;
      if (!token) return;
      try {
        const res = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${token}&language=${language}&types=address,poi`
        );
        const data = await res.json();
        const place = data?.features?.[0];
        if (place) {
          const addr =
            place.properties?.address ||
            (place.text && place.address ? `${place.address} ${place.text}` : null) ||
            place.place_name?.split(',')[0];
          if (addr) setPickupLabel(addr);
        }
      } catch { /* silent */ }
    },
    [mapboxToken, language]
  );

  // ── Core search: 1.5s SearchBox timeout → instant Geocoding fuzzy fallback ──
  const searchMapbox = useCallback(
    async (query: string) => {
      if (query.length < 2) {
        setSearchResults([]);
        setSearchTimedOut(false);
        return;
      }

      // Use ref to always get the latest token (avoids stale closure on cold start)
      const token = mapboxTokenRef.current;
      if (!token) {
        console.log('[RideSearch] Token not ready, queuing query:', query);
        pendingQueryRef.current = query;
        return;
      }

      setIsSearching(true);
      setSearchTimedOut(false);

      const proximity = pickupCoords
        ? `${pickupCoords.lng},${pickupCoords.lat}`
        : '-73.5673,45.5017';

      // Try SearchBox with 1.5s hard timeout, fallback to Geocoding immediately
      let searchBoxResults: any[] = [];
      try {
        const abortController = new AbortController();
        const timeoutId = setTimeout(() => abortController.abort(), 1500);

        const sessionToken = crypto.randomUUID();
        const params = new URLSearchParams({
          access_token: token,
          session_token: sessionToken,
          q: query,
          country: 'CA',
          language: language,
          limit: '8',
          types: 'poi,address,place,street,postcode,locality,neighborhood',
          proximity,
        });

        const res = await fetch(
          `https://api.mapbox.com/search/searchbox/v1/suggest?${params}`,
          { signal: abortController.signal }
        );
        clearTimeout(timeoutId);
        const data = await res.json();

        if (data.suggestions && data.suggestions.length > 0) {
          const detailed = await Promise.all(
            data.suggestions.slice(0, 6).map(async (s: any) => {
              try {
                const rParams = new URLSearchParams({
                  access_token: token,
                  session_token: sessionToken,
                });
                const rRes = await fetch(
                  `https://api.mapbox.com/search/searchbox/v1/retrieve/${s.mapbox_id}?${rParams}`
                );
                const rData = await rRes.json();
                if (rData.features?.[0]) {
                  const f = rData.features[0];
                  const props = f.properties || {};
                  const streetParts: string[] = [];
                  if (props.address) streetParts.push(props.address);
                  if (props.street) streetParts.push(props.street);
                  const street = streetParts.join(' ');
                  const locParts: string[] = [];
                  if (props.place) locParts.push(props.place);
                  if (props.region) locParts.push(props.region);
                  if (props.postcode) locParts.push(props.postcode);
                  const fullAddr = street ? `${street}, ${locParts.join(', ')}` : locParts.join(', ');
                  return {
                    id: s.mapbox_id,
                    name: s.name || props.name || query,
                    address: fullAddr || s.full_address || '',
                    lat: f.geometry.coordinates[1],
                    lng: f.geometry.coordinates[0],
                  };
                }
                return null;
              } catch { return null; }
            })
          );
          searchBoxResults = detailed.filter(Boolean);
        }
      } catch (err: any) {
        if (err.name === 'AbortError') {
          console.warn('[RideSearch] SearchBox timed out at 1.5s, falling through to Geocoding');
        } else {
          console.warn('[RideSearch] SearchBox error, falling through to Geocoding:', err.message);
        }
      }

      // If SearchBox got results, use them
      if (searchBoxResults.length > 0) {
        setSearchResults(searchBoxResults);
        retryCountRef.current = 0;
        setIsSearching(false);
        return;
      }

      // ── Fuzzy Geocoding fallback (always fires on cold start / 0 results) ──
      try {
        console.log('[RideSearch] Using Geocoding fuzzy fallback for:', query);
        const geoRes = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${token}&language=${language}&country=ca&limit=5&types=poi,address,place,locality,neighborhood&autocomplete=true&fuzzyMatch=true&proximity=${proximity}`
        );
        const geoData = await geoRes.json();
        const geoResults = (geoData.features || []).map((f: any) => ({
          id: f.id,
          name: f.text || f.place_name?.split(',')[0],
          address: f.place_name,
          lat: f.center[1],
          lng: f.center[0],
        }));

        if (geoResults.length > 0) {
          setSearchResults(geoResults);
          retryCountRef.current = 0;
        } else if (retryCountRef.current < 1) {
          // Silent re-init and retry once
          console.log('[RideSearch] 0 results — re-initializing API and retrying');
          retryCountRef.current++;
          clearMapboxTokenCache();
          setTimeout(() => searchMapbox(query), 500);
        } else {
          setSearchResults([]);
          setSearchTimedOut(true); // Show recents as fallback
        }
      } catch {
        setSearchResults([]);
        setSearchTimedOut(true);
        if (retryCountRef.current < 1) {
          retryCountRef.current++;
          clearMapboxTokenCache();
          setTimeout(() => searchMapbox(query), 500);
        }
      } finally {
        setIsSearching(false);
      }
    },
    [language, pickupCoords]
  );

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setDestinationQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchMapbox(val), 300);
  };

  const handleRetrySearch = () => {
    retryCountRef.current = 0;
    clearMapboxTokenCache();
    setSearchTimedOut(false);
    if (destinationQuery.length >= 2) {
      searchMapbox(destinationQuery);
    }
  };

  const selectDestination = (dest: { name: string; address: string; lat: number; lng: number }) => {
    navigate('/ride', {
      state: {
        dropoffAddress: dest.address,
        dropoffLat: dest.lat,
        dropoffLng: dest.lng,
        pickupAddress: pickupLabel,
        pickupLat: pickupCoords?.lat,
        pickupLng: pickupCoords?.lng,
        autoEstimate: true,
      },
    });
  };

  const filteredDestinations =
    destinationQuery.length > 0
      ? destinations.filter(
          (d) =>
            d.name.toLowerCase().includes(destinationQuery.toLowerCase()) ||
            d.address.toLowerCase().includes(destinationQuery.toLowerCase())
        )
      : destinations;

  const getIcon = (name: string) => {
    const n = name.toLowerCase();
    if (n.includes('casino')) return '🎰';
    if (n.includes('airport') || n.includes('aéroport')) return '✈️';
    if (n.includes('hotel') || n.includes('hôtel')) return '🏨';
    if (n.includes('gym') || n.includes('fitness')) return '💪';
    if (n.includes('home') || n.includes('maison')) return '🏠';
    if (n.includes('work') || n.includes('travail') || n.includes('bureau')) return '💼';
    return null;
  };

  // Show recents as fallback when search timed out or API is dead
  const showRecentsFallback = searchTimedOut && destinations.length > 0;
  // Show init spinner when API not ready and user is typing
  const showInitSpinner = !apiReady && destinationQuery.length >= 2;

  return (
    <div className="fixed inset-0 z-50 bg-[#1a1a2e] flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-[env(safe-area-inset-top,12px)] pb-3 border-b border-white/10">
        <Button
          variant="ghost"
          size="icon"
          className="text-white hover:bg-white/10"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h2 className="text-white font-semibold text-lg">
          {language === 'fr' ? 'Planifier un trajet' : 'Plan your ride'}
        </h2>
      </div>

      {/* Pickup + Destination boxes */}
      <div className="px-4 py-4 space-y-3">
        <div className="flex items-center gap-3 bg-white/8 rounded-xl px-4 py-3">
          <div className="h-3 w-3 rounded-full bg-lime-400 flex-shrink-0" />
          <span className="text-white/80 text-sm truncate flex-1">{pickupLabel}</span>
          <Navigation className="h-4 w-4 text-white/40 flex-shrink-0" />
        </div>

        <div className="flex items-center gap-3 bg-white/12 rounded-xl px-4 py-3">
          <div className="h-3 w-3 rounded-sm bg-purple-400 flex-shrink-0" />
          <input
            ref={destRef}
            type="text"
            value={destinationQuery}
            onChange={handleQueryChange}
            placeholder={language === 'fr' ? 'Où allez-vous ?' : 'Where to?'}
            className="flex-1 bg-transparent text-white placeholder:text-white/40 text-sm outline-none"
            autoComplete="off"
          />
          {(isSearching || showInitSpinner) && (
            <Loader2 className="h-4 w-4 text-white/50 animate-spin flex-shrink-0" />
          )}
        </div>
      </div>

      {/* Results list */}
      <div className="flex-1 overflow-y-auto px-4 pb-[env(safe-area-inset-bottom,16px)]">
        {/* Init guard: show "warming up" instead of "no results" */}
        {showInitSpinner && searchResults.length === 0 && (
          <div className="text-center py-6">
            <p className="text-white/40 text-xs">
              {language === 'fr' ? 'Initialisation de la recherche…' : 'Warming up search…'}
            </p>
          </div>
        )}

        {/* Timeout fallback banner */}
        {searchTimedOut && (
          <div className="mb-3 p-3 rounded-xl bg-white/8 flex items-center justify-between">
            <p className="text-white/60 text-xs">
              {language === 'fr' ? 'La recherche a expiré. Vos destinations récentes:' : 'Search timed out. Your recent destinations:'}
            </p>
            <Button variant="ghost" size="sm" onClick={handleRetrySearch} className="text-white/80 hover:bg-white/10 gap-1">
              <RotateCcw className="h-3 w-3" />
              {language === 'fr' ? 'Réessayer' : 'Retry'}
            </Button>
          </div>
        )}

        {/* Mapbox search results */}
        {searchResults.length > 0 && (
          <div className="mb-4">
            {searchResults.map((r) => (
              <button
                key={r.id}
                onClick={() => selectDestination(r)}
                className="w-full flex items-center gap-3 py-3 px-2 rounded-lg hover:bg-white/8 transition-colors text-left"
              >
                <div className="h-9 w-9 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0">
                  <Search className="h-4 w-4 text-white/60" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium truncate">{r.name}</p>
                  <p className="text-white/50 text-xs truncate">{r.address}</p>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Past destinations (always show when timeout, init loading, or no query) */}
        {(filteredDestinations.length > 0 && (searchResults.length === 0 || showRecentsFallback)) && (
          <>
            {(destinationQuery.length === 0 || showRecentsFallback || showInitSpinner) && (
              <p className="text-white/40 text-xs uppercase tracking-wider mb-2 px-2">
                {language === 'fr' ? 'Récents' : 'Recent'}
              </p>
            )}
            {filteredDestinations.map((d) => (
              <motion.button
                key={d.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={() => selectDestination(d)}
                className="w-full flex items-center gap-3 py-3 px-2 rounded-lg hover:bg-white/8 transition-colors text-left"
              >
                <div className="h-9 w-9 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0">
                  {getIcon(d.name) ? (
                    <span className="text-lg">{getIcon(d.name)}</span>
                  ) : (
                    <Clock className="h-4 w-4 text-white/60" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium truncate">{d.name}</p>
                  <p className="text-white/50 text-xs truncate">{d.address}</p>
                </div>
                {d.visit_count > 1 && (
                  <span className="text-white/30 text-xs flex-shrink-0">{d.visit_count}×</span>
                )}
              </motion.button>
            ))}
          </>
        )}

        {/* Empty state with retry — only when API IS ready and still no results */}
        {filteredDestinations.length === 0 && searchResults.length === 0 && destinationQuery.length > 0 && !isSearching && !searchTimedOut && apiReady && !showInitSpinner && (
          <div className="text-center py-12 space-y-3">
            <p className="text-white/40 text-sm">
              {language === 'fr' ? 'Aucun résultat trouvé' : 'No results found'}
            </p>
            <Button variant="ghost" size="sm" onClick={handleRetrySearch} className="text-white/60 hover:bg-white/10 gap-2">
              <RotateCcw className="h-4 w-4" />
              {language === 'fr' ? 'Réessayer' : 'Try Again'}
            </Button>
          </div>
        )}

        {filteredDestinations.length === 0 && searchResults.length === 0 && destinationQuery.length === 0 && !searchTimedOut && (
          <div className="text-center py-12 text-white/30 text-sm">
            {language === 'fr' ? 'Commencez à taper pour rechercher' : 'Start typing to search'}
          </div>
        )}
      </div>
    </div>
  );
};

export default RideSearch;
