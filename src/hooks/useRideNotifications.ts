import { useEffect, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';

type RidePhase = 'matched' | 'arriving' | 'arrived' | 'inProgress' | 'completed';

interface UseRideNotificationsProps {
  phase: RidePhase;
  driverName: string;
  minutesAway: number | null;
  language: 'en' | 'fr';
}

const useRideNotifications = ({
  phase,
  driverName,
  minutesAway,
  language,
}: UseRideNotificationsProps) => {
  const { toast } = useToast();
  const lastPhaseRef = useRef<RidePhase | null>(null);
  const notifiedArrivingSoon = useRef(false);

  useEffect(() => {
    // Don't notify on initial render or if phase hasn't changed
    if (lastPhaseRef.current === phase) return;
    
    const previousPhase = lastPhaseRef.current;
    lastPhaseRef.current = phase;

    // Don't notify on initial mount
    if (previousPhase === null) return;

    switch (phase) {
      case 'arriving':
        toast({
          title: language === 'fr' ? 'Chauffeur en route' : 'Driver on the way',
          description: language === 'fr' 
            ? `${driverName} est en route vers vous` 
            : `${driverName} is heading to your pickup`,
        });
        break;
      case 'arrived':
        toast({
          title: language === 'fr' ? 'Chauffeur arrivé!' : 'Driver arrived!',
          description: language === 'fr' 
            ? `${driverName} vous attend` 
            : `${driverName} is waiting for you`,
        });
        // Vibrate if supported
        if ('vibrate' in navigator) {
          navigator.vibrate([200, 100, 200]);
        }
        break;
      case 'inProgress':
        toast({
          title: language === 'fr' ? 'Trajet commencé' : 'Trip started',
          description: language === 'fr' ? 'Bon voyage!' : 'Enjoy your ride!',
        });
        break;
      case 'completed':
        toast({
          title: language === 'fr' ? 'Trajet terminé' : 'Trip completed',
          description: language === 'fr' 
            ? 'Merci d\'avoir choisi Drivvme!' 
            : 'Thanks for riding with Drivvme!',
        });
        break;
    }
  }, [phase, driverName, language, toast]);

  // "Arriving soon" notification when driver is 2 minutes away
  useEffect(() => {
    if (
      phase === 'arriving' && 
      minutesAway !== null && 
      minutesAway <= 2 && 
      !notifiedArrivingSoon.current
    ) {
      notifiedArrivingSoon.current = true;
      toast({
        title: language === 'fr' ? 'Presque là!' : 'Almost there!',
        description: language === 'fr' 
          ? `${driverName} arrive dans ${minutesAway} min` 
          : `${driverName} arrives in ${minutesAway} min`,
      });
      // Gentle vibration
      if ('vibrate' in navigator) {
        navigator.vibrate(100);
      }
    }
  }, [phase, minutesAway, driverName, language, toast]);

  // Reset arriving soon flag when phase changes
  useEffect(() => {
    if (phase !== 'arriving') {
      notifiedArrivingSoon.current = false;
    }
  }, [phase]);
};

export default useRideNotifications;
