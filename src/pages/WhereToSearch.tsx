import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Clock, MapPin, Search } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';

interface RecentDestination {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  visit_count: number;
  last_visited_at: string;
}

const WhereToSearch = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState('');
  const [recentDestinations, setRecentDestinations] = useState<RecentDestination[]>([]);
  const [currentLocation, setCurrentLocation] = useState<string>('Detecting location…');
  const [isLoadingLocation, setIsLoadingLocation] = useState(true);

  // Focus the input on mount
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 300);
  }, []);

  // Fetch user's current location via reverse geocoding
  useEffect(() => {
    if (!navigator.geolocation) {
      setCurrentLocation('Location unavailable');
      setIsLoadingLocation(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          // Store for use when navigating to /ride
          localStorage.setItem('drivveme_last_pickup', JSON.stringify({ lat: latitude, lng: longitude }));

          // Try reverse geocode with Mapbox (token from Supabase function)
          const tokenRes = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-mapbox-token`,
            { headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY } }
          );
          const tokenData = await tokenRes.json();
          const token = tokenData?.token || tokenData?.mapboxToken;

          if (token) {
            const geocodeRes = await fetch(
              `https://api.mapbox.com/geocoding/v5/mapbox.places/${longitude},${latitude}.json?access_token=${token}&types=address,poi&language=en`
            );
            const geocodeData = await geocodeRes.json();
            const placeName = geocodeData?.features?.[0]?.place_name;
            if (placeName) {
              setCurrentLocation(placeName);
              localStorage.setItem('last_pickup_address', placeName);
            } else {
              setCurrentLocation(`${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
            }
          } else {
            setCurrentLocation(`${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
          }
        } catch {
          setCurrentLocation('Current location');
        } finally {
          setIsLoadingLocation(false);
        }
      },
      () => {
        setCurrentLocation('Location unavailable');
        setIsLoadingLocation(false);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }, []);

  // Fetch recent destinations
  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('rider_destinations')
      .select('*')
      .eq('user_id', user.id)
      .order('last_visited_at', { ascending: false })
      .limit(8)
      .then(({ data }) => {
        if (data) setRecentDestinations(data);
      });
  }, [user?.id]);

  const handleSelectDestination = (dest: RecentDestination) => {
    navigate('/ride', {
      state: {
        prefilledDropoff: dest.address,
        prefilledDropoffLat: dest.lat,
        prefilledDropoffLng: dest.lng,
      },
    });
  };

  const handleSearchSubmit = () => {
    if (!query.trim()) return;
    navigate('/ride', { state: { destinationQuery: query } });
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#0a0015' }}>
      {/* ── Header / Search bar ── */}
      <div
        className="flex-shrink-0 px-4 pt-safe"
        style={{
          background: 'rgba(18,5,35,0.98)',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          paddingTop: 'env(safe-area-inset-top, 0px)',
        }}
      >
        <div className="flex items-center gap-3 py-4">
          {/* Back button */}
          <button
            onClick={() => navigate('/rider-home')}
            className="flex-shrink-0 h-10 w-10 rounded-full flex items-center justify-center transition-colors"
            style={{ background: 'rgba(255,255,255,0.08)' }}
          >
            <ArrowLeft className="h-5 w-5 text-white" />
          </button>

          {/* Search input */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: '#9333ea' }} />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearchSubmit()}
              placeholder="Where to?"
              className="w-full pl-9 pr-4 py-3 rounded-full text-sm font-medium outline-none"
              style={{
                background: 'rgba(255,255,255,0.1)',
                color: 'white',
                border: '1px solid rgba(147,51,234,0.4)',
              }}
            />
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto">
        {/* Current pickup location */}
        <div className="px-4 pt-5 pb-2">
          <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'rgba(255,255,255,0.35)' }}>
            Your Location
          </p>
          <div className="flex items-start gap-3 py-3 px-4 rounded-2xl" style={{ background: 'rgba(147,51,234,0.12)', border: '1px solid rgba(147,51,234,0.2)' }}>
            <div className="flex-shrink-0 mt-0.5 h-8 w-8 rounded-full flex items-center justify-center" style={{ background: 'rgba(147,51,234,0.25)' }}>
              <MapPin className="h-4 w-4" style={{ color: '#a855f7' }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white">Pickup here</p>
              <p className="text-xs mt-0.5 truncate" style={{ color: 'rgba(255,255,255,0.5)' }}>
                {isLoadingLocation ? (
                  <span className="inline-flex items-center gap-1">
                    <span className="animate-pulse">●</span> Detecting…
                  </span>
                ) : currentLocation}
              </p>
            </div>
          </div>
        </div>

        {/* Recent destinations */}
        {recentDestinations.length > 0 && (
          <div className="px-4 pt-5">
            <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'rgba(255,255,255,0.35)' }}>
              Recent Trips
            </p>
            <AnimatePresence>
              {recentDestinations.map((dest, i) => (
                <motion.button
                  key={dest.id}
                  onClick={() => handleSelectDestination(dest)}
                  className="w-full flex items-center gap-3 py-3.5 text-left border-b last:border-0"
                  style={{ borderColor: 'rgba(255,255,255,0.06)' }}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <div
                    className="flex-shrink-0 h-10 w-10 rounded-xl flex items-center justify-center"
                    style={{ background: 'rgba(255,255,255,0.07)' }}
                  >
                    <Clock className="h-4 w-4" style={{ color: 'rgba(255,255,255,0.5)' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{dest.name}</p>
                    <p className="text-xs mt-0.5 truncate" style={{ color: 'rgba(255,255,255,0.45)' }}>
                      {dest.address}
                    </p>
                  </div>
                </motion.button>
              ))}
            </AnimatePresence>
          </div>
        )}

        {/* Empty state when no recent trips */}
        {recentDestinations.length === 0 && (
          <div className="flex flex-col items-center justify-center px-8 py-16 text-center">
            <div className="h-14 w-14 rounded-full flex items-center justify-center mb-4" style={{ background: 'rgba(147,51,234,0.15)' }}>
              <Clock className="h-6 w-6" style={{ color: '#a855f7' }} />
            </div>
            <p className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.5)' }}>
              No recent trips yet
            </p>
            <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.3)' }}>
              Search above to find your destination
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default WhereToSearch;
