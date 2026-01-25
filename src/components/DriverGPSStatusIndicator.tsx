import { motion } from 'framer-motion';
import { Wifi, WifiOff, Clock, Gauge, RefreshCw, Database, AlertTriangle, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { GPSPosition } from '@/hooks/useDriverGPSStreaming';

interface DriverGPSStatusIndicatorProps {
  isStreaming: boolean;
  isConnected: boolean;
  position: GPSPosition | null;
  secondsSinceLastUpdate: number;
  secondsSinceDbSync: number | null;
  retryCount: number;
  onRetry: () => void;
  rideId: string | null;
  // New DB write status props
  lastDbWriteError: string | null;
  dbWriteRetryCount: number;
  isDbSyncing: boolean;
}

export function DriverGPSStatusIndicator({
  isStreaming,
  isConnected,
  position,
  secondsSinceLastUpdate,
  secondsSinceDbSync,
  retryCount,
  onRetry,
  rideId,
  lastDbWriteError,
  dbWriteRetryCount,
  isDbSyncing,
}: DriverGPSStatusIndicatorProps) {
  const { t } = useLanguage();

  // Determine overall status
  const getGpsStatus = (): 'ok' | 'warning' | 'error' => {
    if (!isStreaming) return 'error';
    if (!isConnected) return 'error';
    if (secondsSinceLastUpdate > 10) return 'warning';
    return 'ok';
  };

  const getDbStatus = (): 'ok' | 'warning' | 'error' | 'syncing' => {
    if (isDbSyncing) return 'syncing';
    if (lastDbWriteError) return 'error';
    if (secondsSinceDbSync !== null && secondsSinceDbSync > 10) return 'warning';
    if (secondsSinceDbSync === null) return 'warning';
    return 'ok';
  };

  const gpsStatus = getGpsStatus();
  const dbStatus = getDbStatus();

  const getStatusColor = (status: 'ok' | 'warning' | 'error' | 'syncing') => {
    switch (status) {
      case 'ok': return 'text-success';
      case 'warning': return 'text-warning';
      case 'error': return 'text-destructive';
      case 'syncing': return 'text-primary';
    }
  };

  const getStatusBgColor = (status: 'ok' | 'warning' | 'error' | 'syncing') => {
    switch (status) {
      case 'ok': return 'bg-success/20 border-success/30';
      case 'warning': return 'bg-warning/20 border-warning/30';
      case 'error': return 'bg-destructive/20 border-destructive/30';
      case 'syncing': return 'bg-primary/20 border-primary/30';
    }
  };

  const formatSpeed = (speedMs: number | null) => {
    if (speedMs === null || speedMs < 0) return '--';
    const speedKmh = speedMs * 3.6;
    return `${Math.round(speedKmh)}`;
  };

  // Overall chip color based on worst status
  const overallStatus = gpsStatus === 'error' || dbStatus === 'error' 
    ? 'error' 
    : gpsStatus === 'warning' || dbStatus === 'warning'
    ? 'warning'
    : 'ok';

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-4 mb-3"
    >
      <div className={`rounded-xl border p-3 ${getStatusBgColor(overallStatus)}`}>
        {/* Main Status Row */}
        <div className="flex items-center justify-between gap-2">
          {/* GPS Status Chip */}
          <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${getStatusBgColor(gpsStatus)} ${getStatusColor(gpsStatus)}`}>
            {gpsStatus === 'ok' ? (
              <motion.div
                animate={{ opacity: [1, 0.4, 1] }}
                transition={{ duration: 1, repeat: Infinity }}
              >
                <Wifi className="w-3.5 h-3.5" />
              </motion.div>
            ) : (
              <WifiOff className="w-3.5 h-3.5" />
            )}
            <span>GPS: {gpsStatus === 'ok' ? 'ok' : gpsStatus}</span>
          </div>

          {/* DB Sync Status Chip */}
          <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${getStatusBgColor(dbStatus)} ${getStatusColor(dbStatus)}`}>
            {dbStatus === 'syncing' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : dbStatus === 'ok' ? (
              <Check className="w-3.5 h-3.5" />
            ) : dbStatus === 'warning' ? (
              <AlertTriangle className="w-3.5 h-3.5" />
            ) : (
              <AlertTriangle className="w-3.5 h-3.5" />
            )}
            <span>
              {dbStatus === 'syncing' 
                ? 'Sending...' 
                : dbStatus === 'error' 
                ? 'DB error' 
                : 'DB: ok'
              }
            </span>
          </div>

          {/* Last Sent Time - Big and Prominent */}
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-background/80 border ${
            secondsSinceDbSync !== null && secondsSinceDbSync <= 5 
              ? 'border-success/50' 
              : secondsSinceDbSync !== null && secondsSinceDbSync <= 10
              ? 'border-warning/50'
              : 'border-destructive/50'
          }`}>
            <Clock className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-bold">
              {secondsSinceDbSync === null 
                ? '--' 
                : secondsSinceDbSync === 0 
                ? 'now'
                : `${secondsSinceDbSync}s`
              }
            </span>
            <span className="text-xs text-muted-foreground">ago</span>
          </div>
        </div>

        {/* Speed & Position Row */}
        {position && (
          <div className="mt-2 pt-2 border-t border-border/30 flex items-center justify-between text-xs">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <Gauge className="w-3.5 h-3.5 text-primary" />
                <span className="font-medium">{formatSpeed(position.speed)} km/h</span>
              </div>
              <div className="text-muted-foreground">
                ±{Math.round(position.accuracy)}m
              </div>
            </div>

            {/* Retry button if issues */}
            {(gpsStatus !== 'ok' || dbStatus === 'error') && (
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
        )}

        {/* DB Error Message */}
        {lastDbWriteError && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="mt-2 pt-2 border-t border-border/30"
          >
            <div className="flex items-start gap-2 text-xs text-destructive">
              <Database className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <div>
                <span className="font-medium">DB write failed: </span>
                <span className="text-muted-foreground">{lastDbWriteError}</span>
                {dbWriteRetryCount > 0 && (
                  <span className="ml-1 text-warning">(retry #{dbWriteRetryCount})</span>
                )}
              </div>
            </div>
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
              ⚠️ No active ride - location NOT being saved
            </p>
          </motion.div>
        )}

        {/* Warning message if stale */}
        {secondsSinceDbSync !== null && secondsSinceDbSync > 10 && !lastDbWriteError && (
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
      </div>
    </motion.div>
  );
}