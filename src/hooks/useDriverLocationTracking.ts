import { useEffect, useRef, useCallback, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

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
      const { error } = await supabase
        .from('driver_locations')
        .upsert({
          driver_id: driverId,
          user_id: userId,
          lat,
          lng,
          heading,
          speed_kph: speedKph,
          is_online: true,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'driver_id'
        });

      if (error) {
        console.error('[DriverLocationTracking] Error updating location:', error);
      } else {
        setLastUpdate(new Date());
      }
    } catch (err) {
      console.error('[DriverLocationTracking] Exception:', err);
    }
  }, [userId, driverId]);

  const setOffline = useCallback(async () => {
    if (!driverId) return;

    try {
      await supabase
        .from('driver_locations')
        .update({ 
          is_online: false,
          updated_at: new Date().toISOString()
        })
        .eq('driver_id', driverId);
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

    setOffline();
    setIsTracking(false);
  }, [setOffline]);

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

  // Cleanup on unmount and set offline
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