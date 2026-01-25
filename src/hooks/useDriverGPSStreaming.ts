import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface GPSPosition {
  lat: number;
  lng: number;
  heading: number | null;
  speed: number | null; // m/s
  accuracy: number;
  timestamp: number;
}

interface GPSStreamingState {
  position: GPSPosition | null;
  error: GeolocationPositionError | null;
  isStreaming: boolean;
  isConnected: boolean; // GPS signal status
  lastUpdateTime: number | null;
  lastDbSyncTime: number | null;
  retryCount: number;
  secondsSinceLastUpdate: number;
}

interface UseDriverGPSStreamingOptions {
  driverId: string | null;
  rideId: string | null;
  isOnTrip: boolean;
  updateIntervalMs?: number; // Time-based throttle (default 2500ms)
  minDistanceMeters?: number; // Distance-based throttle (default 15m)
}

const DEFAULT_UPDATE_INTERVAL = 2500; // 2.5 seconds
const DEFAULT_MIN_DISTANCE = 15; // 15 meters
const MAX_RETRY_COUNT = 10;
const RETRY_DELAY_MS = 2000;

// Haversine distance in meters
const getDistanceMeters = (
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number => {
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

export function useDriverGPSStreaming({
  driverId,
  rideId,
  isOnTrip,
  updateIntervalMs = DEFAULT_UPDATE_INTERVAL,
  minDistanceMeters = DEFAULT_MIN_DISTANCE,
}: UseDriverGPSStreamingOptions) {
  const [state, setState] = useState<GPSStreamingState>({
    position: null,
    error: null,
    isStreaming: false,
    isConnected: false,
    lastUpdateTime: null,
    lastDbSyncTime: null,
    retryCount: 0,
    secondsSinceLastUpdate: 0,
  });

  const watchIdRef = useRef<number | null>(null);
  const lastDbUpdateRef = useRef<number>(0);
  const lastSentPositionRef = useRef<{ lat: number; lng: number } | null>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const updateTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Timer to track seconds since last update
  useEffect(() => {
    if (!state.isStreaming) return;

    updateTimerRef.current = setInterval(() => {
      setState(prev => {
        if (!prev.lastUpdateTime) return prev;
        const seconds = Math.floor((Date.now() - prev.lastUpdateTime) / 1000);
        return { ...prev, secondsSinceLastUpdate: seconds };
      });
    }, 1000);

    return () => {
      if (updateTimerRef.current) {
        clearInterval(updateTimerRef.current);
      }
    };
  }, [state.isStreaming]);

  // Update location in database with smart throttling
  const updateLocationInDb = useCallback(async (position: GPSPosition, force = false) => {
    if (!driverId) return;

    const now = Date.now();
    const timeSinceLastUpdate = now - lastDbUpdateRef.current;
    
    // Check if we should update based on time
    const shouldUpdateByTime = timeSinceLastUpdate >= updateIntervalMs;
    
    // Check if we should update based on distance
    let shouldUpdateByDistance = false;
    if (lastSentPositionRef.current) {
      const distance = getDistanceMeters(
        lastSentPositionRef.current.lat,
        lastSentPositionRef.current.lng,
        position.lat,
        position.lng
      );
      shouldUpdateByDistance = distance >= minDistanceMeters;
    } else {
      shouldUpdateByDistance = true; // First update
    }

    // Update if either condition is met (or forced)
    if (!force && !shouldUpdateByTime && !shouldUpdateByDistance) {
      return;
    }

    lastDbUpdateRef.current = now;
    lastSentPositionRef.current = { lat: position.lat, lng: position.lng };

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
        setState(prev => ({ ...prev, lastDbSyncTime: now, isConnected: true }));
      }
    } catch (err) {
      console.error('[GPS] Network error updating location:', err);
      setState(prev => ({ ...prev, isConnected: false }));
    }
  }, [driverId, updateIntervalMs, minDistanceMeters]);

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
        isConnected: false,
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

        const now = Date.now();
        setState(prev => ({
          ...prev,
          position: gpsPosition,
          error: null,
          isConnected: true,
          retryCount: 0,
          lastUpdateTime: now,
          secondsSinceLastUpdate: 0,
        }));

        // Update database with smart throttling
        void updateLocationInDb(gpsPosition);
      },
      (error) => {
        console.error('[GPS] Position error:', error);
        setState(prev => ({
          ...prev,
          error,
          isStreaming: false,
          isConnected: false,
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
        maximumAge: 0, // Always get fresh position for continuous tracking
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
    setState(prev => ({ ...prev, isStreaming: false, isConnected: false }));
  }, []);

  // Manual retry function
  const retry = useCallback(() => {
    setState(prev => ({ ...prev, error: null, retryCount: 0 }));
    startStreaming();
  }, [startStreaming]);

  // Force immediate location update
  const forceUpdate = useCallback(() => {
    if (state.position) {
      void updateLocationInDb(state.position, true);
    }
  }, [state.position, updateLocationInDb]);

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
      if (updateTimerRef.current) {
        clearInterval(updateTimerRef.current);
      }
    };
  }, []);

  return {
    ...state,
    retry,
    stopStreaming,
    startStreaming,
    forceUpdate,
  };
}
