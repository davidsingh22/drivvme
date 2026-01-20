import { motion, AnimatePresence } from 'framer-motion';
import { Car, MapPin, Clock, CheckCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';

interface RideStatusBannerProps {
  status: string;
  driverName?: string;
  pickupAddress: string;
  onViewDetails?: () => void;
  onDismiss?: () => void;
}

const statusConfig: Record<string, { icon: typeof Car; label: string; color: string; pulse: boolean }> = {
  searching: {
    icon: Clock,
    label: 'Looking for a driver...',
    color: 'bg-yellow-500',
    pulse: true,
  },
  driver_assigned: {
    icon: Car,
    label: 'Driver found!',
    color: 'bg-green-500',
    pulse: true,
  },
  driver_en_route: {
    icon: Car,
    label: 'Driver is on the way',
    color: 'bg-blue-500',
    pulse: true,
  },
  arrived: {
    icon: MapPin,
    label: 'Driver has arrived!',
    color: 'bg-green-500',
    pulse: true,
  },
  in_progress: {
    icon: Car,
    label: 'Ride in progress',
    color: 'bg-primary',
    pulse: false,
  },
  completed: {
    icon: CheckCircle,
    label: 'Ride completed',
    color: 'bg-green-500',
    pulse: false,
  },
};

export function RideStatusBanner({ 
  status, 
  driverName, 
  pickupAddress,
  onViewDetails,
  onDismiss,
}: RideStatusBannerProps) {
  const { t } = useLanguage();
  const config = statusConfig[status] || statusConfig.searching;
  const Icon = config.icon;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: -100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: -100, opacity: 0 }}
        className="fixed top-16 left-0 right-0 z-50 px-4 py-2"
      >
        <div className={`${config.color} text-white rounded-xl shadow-lg p-4 mx-auto max-w-md`}>
          <div className="flex items-center gap-3">
            <div className={`relative ${config.pulse ? 'animate-pulse' : ''}`}>
              <Icon className="h-6 w-6" />
            </div>
            
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm">{config.label}</p>
              {driverName && (
                <p className="text-xs opacity-90 truncate">
                  {driverName} is your driver
                </p>
              )}
              {status === 'arrived' && (
                <p className="text-xs opacity-90">
                  At: {pickupAddress.slice(0, 30)}...
                </p>
              )}
            </div>

            <div className="flex items-center gap-2">
              {onViewDetails && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="bg-white/20 hover:bg-white/30 text-white border-0"
                  onClick={onViewDetails}
                >
                  View
                </Button>
              )}
              {onDismiss && status === 'completed' && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 text-white hover:bg-white/20"
                  onClick={onDismiss}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
