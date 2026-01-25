import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Smartphone, Sun, X, ChevronDown, ChevronUp, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useWakeLock } from '@/hooks/useWakeLock';
import { useLanguage } from '@/contexts/LanguageContext';

interface DriverWakeLockBannerProps {
  isOnline: boolean;
  hasActiveRide: boolean;
}

export function DriverWakeLockBanner({ isOnline, hasActiveRide }: DriverWakeLockBannerProps) {
  const { isSupported, isActive, isLoading, toggleWakeLock } = useWakeLock();
  const { t } = useLanguage();
  const [isDismissed, setIsDismissed] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);

  // Only show when driver is online or has active ride
  if (!isOnline && !hasActiveRide) return null;
  if (isDismissed) return null;

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isAndroid = /Android/.test(navigator.userAgent);

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="mx-4 mb-3"
    >
      <div className="rounded-xl border border-primary/20 bg-primary/5 backdrop-blur-sm overflow-hidden">
        {/* Main Banner */}
        <div className="p-3 flex items-center gap-3">
          <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-primary/20 flex items-center justify-center">
            {isActive ? (
              <Sun className="w-4.5 h-4.5 text-primary" />
            ) : (
              <Smartphone className="w-4.5 h-4.5 text-primary" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground">
              {t('keepScreenAwake') || 'Keep Screen Awake'}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {isActive 
                ? (t('screenWillStayOn') || 'Screen will stay on for tracking')
                : (t('preventScreenDimming') || 'Prevent screen from dimming')
              }
            </p>
          </div>

          {isSupported ? (
            <div className="flex items-center gap-2">
              <Switch
                checked={isActive}
                onCheckedChange={toggleWakeLock}
                disabled={isLoading}
                className="data-[state=checked]:bg-primary"
              />
            </div>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="text-xs text-primary hover:text-primary/80 gap-1 px-2"
              onClick={() => setShowInstructions(!showInstructions)}
            >
              <Settings className="w-3.5 h-3.5" />
              {showInstructions ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </Button>
          )}

          <Button
            size="icon"
            variant="ghost"
            className="flex-shrink-0 h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={() => setIsDismissed(true)}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Instructions Panel (for unsupported browsers) */}
        <AnimatePresence>
          {!isSupported && showInstructions && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="px-3 pb-3 pt-0">
                <div className="rounded-lg bg-muted/50 p-3 space-y-2">
                  <p className="text-xs font-medium text-foreground">
                    {t('disableAutoLock') || 'To disable auto-lock:'}
                  </p>
                  
                  {isIOS && (
                    <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                      <li>{t('iosStep1') || 'Open Settings app'}</li>
                      <li>{t('iosStep2') || 'Go to Display & Brightness'}</li>
                      <li>{t('iosStep3') || 'Tap Auto-Lock'}</li>
                      <li>{t('iosStep4') || 'Select "Never"'}</li>
                    </ol>
                  )}
                  
                  {isAndroid && (
                    <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                      <li>{t('androidStep1') || 'Open Settings app'}</li>
                      <li>{t('androidStep2') || 'Go to Display → Screen timeout'}</li>
                      <li>{t('androidStep3') || 'Select maximum time or "Never"'}</li>
                    </ol>
                  )}

                  {!isIOS && !isAndroid && (
                    <p className="text-xs text-muted-foreground">
                      {t('desktopInstructions') || 'Adjust your display settings to prevent screen sleep while driving.'}
                    </p>
                  )}

                  <p className="text-xs text-warning pt-1">
                    ⚠️ {t('rememberToRevert') || 'Remember to revert this setting after your shift!'}
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Active indicator bar */}
        {isActive && (
          <motion.div 
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            className="h-0.5 bg-gradient-to-r from-primary via-primary-glow to-primary origin-left"
          />
        )}
      </div>
    </motion.div>
  );
}
