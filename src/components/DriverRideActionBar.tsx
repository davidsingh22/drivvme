import { MapPin, PlayCircle, CheckCircle, XCircle } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';

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

/** Tap-safe button: fires on DOWN/START + capture phase to beat map overlays */
function TapButton({
  children,
  disabled,
  className,
  style,
  onTap,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  onTap: () => void;
}) {
  const firedRef = useRef<number>(0);

  const fireOnce = useCallback(() => {
    const now = Date.now();
    if (now - firedRef.current < 600) return;
    firedRef.current = now;
    onTap();
  }, [onTap]);

  const handle = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    if (!disabled) fireOnce();
  };

  return (
    <button
      type="button"
      disabled={disabled}
      className={className}
      style={{
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTapHighlightColor: 'transparent',
        touchAction: 'manipulation',
        ...style,
      }}
      onPointerDownCapture={handle}
      onTouchStartCapture={handle}
      onClick={handle}
    >
      {children}
    </button>
  );
}

/**
 * Reusable ride action bar — renders all 4 buttons ALWAYS.
 * Buttons that don't apply to the current status are disabled (never hidden).
 * Uses tap-safe buttons to prevent iOS triple-tap issues.
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
    <div
      className="space-y-2"
      onPointerDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
    >
      {/* I've Arrived */}
      <TapButton
        className={cn('w-full font-bold rounded-xl flex items-center justify-center gap-2', btnH)}
        style={{
          backgroundColor: arrivedEnabled ? 'hsl(45, 93%, 47%)' : 'hsl(45, 20%, 55%)',
          color: 'hsl(0, 0%, 10%)',
        }}
        disabled={isUpdating || !arrivedEnabled}
        onTap={arrivedEnabled ? onArrived : () => handleDisabledClick(
          language === 'fr' ? 'Non disponible dans ce statut' : 'Not available at this stage'
        )}
      >
        <MapPin className="h-5 w-5" />
        {isUpdating && arrivedEnabled
          ? (language === 'fr' ? 'Mise à jour...' : 'Updating...')
          : (language === 'fr' ? 'Je suis arrivé' : "I've Arrived")}
      </TapButton>

      {/* Start Ride */}
      <TapButton
        className={cn(
          'w-full font-bold rounded-xl flex items-center justify-center gap-2',
          btnH,
          startEnabled ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-green-600/30 text-white/50'
        )}
        disabled={isUpdating || !startEnabled}
        onTap={startEnabled ? onStartRide : () => handleDisabledClick(
          language === 'fr' ? "Arrivez d'abord au point de ramassage" : 'Arrive at pickup first'
        )}
      >
        <PlayCircle className="h-5 w-5" />
        {isUpdating && startEnabled
          ? (language === 'fr' ? 'Démarrage...' : 'Starting...')
          : (language === 'fr' ? 'Démarrer la course' : 'Start Ride')}
      </TapButton>

      {/* Complete Ride */}
      <TapButton
        className={cn(
          'w-full font-bold rounded-xl flex items-center justify-center gap-2',
          btnH,
          completeEnabled ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-green-600/30 text-white/50'
        )}
        disabled={isUpdating || !completeEnabled}
        onTap={completeEnabled ? onCompleteRide : () => handleDisabledClick(
          language === 'fr' ? "Démarrez la course d'abord" : 'Start the ride first'
        )}
      >
        <CheckCircle className="h-5 w-5" />
        {isUpdating && completeEnabled
          ? (language === 'fr' ? 'Finalisation...' : 'Completing...')
          : (language === 'fr' ? 'Terminer la course' : 'Complete Ride')}
      </TapButton>

      {/* Cancel Ride - always enabled */}
      <TapButton
        className={cn('w-full font-bold rounded-xl flex items-center justify-center gap-2', btnH)}
        style={{ backgroundColor: 'hsl(75, 80%, 50%)', color: 'hsl(0, 0%, 10%)' }}
        disabled={isUpdating}
        onTap={onCancelRide}
      >
        <XCircle className="h-5 w-5" />
        {isUpdating
          ? (language === 'fr' ? 'Annulation...' : 'Cancelling...')
          : (language === 'fr' ? 'Annuler la course' : 'Cancel Ride')}
      </TapButton>
    </div>
  );
};

export default DriverRideActionBar;
