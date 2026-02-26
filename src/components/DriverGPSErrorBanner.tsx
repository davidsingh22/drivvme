import { motion } from 'framer-motion';
import { MapPinOff, RefreshCw, Settings, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';

interface DriverGPSErrorBannerProps {
  error: GeolocationPositionError | null;
  retryCount: number;
  onRetry: () => void;
}

export function DriverGPSErrorBanner({ error, retryCount, onRetry }: DriverGPSErrorBannerProps) {
  const { t } = useLanguage();

  if (!error) return null;

  const isPermissionDenied = error.code === 1;
  const isPositionUnavailable = error.code === 2;
  const isTimeout = error.code === 3;

  const getErrorTitle = () => {
    const key = isPermissionDenied ? 'gpsPermissionDenied' : isPositionUnavailable ? 'gpsUnavailable' : isTimeout ? 'gpsTimeout' : 'gpsError';
    const fallback = isPermissionDenied ? 'Location Access Blocked' : isPositionUnavailable ? 'GPS Signal Lost' : isTimeout ? 'Location Timeout' : 'Location Error';
    const translated = t(key);
    return translated !== key ? translated : fallback;
  };

  const getErrorMessage = () => {
    if (isPermissionDenied) {
      const val = t('gpsPermissionDeniedMsg');
      return val !== 'gpsPermissionDeniedMsg' ? val : 'Please enable location access in your browser/device settings to continue tracking.';
    }
    if (isPositionUnavailable) {
      const val = t('gpsUnavailableMsg');
      return val !== 'gpsUnavailableMsg' ? val : 'Unable to get your location. Make sure GPS is enabled and you have a clear view of the sky.';
    }
    if (isTimeout) {
      const val = t('gpsTimeoutMsg');
      return val !== 'gpsTimeoutMsg' ? val : 'Location request timed out. Retrying...';
    }
    return error.message;
  };

  const getInstructions = () => {
    if (!isPermissionDenied) return null;

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isAndroid = /Android/.test(navigator.userAgent);

    if (isIOS) {
      return (
        <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside mt-2">
          <li>Open <strong>Settings</strong> → <strong>Privacy & Security</strong> → <strong>Location Services</strong></li>
          <li>Find your browser (Safari/Chrome) and set to <strong>While Using</strong></li>
          <li>Return to this app and tap Retry</li>
        </ol>
      );
    }

    if (isAndroid) {
      return (
        <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside mt-2">
          <li>Tap the lock icon in the address bar</li>
          <li>Select <strong>Permissions</strong> → <strong>Location</strong> → <strong>Allow</strong></li>
          <li>Or go to <strong>Settings</strong> → <strong>Apps</strong> → Browser → Permissions</li>
        </ol>
      );
    }

    return (
      <p className="text-xs text-muted-foreground mt-2">
        Check your browser's address bar for location permission settings.
      </p>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="mx-4 mb-3"
    >
      <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-destructive/20 flex items-center justify-center">
            {isPermissionDenied ? (
              <MapPinOff className="w-5 h-5 text-destructive" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-destructive" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
              {getErrorTitle()}
              {retryCount > 0 && !isPermissionDenied && (
                <span className="text-xs font-normal text-muted-foreground">
                  (Retry {retryCount}/5)
                </span>
              )}
            </h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              {getErrorMessage()}
            </p>
            
            {getInstructions()}

            <div className="flex gap-2 mt-3">
              <Button
                size="sm"
                variant={isPermissionDenied ? "default" : "outline"}
                onClick={onRetry}
                className="gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                {(() => { const v = t('retry'); return v !== 'retry' ? v : 'Retry'; })()}
              </Button>
              
              {isPermissionDenied && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1.5 text-muted-foreground"
                  onClick={() => {
                    // Try to open app settings on supported browsers
                    if ('permissions' in navigator) {
                      navigator.permissions.query({ name: 'geolocation' }).then(() => {
                        // Can't directly open settings, but query refreshes state
                        onRetry();
                      });
                    }
                  }}
                >
                  <Settings className="w-3.5 h-3.5" />
                  {(() => { const v = t('openSettings'); return v !== 'openSettings' ? v : 'Check Settings'; })()}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Pulsing warning indicator */}
        <div className="mt-3 flex items-center gap-2 text-xs text-destructive">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-destructive"></span>
          </span>
          {(() => { const v = t('riderCannotSeeYou'); return v !== 'riderCannotSeeYou' ? v : "Rider can't see your live location"; })()}
        </div>
      </div>
    </motion.div>
  );
}
