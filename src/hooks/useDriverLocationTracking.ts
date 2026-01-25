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
  const [isTracking, setIsTracking] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const updateOnce = useCallback(async (online: boolean) => {
    if (!userId || !driverId) return;

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const heading = pos.coords.heading;
        const speedKph = pos.coords.speed != null ? pos.coords.speed * 3.6 : null;

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
          setLastUpdate(new Date());
        } catch (err) {
          console.error('[DriverLocationTracking] Upsert error:', err);
        }
      },
      (error) => console.error('[DriverLocationTracking] Geolocation error:', error),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
    );
  }, [userId, driverId]);

  const startSharing = useCallback(async () => {
    if (!userId || !driverId || timerRef.current) return;

    console.log('[DriverLocationTracking] Starting location sharing...');
    
    // First update immediately
    await updateOnce(true);
    
    // Then set interval
    timerRef.current = setInterval(() => updateOnce(true), updateIntervalMs);
    setIsTracking(true);
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
      } catch (err) {
        console.error('[DriverLocationTracking] Error setting offline:', err);
      }
    }

    setIsTracking(false);
  }, [driverId]);

  // Start/stop based on online status
  useEffect(() => {
    if (isOnline && userId && driverId) {
      startSharing();
    } else if (!isOnline && isTracking) {
      stopSharing();
    }
  }, [isOnline, userId, driverId, startSharing, stopSharing, isTracking]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  return {
    isTracking,
    lastUpdate,
    stopSharing
  };
}