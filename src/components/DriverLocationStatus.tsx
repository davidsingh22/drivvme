import { MapPin, MapPinOff, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DriverLocationStatusProps {
  isTracking: boolean;
  lastUpdate: Date | null;
  locationError: string | null;
  permissionStatus: 'unknown' | 'granted' | 'denied' | 'prompt';
  isOnline: boolean;
}

export function DriverLocationStatus({
  isTracking,
  lastUpdate,
  locationError,
  permissionStatus,
  isOnline
}: DriverLocationStatusProps) {
  if (!isOnline) {
    return null;
  }

  const getStatus = () => {
    if (permissionStatus === 'denied') {
      return {
        icon: MapPinOff,
        text: 'Location denied',
        color: 'text-destructive',
        bg: 'bg-destructive/10'
      };
    }
    
    if (locationError) {
      return {
        icon: AlertTriangle,
        text: 'Location error',
        color: 'text-amber-500',
        bg: 'bg-amber-500/10'
      };
    }
    
    if (isTracking && lastUpdate) {
      const secondsAgo = Math.floor((Date.now() - lastUpdate.getTime()) / 1000);
      return {
        icon: MapPin,
        text: secondsAgo < 10 ? 'Location sharing' : `Updated ${secondsAgo}s ago`,
        color: 'text-emerald-500',
        bg: 'bg-emerald-500/10'
      };
    }
    
    if (permissionStatus === 'prompt') {
      return {
        icon: MapPin,
        text: 'Waiting for permission...',
        color: 'text-amber-500',
        bg: 'bg-amber-500/10'
      };
    }
    
    return {
      icon: MapPin,
      text: 'Starting location...',
      color: 'text-muted-foreground',
      bg: 'bg-muted'
    };
  };

  const status = getStatus();
  const Icon = status.icon;

  return (
    <div className={cn(
      'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium',
      status.bg,
      status.color
    )}>
      <Icon className="h-3.5 w-3.5" />
      <span>{status.text}</span>
      {isTracking && (
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-current opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-current"></span>
        </span>
      )}
    </div>
  );
}