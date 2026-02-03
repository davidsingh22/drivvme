import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { Sun } from 'lucide-react';
import { useWakeLock } from '@/hooks/useWakeLock';
import { useLanguage } from '@/contexts/LanguageContext';

interface DriverWakeLockBannerProps {
  isOnline: boolean;
  hasActiveRide: boolean;
}

export function DriverWakeLockBanner({ isOnline, hasActiveRide }: DriverWakeLockBannerProps) {
  const { isSupported, isActive, requestWakeLock } = useWakeLock();
  const { t } = useLanguage();

  // Auto-enable wake lock when driver is online or has active ride
  useEffect(() => {
    if ((isOnline || hasActiveRide) && isSupported && !isActive) {
      requestWakeLock();
    }
  }, [isOnline, hasActiveRide, isSupported, isActive, requestWakeLock]);

  // Only show when driver is online or has active ride AND wake lock is active
  if (!isOnline && !hasActiveRide) return null;
  if (!isActive) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-4 mb-3"
    >
      <div className="rounded-xl border border-success/30 bg-success/10 backdrop-blur-sm p-3 flex items-center gap-3">
        <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-success/20 flex items-center justify-center">
          <Sun className="w-4.5 h-4.5 text-success animate-pulse" />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">
            {t('screenAwake') || 'Screen Awake'}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {t('screenWillStayOn') || 'Screen will stay on for tracking'}
          </p>
        </div>
      </div>
    </motion.div>
  );
}
