import { motion } from 'framer-motion';
import { Wifi, WifiOff, Clock, Gauge, RefreshCw, Database, AlertTriangle, Check, Loader2, Send, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { GPSPosition } from '@/hooks/useDriverGPSStreaming';

interface DriverGPSStatusIndicatorProps {
  isStreaming: boolean;
  isConnected: boolean;
  position: GPSPosition | null;
  secondsSinceLastUpdate: number;
  secondsSinceDbSync: number | null;
  secondsSinceLastGpsFix: number | null;
  retryCount: number;
  onRetry: () => void;
  onForceSend: () => void;
  rideId: string | null;
  // DB write status props
  lastDbWriteError: string | null;
  dbWriteRetryCount: number;
  isDbSyncing: boolean;
  authStatus: 'ok' | 'signed_out';
  historyWriteCount?: number;
}

export function DriverGPSStatusIndicator({
  isStreaming,
  isConnected,
  position,
  secondsSinceLastUpdate,
  secondsSinceDbSync,
  secondsSinceLastGpsFix,
  retryCount,
  onRetry,
  onForceSend,
  rideId,
  lastDbWriteError,
  dbWriteRetryCount,
  isDbSyncing,
  authStatus,
  historyWriteCount = 0,
}: DriverGPSStatusIndicatorProps) {
  const { t } = useLanguage();

  // Determine overall status
  const getGpsStatus = (): 'ok' | 'warning' | 'error' => {
    if (!isStreaming) return 'error';
    if (!isConnected) return 'error';
    if (secondsSinceLastGpsFix !== null && secondsSinceLastGpsFix > 10) return 'warning';
    return 'ok';
  };

  const getDbStatus = (): 'ok' | 'warning' | 'error' | 'syncing' => {
    if (authStatus === 'signed_out') return 'error';
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
      case 'ok': return 'text-green-600';
      case 'warning': return 'text-yellow-600';
      case 'error': return 'text-red-600';
      case 'syncing': return 'text-blue-600';
    }
  };

  const getStatusBgColor = (status: 'ok' | 'warning' | 'error' | 'syncing') => {
    switch (status) {
      case 'ok': return 'bg-green-500/20 border-green-500/30';
      case 'warning': return 'bg-yellow-500/20 border-yellow-500/30';
      case 'error': return 'bg-red-500/20 border-red-500/30';
      case 'syncing': return 'bg-blue-500/20 border-blue-500/30';
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
        {/* RideId Display */}
        {rideId && (
          <div className="mb-2 text-xs text-muted-foreground flex items-center gap-1.5">
            <MapPin className="w-3 h-3" />
            <span className="font-mono truncate">RideId: {rideId}</span>
          </div>
        )}

        {/* Main Status Row */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
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
              ? 'border-green-500/50' 
              : secondsSinceDbSync !== null && secondsSinceDbSync <= 10
              ? 'border-yellow-500/50'
              : 'border-red-500/50'
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

        {/* Heartbeat details */}
        <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
          <div className="flex items-center justify-between rounded-md bg-background/50 border border-border/50 px-2 py-1">
            <span>DB write</span>
            <span className={`font-mono ${secondsSinceDbSync !== null && secondsSinceDbSync <= 5 ? 'text-green-600' : secondsSinceDbSync !== null && secondsSinceDbSync <= 10 ? 'text-yellow-600' : 'text-red-600'}`}>
              {secondsSinceDbSync === null ? '--' : `${secondsSinceDbSync}s`}
            </span>
          </div>
          <div className="flex items-center justify-between rounded-md bg-background/50 border border-border/50 px-2 py-1">
            <span>GPS fix</span>
            <span className={`font-mono ${secondsSinceLastGpsFix !== null && secondsSinceLastGpsFix <= 5 ? 'text-green-600' : secondsSinceLastGpsFix !== null && secondsSinceLastGpsFix <= 10 ? 'text-yellow-600' : 'text-red-600'}`}>
              {secondsSinceLastGpsFix === null ? '--' : `${secondsSinceLastGpsFix}s`}
            </span>
          </div>
          <div className="flex items-center justify-between rounded-md bg-background/50 border border-border/50 px-2 py-1">
            <span>Writes</span>
            <span className="font-mono text-foreground">
              {historyWriteCount}
            </span>
          </div>
        </div>

        {/* SEND LOCATION NOW Button - Always visible */}
        <div className="mt-3">
          <Button
            onClick={onForceSend}
            disabled={isDbSyncing || !position}
            className="w-full bg-primary hover:bg-primary/90"
            size="sm"
          >
            {isDbSyncing ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Send className="w-4 h-4 mr-2" />
            )}
            SEND LOCATION NOW
          </Button>
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
              <div className="text-muted-foreground font-mono text-[10px]">
                {position.lat.toFixed(5)}, {position.lng.toFixed(5)}
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
            <div className="flex items-start gap-2 text-xs text-red-600">
              <Database className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <div>
                <span className="font-medium">DB write failed: </span>
                <span className="text-muted-foreground">{lastDbWriteError}</span>
                {dbWriteRetryCount > 0 && (
                  <span className="ml-1 text-yellow-600">(retry #{dbWriteRetryCount})</span>
                )}
              </div>
            </div>
          </motion.div>
        )}

        {/* Auth signed out warning */}
        {authStatus === 'signed_out' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="mt-2 pt-2 border-t border-border/30"
          >
            <p className="text-xs text-red-600 flex items-center gap-1.5 font-medium">
              <AlertTriangle className="w-4 h-4" />
              Signed out – cannot send GPS
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
            <p className="text-xs text-red-600 flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
              </span>
              ⚠️ No active ride - location NOT being saved
            </p>
          </motion.div>
        )}

        {/* Warning message if stale */}
        {secondsSinceDbSync !== null && secondsSinceDbSync > 10 && !lastDbWriteError && authStatus === 'ok' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="mt-2 pt-2 border-t border-border/30"
          >
            <p className="text-xs text-yellow-600 flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-500 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-yellow-500"></span>
              </span>
              {t('riderMayNotSee') || "Rider may not see your current position"}
            </p>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}
