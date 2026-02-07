import { MapPin, PlayCircle, CheckCircle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';

interface DriverRideActionBarProps {
  rideStatus?: string;
  onArrived: () => void;
  onStartRide: () => void;
  onCompleteRide: () => void;
  onCancelRide: () => void;
  isUpdating?: boolean;
  /** Compact mode for GPS overlay (smaller buttons) */
  compact?: boolean;
}

/**
 * Reusable ride action bar — renders all 4 buttons ALWAYS.
 * Buttons that don't apply to the current status are disabled (never hidden).
 */
const DriverRideActionBar = ({
  rideStatus,
  onArrived,
  onStartRide,
  onCompleteRide,
  onCancelRide,
  isUpdating = false,
  compact = false,
}: DriverRideActionBarProps) => {
  const { language } = useLanguage();
  const { toast } = useToast();

  const btnH = compact ? 'h-12 text-base' : 'py-6 text-lg';

  const arrivedEnabled = !rideStatus || rideStatus === 'driver_assigned' || rideStatus === 'driver_en_route';
  const startEnabled = rideStatus === 'arrived';
  const completeEnabled = rideStatus === 'in_progress';

  const handleDisabledClick = (reason: string) => {
    toast({ title: reason, variant: 'destructive' });
  };

  return (
    <div className="space-y-2">
      {/* I've Arrived */}
      <Button
        className={`w-full ${btnH} font-bold text-white rounded-xl touch-manipulation`}
        style={{ backgroundColor: arrivedEnabled ? 'hsl(45, 93%, 47%)' : 'hsl(45, 20%, 55%)', color: 'hsl(0, 0%, 10%)' }}
        disabled={isUpdating || !arrivedEnabled}
        onClick={arrivedEnabled ? onArrived : () => handleDisabledClick(
          language === 'fr' ? 'Non disponible dans ce statut' : 'Not available at this stage'
        )}
      >
        <MapPin className="h-5 w-5 mr-2" />
        {isUpdating && arrivedEnabled
          ? (language === 'fr' ? 'Mise à jour...' : 'Updating...')
          : (language === 'fr' ? 'Je suis arrivé' : "I've Arrived")}
      </Button>

      {/* Start Ride */}
      <Button
        className={`w-full ${btnH} font-bold rounded-xl touch-manipulation ${
          startEnabled ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-green-600/30 text-white/50'
        }`}
        disabled={isUpdating || !startEnabled}
        onClick={startEnabled ? onStartRide : () => handleDisabledClick(
          language === 'fr' ? 'Arrivez d\'abord au point de ramassage' : 'Arrive at pickup first'
        )}
      >
        <PlayCircle className="h-5 w-5 mr-2" />
        {isUpdating && startEnabled
          ? (language === 'fr' ? 'Démarrage...' : 'Starting...')
          : (language === 'fr' ? 'Démarrer la course' : 'Start Ride')}
      </Button>

      {/* Complete Ride */}
      <Button
        className={`w-full ${btnH} font-bold rounded-xl touch-manipulation ${
          completeEnabled ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-green-600/30 text-white/50'
        }`}
        disabled={isUpdating || !completeEnabled}
        onClick={completeEnabled ? onCompleteRide : () => handleDisabledClick(
          language === 'fr' ? 'Démarrez la course d\'abord' : 'Start the ride first'
        )}
      >
        <CheckCircle className="h-5 w-5 mr-2" />
        {isUpdating && completeEnabled
          ? (language === 'fr' ? 'Finalisation...' : 'Completing...')
          : (language === 'fr' ? 'Terminer la course' : 'Complete Ride')}
      </Button>

      {/* Cancel Ride - always enabled */}
      <Button
        className={`w-full ${btnH} font-bold rounded-xl touch-manipulation`}
        style={{ backgroundColor: 'hsl(75, 80%, 50%)', color: 'hsl(0, 0%, 10%)' }}
        disabled={isUpdating}
        onClick={onCancelRide}
      >
        <XCircle className="h-5 w-5 mr-2" />
        {isUpdating
          ? (language === 'fr' ? 'Annulation...' : 'Cancelling...')
          : (language === 'fr' ? 'Annuler la course' : 'Cancel Ride')}
      </Button>
    </div>
  );
};

export default DriverRideActionBar;
