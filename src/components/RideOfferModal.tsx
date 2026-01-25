import { useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { MapPin, Navigation, Clock, DollarSign, Zap, Trophy, X, Shield } from 'lucide-react';
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
};

interface RideOfferModalProps {
  open: boolean;
  ride: RideSummary | null;
  onDecline: () => void;
  onAccept: () => void;
  countdownSeconds?: number;
}

export function RideOfferModal({
  open,
  ride,
  onDecline,
  onAccept,
  countdownSeconds = 20,
}: RideOfferModalProps) {
  const { language } = useLanguage();
  const [timeLeft, setTimeLeft] = useState(countdownSeconds);
  const timerRef = useRef<number | null>(null);

  // Reset timer when ride changes
  useEffect(() => {
    if (open && ride) {
      setTimeLeft(countdownSeconds);
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

  if (!ride) return null;

  const fare = ride.estimated_fare;
  const platformFee = calculatePlatformFee(fare);
  const driverEarnings = calculateDriverEarnings(fare);
  const progress = (timeLeft / countdownSeconds) * 100;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-background/90 backdrop-blur-md" />

          <motion.div
            initial={{ y: 50, scale: 0.9, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 50, scale: 0.9, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="relative w-full max-w-md"
          >
            {/* Animated purple glow border */}
            <div className="absolute -inset-1 rounded-2xl bg-gradient-to-r from-primary via-purple-500 to-primary opacity-75 blur-lg animate-pulse" />
            
            <Card className="relative bg-card border-2 border-primary/50 rounded-2xl overflow-hidden">
              {/* Timer Progress Ring */}
              <div className="absolute top-4 right-4">
                <div className="relative w-14 h-14">
                  <svg className="w-14 h-14 transform -rotate-90">
                    <circle
                      cx="28"
                      cy="28"
                      r="24"
                      stroke="currentColor"
                      strokeWidth="4"
                      fill="none"
                      className="text-muted"
                    />
                    <circle
                      cx="28"
                      cy="28"
                      r="24"
                      stroke="currentColor"
                      strokeWidth="4"
                      fill="none"
                      strokeLinecap="round"
                      className={`${timeLeft <= 5 ? 'text-destructive' : 'text-primary'} transition-colors`}
                      strokeDasharray={`${2 * Math.PI * 24}`}
                      strokeDashoffset={`${2 * Math.PI * 24 * (1 - progress / 100)}`}
                      style={{ transition: 'stroke-dashoffset 1s linear' }}
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className={`text-lg font-bold ${timeLeft <= 5 ? 'text-destructive' : ''}`}>
                      {timeLeft}
                    </span>
                  </div>
                </div>
              </div>

              <div className="p-6 space-y-5">
                {/* Header */}
                <div className="flex items-start gap-3">
                  {ride.is_priority && (
                    <Badge className="bg-gradient-to-r from-accent to-primary text-white font-bold px-3 py-1">
                      <Zap className="h-3 w-3 mr-1" />
                      PRIORITY
                    </Badge>
                  )}
                  <Badge variant="outline" className="ml-auto mr-16">
                    <Clock className="h-3 w-3 mr-1" />
                    {ride.estimated_duration_minutes || '--'} min
                  </Badge>
                </div>

                {/* BIG "You Earn" Hero Section */}
                <div className="text-center py-6 bg-gradient-to-br from-success/10 to-success/5 rounded-xl border border-success/20">
                  <p className="text-sm text-muted-foreground mb-1">
                    {language === 'fr' ? 'Vous gagnez' : 'You Earn'}
                  </p>
                  <p className="text-5xl font-bold text-success">
                    {formatCurrency(driverEarnings, language)}
                  </p>
                  <p className="text-sm text-muted-foreground mt-2">
                    {language === 'fr' ? 'Tarif' : 'Fare'} {formatCurrency(fare, language)} – {language === 'fr' ? 'Frais plateforme' : 'Platform fee'} {formatCurrency(platformFee, language)}
                  </p>
                </div>

                {/* Transparent Fee Badge */}
                <div className="flex justify-center">
                  <Badge variant="secondary" className="gap-1.5 py-1.5 px-3">
                    <Shield className="h-3.5 w-3.5" />
                    {language === 'fr' ? 'Frais transparent • Pas de %' : 'Transparent fee • No % cuts'}
                  </Badge>
                </div>

                {/* Locations */}
                <div className="space-y-3 bg-muted/30 rounded-xl p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <MapPin className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground">{language === 'fr' ? 'Prise en charge' : 'Pickup'}</p>
                      <p className="font-medium line-clamp-2">{ride.pickup_address}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center flex-shrink-0">
                      <Navigation className="h-4 w-4 text-accent" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground">{language === 'fr' ? 'Destination' : 'Dropoff'}</p>
                      <p className="font-medium line-clamp-2">{ride.dropoff_address}</p>
                    </div>
                  </div>

                  {/* Distance & ETA */}
                  <div className="flex items-center gap-4 pt-2 border-t border-border/50">
                    {ride.distance_km && (
                      <span className="text-sm text-muted-foreground">
                        📍 {ride.distance_km.toFixed(1)} km
                      </span>
                    )}
                    {ride.pickup_eta_minutes !== undefined && (
                      <span className="text-sm text-muted-foreground">
                        🚗 {ride.pickup_eta_minutes} min {language === 'fr' ? 'pour arriver' : 'to pickup'}
                      </span>
                    )}
                  </div>
                </div>

                {/* Priority Driver Reward */}
                <div className="flex items-center gap-3 bg-accent/10 border border-accent/30 rounded-xl p-3">
                  <Trophy className="h-6 w-6 text-accent flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-bold text-accent">
                      {language === 'fr' ? 'Acceptez en 5 sec → Chauffeur Prioritaire!' : 'Accept in 5 sec → Priority Driver!'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {language === 'fr' ? 'Priorité pour 30 min' : 'Get priority for 30 min'}
                    </p>
                  </div>
                </div>

                {/* Action Buttons - Fixed at bottom */}
                <div className="grid grid-cols-2 gap-4 pt-2">
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={onDecline}
                    className="h-14 text-lg font-semibold border-2"
                  >
                    <X className="h-5 w-5 mr-2" />
                    {language === 'fr' ? 'Refuser' : 'Decline'}
                  </Button>
                  <Button
                    size="lg"
                    onClick={onAccept}
                    className="h-14 text-lg font-semibold bg-gradient-to-r from-primary to-purple-600 hover:from-primary/90 hover:to-purple-600/90 shadow-lg"
                  >
                    {language === 'fr' ? 'Accepter' : 'Accept Ride'}
                  </Button>
                </div>
              </div>
            </Card>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
