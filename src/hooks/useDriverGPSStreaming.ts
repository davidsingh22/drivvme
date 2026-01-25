import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface GPSPosition {
  lat: number;
  lng: number;
  heading: number | null;
  speed: number | null;
  accuracy: number;
  timestamp: number;
}

interface GPSStreamingState {
  position: GPSPosition | null;
  error: GeolocationPositionError | null;
  isStreaming: boolean;
  lastUpdateTime: number | null;
  retryCount: number;
}

interface UseDriverGPSStreamingOptions {
  driverId: string | null;
  rideId: string | null;
  isOnTrip: boolean;
  updateIntervalMs?: number; // Throttle DB updates (default 3000ms)
}

const DEFAULT_UPDATE_INTERVAL = 3000; // 3 seconds
const MAX_RETRY_COUNT = 5;
const RETRY_DELAY_MS = 2000;

export function useDriverGPSStreaming({
  driverId,
  rideId,
  isOnTrip,
  updateIntervalMs = DEFAULT_UPDATE_INTERVAL,
}: UseDriverGPSStreamingOptions) {
  const [state, setState] = useState<GPSStreamingState>({
    position: null,
    error: null,
    isStreaming: false,
    lastUpdateTime: null,
    retryCount: 0,
  });

  const watchIdRef = useRef<number | null>(null);
  const lastDbUpdateRef = useRef<number>(0);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Update location in database with throttling
  const updateLocationInDb = useCallback(async (position: GPSPosition) => {
    if (!driverId) return;

    const now = Date.now();
    if (now - lastDbUpdateRef.current < updateIntervalMs) {
      return; // Throttle updates
    }
    lastDbUpdateRef.current = now;

    try {
      const { error } = await supabase
        .from('driver_profiles')
        .update({
          current_lat: position.lat,
          current_lng: position.lng,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', driverId);

      if (error) {
        console.error('[GPS] Failed to update location:', error);
      } else {
        setState(prev => ({ ...prev, lastUpdateTime: now }));
      }
    } catch (err) {
      console.error('[GPS] Network error updating location:', err);
    }
  }, [driverId, updateIntervalMs]);

  // Start GPS streaming
  const startStreaming = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setState(prev => ({
        ...prev,
        error: {
          code: 2,
          message: 'Geolocation is not supported by this browser',
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
        } as GeolocationPositionError,
      }));
      return;
    }

    // Clear any existing watch
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }

    setState(prev => ({ ...prev, isStreaming: true, error: null }));

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const gpsPosition: GPSPosition = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          heading: position.coords.heading,
          speed: position.coords.speed,
          accuracy: position.coords.accuracy,
          timestamp: position.timestamp,
        };

        setState(prev => ({
          ...prev,
          position: gpsPosition,
          error: null,
          retryCount: 0,
        }));

        // Update database
        void updateLocationInDb(gpsPosition);
      },
      (error) => {
        console.error('[GPS] Position error:', error);
        setState(prev => ({
          ...prev,
          error,
          isStreaming: false,
        }));

        // Clear the watch on error
        if (watchIdRef.current !== null) {
          navigator.geolocation.clearWatch(watchIdRef.current);
          watchIdRef.current = null;
        }

        // Auto-retry for timeout and position unavailable errors
        if (error.code !== 1 && state.retryCount < MAX_RETRY_COUNT) {
          retryTimeoutRef.current = setTimeout(() => {
            setState(prev => ({ ...prev, retryCount: prev.retryCount + 1 }));
            startStreaming();
          }, RETRY_DELAY_MS);
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 2000, // Accept positions up to 2 seconds old
      }
    );
  }, [updateLocationInDb, state.retryCount]);

  // Stop GPS streaming
  const stopStreaming = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    setState(prev => ({ ...prev, isStreaming: false }));
  }, []);

  // Manual retry function
  const retry = useCallback(() => {
    setState(prev => ({ ...prev, error: null, retryCount: 0 }));
    startStreaming();
  }, [startStreaming]);

  // Auto-start/stop based on trip status
  useEffect(() => {
    if (isOnTrip && driverId) {
      startStreaming();
    } else {
      stopStreaming();
    }

    return () => {
      stopStreaming();
    };
  }, [isOnTrip, driverId, startStreaming, stopStreaming]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, []);

  return {
    ...state,
    retry,
    stopStreaming,
    startStreaming,
  };
}
