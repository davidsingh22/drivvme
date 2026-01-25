import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Phone, MessageSquare, Star, Shield, ChevronUp, ChevronDown, 
  MapPin, Navigation, DollarSign, Clock, Route, Share2, 
  CreditCard, CheckCircle2 
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useLanguage } from '@/contexts/LanguageContext';
import { formatCurrency, formatDistance, formatDuration } from '@/lib/pricing';

interface DriverInfo {
  first_name: string;
  last_name: string;
  phone_number: string | null;
  avatar_url: string | null;
  vehicle_make: string;
  vehicle_model: string;
  vehicle_color: string;
  license_plate: string;
  average_rating: number;
}

interface InRideDriverCardProps {
  driverInfo: DriverInfo;
  pickupAddress: string;
  dropoffAddress: string;
  estimatedFare: number;
  distanceKm: number;
  durationMinutes: number;
  rideId: string;
  phase: 'matched' | 'arriving' | 'arrived' | 'inProgress';
  minutesAway: number | null;
  onShareTrip: () => void;
  onSafetyPress: () => void;
}

const InRideDriverCard = ({
  driverInfo,
  pickupAddress,
  dropoffAddress,
  estimatedFare,
  distanceKm,
  durationMinutes,
  rideId,
  phase,
  minutesAway,
  onShareTrip,
  onSafetyPress,
}: InRideDriverCardProps) => {
  const { language } = useLanguage();
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <motion.div
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="absolute bottom-0 left-0 right-0 z-10"
    >
      <Card className="rounded-t-3xl rounded-b-none border-b-0 shadow-2xl">
        {/* Drag handle */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full flex justify-center py-2"
        >
          <div className="w-10 h-1 bg-muted-foreground/30 rounded-full" />
        </button>

        {/* Main driver info */}
        <div className="px-5 pb-4">
          <div className="flex items-center gap-4">
            {/* Driver avatar */}
            <div className="relative">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden">
                {driverInfo.avatar_url ? (
                  <img
                    src={driverInfo.avatar_url}
                    alt={driverInfo.first_name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-2xl font-bold text-primary">
                    {driverInfo.first_name?.[0] || 'D'}
                  </span>
                )}
              </div>
              {/* Verified badge */}
              <div className="absolute -bottom-1 -right-1 bg-success rounded-full p-1">
                <CheckCircle2 className="h-3 w-3 text-white" />
              </div>
            </div>

            {/* Driver details */}
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-lg">{driverInfo.first_name}</h3>
                <div className="flex items-center gap-0.5 bg-muted px-2 py-0.5 rounded-full">
                  <Star className="h-3 w-3 text-warning fill-warning" />
                  <span className="text-sm font-medium">
                    {Number(driverInfo.average_rating).toFixed(1)}
                  </span>
                </div>
              </div>
              <p className="text-muted-foreground text-sm">
                {driverInfo.vehicle_color} {driverInfo.vehicle_make} {driverInfo.vehicle_model}
              </p>
              <p className="font-mono font-bold text-lg tracking-wider">
                {driverInfo.license_plate}
              </p>
            </div>

            {/* Minutes away badge */}
            {minutesAway !== null && phase !== 'arrived' && phase !== 'inProgress' && (
              <div className="text-center px-3 py-2 bg-primary/10 rounded-xl">
                <p className="text-2xl font-bold text-primary">{minutesAway}</p>
                <p className="text-xs text-muted-foreground">min</p>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 mt-4">
            <Button
              asChild
              variant="outline"
              size="sm"
              className="flex-1 gap-2"
              disabled={!driverInfo.phone_number}
            >
              <a href={driverInfo.phone_number ? `tel:${driverInfo.phone_number}` : undefined}>
                <Phone className="h-4 w-4" />
                {language === 'fr' ? 'Appeler' : 'Call'}
              </a>
            </Button>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="flex-1 gap-2"
              disabled={!driverInfo.phone_number}
            >
              <a href={driverInfo.phone_number ? `sms:${driverInfo.phone_number}` : undefined}>
                <MessageSquare className="h-4 w-4" />
                {language === 'fr' ? 'Message' : 'Message'}
              </a>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={onShareTrip}
            >
              <Share2 className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-2 border-destructive/50 text-destructive hover:bg-destructive/10"
              onClick={onSafetyPress}
            >
              <Shield className="h-4 w-4" />
            </Button>
          </div>

          {/* Expand/collapse button */}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="w-full flex items-center justify-center gap-1 mt-3 text-muted-foreground text-sm"
          >
            {isExpanded ? (
              <>
                <ChevronDown className="h-4 w-4" />
                {language === 'fr' ? 'Moins de détails' : 'Less details'}
              </>
            ) : (
              <>
                <ChevronUp className="h-4 w-4" />
                {language === 'fr' ? 'Détails du trajet' : 'Trip details'}
              </>
            )}
          </button>
        </div>

        {/* Expandable trip details */}
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="px-5 pb-5 pt-2 border-t border-border space-y-4">
                {/* Route */}
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="mt-1">
                      <div className="w-3 h-3 rounded-full bg-primary" />
                    </div>
                    <div className="flex-1">
                      <p className="text-xs text-muted-foreground">
                        {language === 'fr' ? 'Départ' : 'Pickup'}
                      </p>
                      <p className="text-sm font-medium">{pickupAddress}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="mt-1">
                      <div className="w-3 h-3 rounded-full bg-accent" />
                    </div>
                    <div className="flex-1">
                      <p className="text-xs text-muted-foreground">
                        {language === 'fr' ? 'Destination' : 'Destination'}
                      </p>
                      <p className="text-sm font-medium">{dropoffAddress}</p>
                    </div>
                  </div>
                </div>

                {/* Trip stats */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="text-center p-3 bg-muted/50 rounded-xl">
                    <DollarSign className="h-4 w-4 mx-auto text-accent mb-1" />
                    <p className="font-bold">{formatCurrency(estimatedFare, language)}</p>
                    <p className="text-xs text-muted-foreground">
                      {language === 'fr' ? 'Tarif' : 'Fare'}
                    </p>
                  </div>
                  <div className="text-center p-3 bg-muted/50 rounded-xl">
                    <Route className="h-4 w-4 mx-auto text-primary mb-1" />
                    <p className="font-bold">{formatDistance(distanceKm, language)}</p>
                    <p className="text-xs text-muted-foreground">
                      {language === 'fr' ? 'Distance' : 'Distance'}
                    </p>
                  </div>
                  <div className="text-center p-3 bg-muted/50 rounded-xl">
                    <Clock className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
                    <p className="font-bold">{formatDuration(durationMinutes, language)}</p>
                    <p className="text-xs text-muted-foreground">
                      {language === 'fr' ? 'Durée' : 'Duration'}
                    </p>
                  </div>
                </div>

                {/* Payment method */}
                <div className="flex items-center justify-between p-3 bg-muted/50 rounded-xl">
                  <div className="flex items-center gap-2">
                    <CreditCard className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">
                      {language === 'fr' ? 'Paiement' : 'Payment'}
                    </span>
                  </div>
                  <span className="text-sm font-medium">•••• Card</span>
                </div>

                {/* Ride ID */}
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{language === 'fr' ? 'ID du trajet' : 'Ride ID'}</span>
                  <span className="font-mono">{rideId.slice(0, 8).toUpperCase()}</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </motion.div>
  );
};

export default InRideDriverCard;
