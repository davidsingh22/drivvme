import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, MapPin, Navigation, Clock, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useMapboxToken } from '@/hooks/useMapboxToken';

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
  const { user, profile } = useAuth();
  const { token: mapboxToken } = useMapboxToken();

  const [pickupLabel, setPickupLabel] = useState(
    language === 'fr' ? 'Position actuelle' : 'Current location'
  );
  const [pickupCoords, setPickupCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [destinationQuery, setDestinationQuery] = useState('');
  const [destinations, setDestinations] = useState<SavedDestination[]>([]);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const destRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Phase 1 warm-up: read cached GPS immediately (no blocking)
  useEffect(() => {
    try {
      const raw = localStorage.getItem('drivveme_gps_warm');
      if (raw) {
        const data = JSON.parse(raw);
        // If cache is less than 10 min old use it
        if (Date.now() - data.ts < 600_000) {
          setPickupCoords({ lat: data.lat, lng: data.lng });
          // Reverse geocode in background
          reverseGeocode(data.lat, data.lng);
        }
      }
    } catch { /* ignore */ }

    // Also try live GPS in background
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setPickupCoords(coords);
          reverseGeocode(coords.lat, coords.lng);
          localStorage.setItem(
            'drivveme_gps_warm',
            JSON.stringify({ ...coords, ts: Date.now() })
          );
        },
        () => {},
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
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
        if (data) setDestinations(data as SavedDestination[]);
      });
  }, [user?.id]);

  // Auto-focus destination input
  useEffect(() => {
    const t = setTimeout(() => destRef.current?.focus(), 200);
    return () => clearTimeout(t);
  }, []);

  const reverseGeocode = useCallback(
    async (lat: number, lng: number) => {
      // Try with mapbox token if available
      const token = mapboxToken;
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

  // Mapbox search for typed queries
  const searchMapbox = useCallback(
    async (query: string) => {
      if (!mapboxToken || query.length < 2) {
        setSearchResults([]);
        return;
      }
      setIsSearching(true);
      try {
        const res = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${mapboxToken}&language=${language}&country=ca&limit=5&types=address,poi`
        );
        const data = await res.json();
        setSearchResults(
          (data.features || []).map((f: any) => ({
            id: f.id,
            name: f.text || f.place_name?.split(',')[0],
            address: f.place_name,
            lat: f.center[1],
            lng: f.center[0],
          }))
        );
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    },
    [mapboxToken, language]
  );

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setDestinationQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchMapbox(val), 300);
  };

  const selectDestination = (dest: { name: string; address: string; lat: number; lng: number }) => {
    // Navigate to /ride with destination in state so the map loads there
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

  // Filter local destinations by query
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
        {/* Pickup row */}
        <div className="flex items-center gap-3 bg-white/8 rounded-xl px-4 py-3">
          <div className="h-3 w-3 rounded-full bg-lime-400 flex-shrink-0" />
          <span className="text-white/80 text-sm truncate flex-1">{pickupLabel}</span>
          <Navigation className="h-4 w-4 text-white/40 flex-shrink-0" />
        </div>

        {/* Destination input */}
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
          {isSearching && (
            <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin flex-shrink-0" />
          )}
        </div>
      </div>

      {/* Results list */}
      <div className="flex-1 overflow-y-auto px-4 pb-[env(safe-area-inset-bottom,16px)]">
        {/* Mapbox search results first */}
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

        {/* Past destinations */}
        {filteredDestinations.length > 0 && (
          <>
            {destinationQuery.length === 0 && (
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

        {/* Empty state */}
        {filteredDestinations.length === 0 && searchResults.length === 0 && destinationQuery.length > 0 && !isSearching && (
          <div className="text-center py-12 text-white/40 text-sm">
            {language === 'fr' ? 'Aucun résultat trouvé' : 'No results found'}
          </div>
        )}

        {filteredDestinations.length === 0 && searchResults.length === 0 && destinationQuery.length === 0 && (
          <div className="text-center py-12 text-white/30 text-sm">
            {language === 'fr' ? 'Commencez à taper pour rechercher' : 'Start typing to search'}
          </div>
        )}
      </div>
    </div>
  );
};

export default RideSearch;
