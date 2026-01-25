import { motion } from 'framer-motion';
import { Wifi, WifiOff, MapPin, Clock, Gauge, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { GPSPosition } from '@/hooks/useDriverGPSStreaming';

interface DriverGPSStatusIndicatorProps {
  isStreaming: boolean;
  isConnected: boolean;
  position: GPSPosition | null;
  secondsSinceLastUpdate: number;
  retryCount: number;
  onRetry: () => void;
  rideId: string | null;
}

export function DriverGPSStatusIndicator({
  isStreaming,
  isConnected,
  position,
  secondsSinceLastUpdate,
  retryCount,
  onRetry,
  rideId,
}: DriverGPSStatusIndicatorProps) {
  const { t } = useLanguage();

  // Determine status color
  const getStatusColor = () => {
    if (!isStreaming) return 'text-muted-foreground';
    if (!isConnected || secondsSinceLastUpdate > 10) return 'text-warning';
    if (secondsSinceLastUpdate > 5) return 'text-warning';
    return 'text-success';
  };

  const getStatusBgColor = () => {
    if (!isStreaming) return 'bg-muted';
    if (!isConnected || secondsSinceLastUpdate > 10) return 'bg-warning/20';
    if (secondsSinceLastUpdate > 5) return 'bg-warning/10';
    return 'bg-success/20';
  };

  const formatSpeed = (speedMs: number | null) => {
    if (speedMs === null || speedMs < 0) return '--';
    const speedKmh = speedMs * 3.6;
    return `${Math.round(speedKmh)}`;
  };

  const formatAccuracy = (accuracy: number) => {
    if (accuracy < 10) return 'Excellent';
    if (accuracy < 30) return 'Good';
    if (accuracy < 100) return 'Fair';
    return 'Poor';
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-4 mb-3"
    >
      <div className={`rounded-xl border p-3 ${getStatusBgColor()} border-border/50`}>
        <div className="flex items-center justify-between">
          {/* GPS Status */}
          <div className="flex items-center gap-3">
            <div className={`flex items-center gap-1.5 ${getStatusColor()}`}>
              {isConnected ? (
                <motion.div
                  animate={{ opacity: [1, 0.4, 1] }}
                  transition={{ duration: 1, repeat: Infinity }}
                >
                  <Wifi className="w-4 h-4" />
                </motion.div>
              ) : (
                <WifiOff className="w-4 h-4" />
              )}
              <span className="text-xs font-medium">
                {isConnected 
                  ? (t('gpsConnected') || 'GPS Connected')
                  : (t('gpsLost') || 'GPS Lost')
                }
              </span>
            </div>

            {/* Last update time */}
            {isStreaming && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="w-3 h-3" />
                <span>
                  {secondsSinceLastUpdate === 0 
                    ? (t('justNow') || 'Just now')
                    : `${secondsSinceLastUpdate}s ago`
                  }
                </span>
              </div>
            )}
          </div>

          {/* Speed & Accuracy */}
          <div className="flex items-center gap-3">
            {position && (
              <>
                <div className="flex items-center gap-1 text-xs">
                  <Gauge className="w-3.5 h-3.5 text-primary" />
                  <span className="font-medium">{formatSpeed(position.speed)} km/h</span>
                </div>
                
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="w-3 h-3" />
                  <span>±{Math.round(position.accuracy)}m</span>
                </div>
              </>
            )}

            {/* Retry button if issues */}
            {(!isConnected || secondsSinceLastUpdate > 15) && (
              <Button
                size="sm"
                variant="ghost"
                onClick={onRetry}
                className="h-6 px-2 text-xs"
              >
                <RefreshCw className="w-3 h-3 mr-1" />
                {t('retry') || 'Retry'}
              </Button>
            )}
          </div>
        </div>

        {/* Ride ID Debug Display */}
        <div className="mt-2 pt-2 border-t border-border/30">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Active Ride ID:</span>
            <span className={`font-mono ${rideId ? 'text-primary' : 'text-destructive'}`}>
              {rideId ? rideId.slice(0, 12) + '...' : 'NULL (not streaming to DB)'}
            </span>
          </div>
          {position && (
            <div className="flex items-center justify-between text-xs mt-1">
              <span className="text-muted-foreground">Lat/Lng:</span>
              <span className="font-mono text-foreground">
                {position.lat.toFixed(6)}, {position.lng.toFixed(6)}
              </span>
            </div>
          )}
        </div>

        {/* Warning message if stale */}
        {secondsSinceLastUpdate > 10 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="mt-2 pt-2 border-t border-border/30"
          >
            <p className="text-xs text-warning flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-warning opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-warning"></span>
              </span>
              {t('riderMayNotSee') || "Rider may not see your current position"}
            </p>
          </motion.div>
        )}

        {/* Warning if no rideId */}
        {!rideId && isStreaming && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="mt-2 pt-2 border-t border-border/30"
          >
            <p className="text-xs text-destructive flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-destructive"></span>
              </span>
              ⚠️ No active ride - location NOT being saved to ride_locations
            </p>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}
