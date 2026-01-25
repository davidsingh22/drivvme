import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Clock, Navigation, MapPin, AlertCircle } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useMapboxToken } from '@/hooks/useMapboxToken';

type RidePhase = 'matched' | 'arriving' | 'arrived' | 'inProgress';

interface InRideStatusBarProps {
  phase: RidePhase;
  driverLocation: { lat: number; lng: number } | null;
  pickupLocation: { lat: number; lng: number } | null;
  dropoffLocation: { lat: number; lng: number } | null;
}

interface ETAInfo {
  minutes: number;
  distanceKm: number;
}

const InRideStatusBar = ({
  phase,
  driverLocation,
  pickupLocation,
  dropoffLocation,
}: InRideStatusBarProps) => {
  const { language } = useLanguage();
  const { token: mapboxToken } = useMapboxToken();
  const [eta, setEta] = useState<ETAInfo | null>(null);

  // Determine target based on phase
  const targetLocation = phase === 'inProgress' ? dropoffLocation : pickupLocation;

  useEffect(() => {
    if (!driverLocation || !targetLocation || !mapboxToken) return;

    const controller = new AbortController();

    const fetchETA = async () => {
      try {
        const response = await fetch(
          `https://api.mapbox.com/directions/v5/mapbox/driving/${driverLocation.lng},${driverLocation.lat};${targetLocation.lng},${targetLocation.lat}?access_token=${mapboxToken}`,
          { signal: controller.signal }
        );
        const data = await response.json();

        if (data.routes?.[0]) {
          setEta({
            minutes: Math.round(data.routes[0].duration / 60),
            distanceKm: data.routes[0].distance / 1000,
          });
        }
      } catch (err) {
        if ((err as any)?.name !== 'AbortError') {
          console.error('ETA fetch error:', err);
        }
      }
    };

    fetchETA();

    return () => controller.abort();
  }, [driverLocation?.lat, driverLocation?.lng, targetLocation?.lat, targetLocation?.lng, mapboxToken]);

  const getStatusConfig = () => {
    switch (phase) {
      case 'matched':
        return {
          title: language === 'fr' ? 'Chauffeur trouvé' : 'Driver found',
          subtitle: language === 'fr' ? 'En route vers vous' : 'Heading to you',
          icon: Navigation,
          color: 'bg-primary',
        };
      case 'arriving':
        return {
          title: eta ? `${eta.minutes} min` : '--',
          subtitle: language === 'fr' ? 'Le chauffeur arrive' : 'Driver arriving',
          icon: MapPin,
          color: 'bg-primary',
        };
      case 'arrived':
        return {
          title: language === 'fr' ? 'Arrivé' : 'Arrived',
          subtitle: language === 'fr' ? 'Le chauffeur vous attend' : 'Driver is waiting',
          icon: MapPin,
          color: 'bg-success',
        };
      case 'inProgress':
        return {
          title: eta ? `${eta.minutes} min` : '--',
          subtitle: language === 'fr' ? 'Vers destination' : 'To destination',
          icon: Navigation,
          color: 'bg-accent',
        };
    }
  };

  const config = getStatusConfig();
  const Icon = config.icon;

  // Format ETA as arrival time
  const getArrivalTime = () => {
    if (!eta) return null;
    const arrivalTime = new Date(Date.now() + eta.minutes * 60 * 1000);
    return arrivalTime.toLocaleTimeString(language === 'fr' ? 'fr-CA' : 'en-CA', {
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  return (
    <motion.div
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="absolute top-4 left-4 right-4 z-10"
    >
      <div className={`${config.color} rounded-2xl px-4 py-3 shadow-lg backdrop-blur-sm`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-full">
              <Icon className="h-5 w-5 text-white" />
            </div>
            <div>
              <h3 className="text-white font-bold text-xl">{config.title}</h3>
              <p className="text-white/80 text-sm">{config.subtitle}</p>
            </div>
          </div>

          {eta && phase !== 'arrived' && (
            <div className="text-right">
              <div className="flex items-center gap-1 text-white/80 text-sm">
                <Clock className="h-3 w-3" />
                <span>{getArrivalTime()}</span>
              </div>
              <p className="text-white/60 text-xs">
                {eta.distanceKm < 1
                  ? `${Math.round(eta.distanceKm * 1000)} m`
                  : `${eta.distanceKm.toFixed(1)} km`}
              </p>
            </div>
          )}

          {phase === 'arrived' && (
            <motion.div
              animate={{ scale: [1, 1.1, 1] }}
              transition={{ duration: 1.5, repeat: Infinity }}
              className="flex items-center gap-1 bg-white/20 px-3 py-1 rounded-full"
            >
              <AlertCircle className="h-4 w-4 text-white" />
              <span className="text-white text-sm font-medium">
                {language === 'fr' ? 'Sortez' : 'Go now'}
              </span>
            </motion.div>
          )}
        </div>
      </div>
    </motion.div>
  );
};

export default InRideStatusBar;
