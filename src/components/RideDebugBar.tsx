import { motion } from 'framer-motion';
import { Activity, Wifi, WifiOff, MapPin, Clock, Gauge, Target } from 'lucide-react';

interface DriverLocationData {
  lat: number;
  lng: number;
  speed?: number | null;
  accuracy?: number | null;
  heading?: number | null;
  updatedAt?: number;
}

interface RideDebugBarProps {
  rideId: string | null;
  rideStatus: string | null;
  driverLocation: DriverLocationData | null;
  lastUpdateSeconds: number;
  dataSource: 'REALTIME' | 'POLL' | 'FALLBACK' | 'NONE';
  isConnected: boolean;
  hasError: boolean;
}

export function RideDebugBar({
  rideId,
  rideStatus,
  driverLocation,
  lastUpdateSeconds,
  dataSource,
  isConnected,
  hasError,
}: RideDebugBarProps) {
  const formatCoord = (n: number | null | undefined) => 
    n != null ? n.toFixed(6) : '--';
  
  const formatSpeed = (mps: number | null | undefined) => {
    if (mps == null) return '--';
    return `${(mps * 3.6).toFixed(1)} km/h`;
  };

  const formatAccuracy = (m: number | null | undefined) => {
    if (m == null) return '--';
    return `±${m.toFixed(0)}m`;
  };

  const getStatusColor = () => {
    if (hasError) return 'bg-destructive/20 border-destructive';
    if (!isConnected) return 'bg-warning/20 border-warning';
    if (lastUpdateSeconds > 5) return 'bg-warning/20 border-warning';
    return 'bg-primary/10 border-primary';
  };

  const getDataSourceBadge = () => {
    switch (dataSource) {
      case 'REALTIME':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-primary/20 text-primary rounded">
            <Wifi className="w-3 h-3" />
            REALTIME
          </span>
        );
      case 'FALLBACK':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-secondary text-secondary-foreground rounded">
            <WifiOff className="w-3 h-3" />
            FALLBACK
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground rounded">
            NONE
          </span>
        );
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-lg border p-3 text-xs font-mono ${getStatusColor()}`}
    >
      {/* Header with error indicator */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          <span className="font-semibold text-foreground">DEBUG BAR</span>
        </div>
        {getDataSourceBadge()}
      </div>

      {/* Error banner */}
      {hasError && (
        <div className="mb-2 p-2 bg-destructive/30 rounded text-destructive-foreground text-xs font-medium">
          ⚠️ No live driver GPS updates detected (10+ seconds)
        </div>
      )}

      {/* Ride info */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
        <div className="flex items-center gap-1">
          <Target className="w-3 h-3" />
          <span>rideId:</span>
        </div>
        <span className="text-foreground truncate">{rideId || '--'}</span>

        <div className="flex items-center gap-1">
          <Activity className="w-3 h-3" />
          <span>status:</span>
        </div>
        <span className="text-foreground">{rideStatus || '--'}</span>

        <div className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          <span>lastUpdate:</span>
        </div>
        <span className={`${lastUpdateSeconds > 5 ? 'text-warning' : 'text-foreground'}`}>
          {lastUpdateSeconds}s ago
        </span>

        <div className="flex items-center gap-1">
          <MapPin className="w-3 h-3" />
          <span>lat:</span>
        </div>
        <span className="text-foreground">{formatCoord(driverLocation?.lat)}</span>

        <div className="flex items-center gap-1">
          <MapPin className="w-3 h-3" />
          <span>lng:</span>
        </div>
        <span className="text-foreground">{formatCoord(driverLocation?.lng)}</span>

        <div className="flex items-center gap-1">
          <Gauge className="w-3 h-3" />
          <span>speed:</span>
        </div>
        <span className="text-foreground">{formatSpeed(driverLocation?.speed)}</span>

        <div className="flex items-center gap-1">
          <Target className="w-3 h-3" />
          <span>accuracy:</span>
        </div>
        <span className="text-foreground">{formatAccuracy(driverLocation?.accuracy)}</span>
      </div>
    </motion.div>
  );
}
