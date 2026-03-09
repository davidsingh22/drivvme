import { useEffect, useRef, useCallback, useState } from 'react';
import { upsertDriverLocation, setDriverOffline } from '@/lib/driverLocation';

interface UseDriverLocationTrackingOptions {
  userId: string | undefined;
  driverId: string | undefined;
  isOnline: boolean;
  updateIntervalMs?: number;
}

export function useDriverLocationTracking({
  userId,
  driverId,
  isOnline,
  updateIntervalMs = 4000
}: UseDriverLocationTrackingOptions) {
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const errorSuppressedUntilRef = useRef<number>(0);
  const [isTracking, setIsTracking] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [permissionStatus, setPermissionStatus] = useState<'unknown' | 'granted' | 'denied' | 'prompt'>('unknown');

  // Check geolocation permission on mount
  useEffect(() => {
    if ('permissions' in navigator) {
      navigator.permissions.query({ name: 'geolocation' }).then((result) => {
        console.log('[DriverLocationTracking] Permission status:', result.state);
        setPermissionStatus(result.state as 'granted' | 'denied' | 'prompt');
        
        result.onchange = () => {
          console.log('[DriverLocationTracking] Permission changed:', result.state);
          setPermissionStatus(result.state as 'granted' | 'denied' | 'prompt');
        };
      }).catch((err) => {
        console.warn('[DriverLocationTracking] Permission query failed:', err);
      });
    }
  }, []);

  const updateOnce = useCallback(async (online: boolean) => {
    if (!userId || !driverId) {
      console.warn('[DriverLocationTracking] Missing userId or driverId', { userId, driverId });
      return;
    }

    console.log('[DriverLocationTracking] Getting position...', { userId, driverId, online });

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const heading = pos.coords.heading;
        const speedKph = pos.coords.speed != null ? pos.coords.speed * 3.6 : null;

        console.log('[DriverLocationTracking] Got position:', { lat, lng, heading, speedKph });
        setLocationError(null);

        try {
          await upsertDriverLocation({
            driverId,
            userId,
            lat,
            lng,
            heading: heading ?? null,
            speedKph,
            isOnline: online,
          });
          console.log('[DriverLocationTracking] Upsert successful');
          setLastUpdate(new Date());
        } catch (err) {
          console.error('[DriverLocationTracking] Upsert error:', err);
          setLocationError('Failed to save location');
        }
      },
      (error) => {
        console.error('[DriverLocationTracking] Geolocation error:', error.code, error.message);
        // Don't re-set error during grace period (after resetLocationError was called)
        if (Date.now() < errorSuppressedUntilRef.current) {
          console.log('[DriverLocationTracking] Error suppressed during grace period');
          return;
        }
        setLocationError(error.message);
        
        if (error.code === 1) {
          setPermissionStatus('denied');
        }
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
    );
  }, [userId, driverId]);

  const startSharing = useCallback(async () => {
    if (!userId || !driverId) {
      console.warn('[DriverLocationTracking] Cannot start - missing ids', { userId, driverId });
      return;
    }
    
    if (timerRef.current) {
      console.log('[DriverLocationTracking] Already tracking, skipping start');
      return;
    }

    console.log('[DriverLocationTracking] Starting location sharing...', { userId, driverId });
    
    // First update immediately
    await updateOnce(true);
    
    // Then set interval
    timerRef.current = setInterval(() => updateOnce(true), updateIntervalMs);
    setIsTracking(true);
    console.log('[DriverLocationTracking] Tracking started, interval:', updateIntervalMs);
  }, [userId, driverId, updateOnce, updateIntervalMs]);

  const stopSharing = useCallback(async () => {
    console.log('[DriverLocationTracking] Stopping location sharing...');

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (driverId) {
      try {
        await setDriverOffline(driverId);
        console.log('[DriverLocationTracking] Set offline successful');
      } catch (err) {
        console.error('[DriverLocationTracking] Error setting offline:', err);
      }
    }

    setIsTracking(false);
    setLocationError(null);
  }, [driverId]);

  // Start/stop based on online status
  useEffect(() => {
    console.log('[DriverLocationTracking] Effect triggered:', { isOnline, userId, driverId, isTracking });
    
    if (isOnline && userId && driverId && !isTracking) {
      startSharing();
    } else if (!isOnline && isTracking) {
      stopSharing();
    }
  }, [isOnline, userId, driverId, isTracking, startSharing, stopSharing]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      console.log('[DriverLocationTracking] Cleanup on unmount');
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  // Allow external callers (e.g. resume handler) to clear stale errors
  const resetLocationError = useCallback(() => {
    setLocationError(null);
    // Suppress errors for 15 seconds so the interval doesn't immediately re-set them
    errorSuppressedUntilRef.current = Date.now() + 15000;
    // Re-query permission status so UI updates if user granted in Settings
    if ('permissions' in navigator) {
      navigator.permissions.query({ name: 'geolocation' }).then((result) => {
        setPermissionStatus(result.state as 'granted' | 'denied' | 'prompt');
      }).catch(() => {});
    }
  }, []);

  return {
    isTracking,
    lastUpdate,
    locationError,
    permissionStatus,
    stopSharing,
    resetLocationError,
  };
}