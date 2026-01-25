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
  updateIntervalMs = 3000
}: UseDriverLocationTrackingOptions) {
  const watchIdRef = useRef<number | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastPositionRef = useRef<GeolocationPosition | null>(null);
  const [isTracking, setIsTracking] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const updateLocation = useCallback(async (position: GeolocationPosition) => {
    if (!userId || !driverId) return;

    const { latitude: lat, longitude: lng, heading, speed } = position.coords;
    const speedKph = speed !== null ? speed * 3.6 : null; // m/s to km/h

    try {
      await upsertDriverLocation({
        driverId,
        userId,
        lat,
        lng,
        heading,
        speedKph,
        isOnline: true,
      });
      setLastUpdate(new Date());
    } catch (err) {
      console.error('[DriverLocationTracking] Error updating location:', err);
    }
  }, [userId, driverId]);

  const goOffline = useCallback(async () => {
    if (!driverId) return;

    try {
      await setDriverOffline(driverId);
    } catch (err) {
      console.error('[DriverLocationTracking] Error setting offline:', err);
    }
  }, [driverId]);

  const startTracking = useCallback(() => {
    if (!navigator.geolocation || watchIdRef.current !== null) return;

    console.log('[DriverLocationTracking] Starting tracking...');

    // Get initial position
    navigator.geolocation.getCurrentPosition(
      (position) => {
        lastPositionRef.current = position;
        updateLocation(position);
      },
      (error) => console.error('[DriverLocationTracking] Initial position error:', error),
      { enableHighAccuracy: true, timeout: 10000 }
    );

    // Watch position
    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        lastPositionRef.current = position;
      },
      (error) => console.error('[DriverLocationTracking] Watch error:', error),
      { enableHighAccuracy: true, maximumAge: 1000 }
    );

    // Interval for database updates
    intervalRef.current = setInterval(() => {
      if (lastPositionRef.current) {
        updateLocation(lastPositionRef.current);
      }
    }, updateIntervalMs);

    setIsTracking(true);
  }, [updateLocation, updateIntervalMs]);

  const stopTracking = useCallback(() => {
    console.log('[DriverLocationTracking] Stopping tracking...');

    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    goOffline();
    setIsTracking(false);
  }, [goOffline]);

  // Start/stop based on online status
  useEffect(() => {
    if (isOnline && userId && driverId) {
      startTracking();
    } else if (!isOnline && isTracking) {
      stopTracking();
    }

    return () => {
      if (isTracking) {
        stopTracking();
      }
    };
  }, [isOnline, userId, driverId, startTracking, stopTracking, isTracking]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  return {
    isTracking,
    lastUpdate,
    stopTracking
  };
}