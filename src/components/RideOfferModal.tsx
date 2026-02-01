import { useState, useEffect, useRef, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { MapPin, Navigation, Clock, DollarSign, Zap, Trophy, X, Shield, Car } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatCurrency } from '@/lib/pricing';
import { calculatePlatformFee, calculateDriverEarnings } from '@/lib/platformFees';
import { useLanguage } from '@/contexts/LanguageContext';

type RideSummary = {
  id: string;
  pickup_address: string;
  dropoff_address: string;
  estimated_fare: number;
  distance_km?: number;
  estimated_duration_minutes?: number;
  pickup_eta_minutes?: number;
  is_priority?: boolean;
  pickup_lat?: number;
  pickup_lng?: number;
};

interface RideOfferModalProps {
  open: boolean;
  ride: RideSummary | null;
  onDecline: () => void;
  onAccept: () => void;
  countdownSeconds?: number;
  driverLocation?: { lat: number; lng: number } | null;
}

// Haversine formula to calculate distance
function calculateDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function RideOfferModal({
  open,
  ride,
  onDecline,
  onAccept,
  countdownSeconds = 45,
  driverLocation,
}: RideOfferModalProps) {
  const { language } = useLanguage();
  const [timeLeft, setTimeLeft] = useState(countdownSeconds);
  const [showUberShimmer, setShowUberShimmer] = useState(true);
  const timerRef = useRef<number | null>(null);

  // Calculate distance from driver to pickup using passed driverLocation
  const driverDistanceKm = useMemo(() => {
    if (!driverLocation || !ride?.pickup_lat || !ride?.pickup_lng) {
      return null;
    }
    return calculateDistanceKm(
      driverLocation.lat, 
      driverLocation.lng, 
      ride.pickup_lat, 
      ride.pickup_lng
    );
  }, [driverLocation, ride?.pickup_lat, ride?.pickup_lng]);

  // Reset timer when ride changes
  useEffect(() => {
    if (open && ride) {
      setTimeLeft(countdownSeconds);
      setShowUberShimmer(true);
    }
  }, [open, ride?.id, countdownSeconds]);

  // Countdown timer
  useEffect(() => {
    if (!open) return;

    timerRef.current = window.setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          onDecline();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [open, onDecline]);

  // Uber shimmer only twice then remove class
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => setShowUberShimmer(false), 1400);
    return () => clearTimeout(t);
  }, [open]);

  if (!ride) return null;

  const fare = ride.estimated_fare;
  const platformFee = calculatePlatformFee(fare);
  const driverEarnings = calculateDriverEarnings(fare);
  
  // Estimate what Uber would take (~40-45% of fare)
  const uberEstimatedCut = fare * 0.42;
  const uberEstimatedEarnings = fare - uberEstimatedCut;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center p-2 pt-16 pb-4 overflow-y-auto"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* Backdrop */}
          <div className="fixed inset-0 bg-black/80 backdrop-blur-xl" />

          <motion.div
            initial={{ y: 50, scale: 0.9, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 50, scale: 0.9, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="relative w-full max-w-xl my-auto"
          >
            <Card className="relative bg-black/60 backdrop-blur-xl border border-white/10 rounded-3xl overflow-hidden shadow-2xl">
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-primary/30 border border-primary/30 flex items-center justify-center">
                    <Car className="h-5 w-5 text-primary" />
                  </div>
                  <span className="text-xl font-semibold text-primary">Drivveme</span>
                </div>
                <div className="px-4 py-2 rounded-full bg-white/10 border border-white/10 text-white font-semibold">
                  {timeLeft}s
                </div>
              </div>

              <div className="px-6 py-5 space-y-5">
                {/* Keep more of your fare headline - with animated border */}
                <div className="animated-border-purple p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-2xl">💰</span>
                    <h2 className="text-2xl sm:text-3xl font-bold text-white">
                      {language === 'fr' ? 'Gardez plus de votre tarif' : 'Keep more of your fare'}
                    </h2>
                  </div>
                  <p className="text-white/80 text-sm sm:text-base leading-snug">
                    {language === 'fr' 
                      ? <>Sur plusieurs courses, d'autres apps <span className="text-white font-semibold">prennent jusqu'à ~40%</span> en frais. <span className="text-white font-semibold">Drivveme</span> est conçu pour que les chauffeurs gardent plus.</>
                      : <>On many trips, other ride apps <span className="text-white font-semibold">can take up to ~40%</span> in fees. <span className="text-white font-semibold">Drivveme</span> is built so drivers keep more.</>
                    }
                  </p>
                  <p className="mt-2 text-xs text-white/50">
                    * {language === 'fr' 
                      ? 'Les comparaisons de frais sont des estimations basées sur les expériences rapportées.'
                      : 'Fee comparisons are estimates based on publicly reported driver experiences.'
                    }
                  </p>
                </div>

                {/* Distance to Rider Badge - Always visible */}
                <div className="flex items-center justify-center">
                  <div className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-primary/20 border-2 border-primary/50">
                    <Navigation className="h-5 w-5 text-primary" />
                    <span className="text-primary font-bold text-xl">
                      {driverDistanceKm !== null 
                        ? (driverDistanceKm < 1 
                            ? `${(driverDistanceKm * 1000).toFixed(0)}m ${language === 'fr' ? 'du passager' : 'to rider'}`
                            : `${driverDistanceKm.toFixed(1)} km ${language === 'fr' ? 'du passager' : 'to rider'}`
                          )
                        : (language === 'fr' ? 'Localisation...' : 'Getting location...')
                      }
                    </span>
                  </div>
                </div>

                {/* Route Info */}
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="mt-1 h-3 w-3 rounded-full bg-success flex-shrink-0" />
                    <p className="text-white font-medium line-clamp-1">{ride.pickup_address}</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="mt-1 h-3 w-3 rounded-full bg-destructive flex-shrink-0" />
                    <p className="text-white font-medium line-clamp-1">{ride.dropoff_address}</p>
                  </div>
                  <div className="flex items-center gap-4 pt-2 text-white/70 text-sm">
                    <span>⏱️ {ride.estimated_duration_minutes || '--'} min</span>
                    <span>📍 {ride.distance_km?.toFixed(1) || '--'} km</span>
                  </div>
                </div>

                {/* Drivveme vs Uber Comparison */}
                <div className="grid grid-cols-2 gap-3">
                  {/* Drivveme Box - animated green border */}
                  <div className="animated-border-green drivveme-glow p-4">
                    <div className="text-white/70 text-sm flex items-center gap-2">
                      <Car className="h-4 w-4 text-primary" />
                      Drivveme
                    </div>
                    <div className="mt-2 text-3xl font-extrabold text-success">
                      ${driverEarnings.toFixed(2)}
                    </div>
                    <div className="text-success text-sm font-medium">
                      {language === 'fr' ? 'Vous gagnez' : 'You earn'}
                    </div>
                  </div>

                  {/* Uber Box - animated white border */}
                  <div className={`animated-border-white ${showUberShimmer ? 'uber-shimmer' : ''} p-4`}>
                    <div className="text-white/70 text-sm">Uber</div>
                    <div className="mt-2 text-xl font-bold text-white">
                      {language === 'fr' ? 'Seulement' : 'Only'} ${uberEstimatedEarnings.toFixed(2)} <span className="text-white/60 text-sm">est</span>
                    </div>
                    <div className="text-sm mt-1">
                      <span className="uber-fee-glow">
                        {language === 'fr' 
                          ? `Uber prend ~$${uberEstimatedCut.toFixed(2)} est`
                          : `Uber typically takes ~$${uberEstimatedCut.toFixed(2)} est`
                        }
                      </span>
                    </div>
                  </div>
                </div>

                {/* Accept Button */}
                <Button
                  size="lg"
                  onClick={onAccept}
                  className="accept-pulse w-full h-14 text-lg font-bold bg-success hover:bg-success/90 text-white rounded-xl"
                >
                  {language === 'fr' ? 'Accepter la course' : 'Accept Ride'}
                </Button>

                {/* Priority Driver Reward */}
                <div className="flex items-center gap-3 bg-accent/10 border border-accent/30 rounded-xl p-3">
                  <Trophy className="h-5 w-5 text-accent flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-bold text-accent">
                      {language === 'fr' ? 'Acceptez vite → Chauffeur Prioritaire!' : 'Accept fast → Priority Driver!'}
                    </p>
                    <p className="text-xs text-white/60">
                      {language === 'fr' ? 'Priorité pour 30 min' : 'Get priority for 30 min'}
                    </p>
                  </div>
                </div>

                {/* Decline Button - Same prominence as Accept */}
                <Button
                  size="lg"
                  onClick={onDecline}
                  className="w-full h-14 text-lg font-bold bg-destructive hover:bg-destructive/90 text-white rounded-xl"
                >
                  <X className="h-5 w-5 mr-2" />
                  {language === 'fr' ? 'Refuser la course' : 'Decline Ride'}
                </Button>
              </div>
            </Card>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
