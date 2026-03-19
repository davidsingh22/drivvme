import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { ensureFreshSession } from '@/lib/resilientRequest';

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
  // DB write status
  lastDbWriteError: string | null;
  dbWriteRetryCount: number;
  isDbSyncing: boolean;
  authStatus: 'ok' | 'signed_out';
  // New: history write count for debugging
  historyWriteCount: number;
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
// DB retry strategy: retry every 2s up to 5 attempts, then every 5s forever
const DB_RETRY_FAST_DELAY_MS = 2000;
const DB_RETRY_SLOW_DELAY_MS = 5000;
const DB_RETRY_FAST_ATTEMPTS = 5;
const HEARTBEAT_INTERVAL_MS = 3000; // Hard heartbeat every 3s

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
    lastDbWriteError: null,
    dbWriteRetryCount: 0,
    isDbSyncing: false,
    authStatus: 'ok',
    historyWriteCount: 0,
  });

  const watchIdRef = useRef<number | null>(null);
  const lastDbUpdateRef = useRef<number>(0);
  const lastSentPositionRef = useRef<{ lat: number; lng: number } | null>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const updateTimerRef = useRef<NodeJS.Timeout | null>(null);
  const currentRideIdRef = useRef<string | null>(null);
  const dbRetryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingWriteRef = useRef<GPSPosition | null>(null);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastGpsFixAtRef = useRef<number | null>(null);
  const lastKnownPositionRef = useRef<GPSPosition | null>(null);

  // Keep rideId ref updated
  useEffect(() => {
    currentRideIdRef.current = rideId;
  }, [rideId]);

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

  // Write location to DB with retry logic - DUAL WRITE: latest + history
  const writeToDb = useCallback(async (position: GPSPosition, retryAttempt = 0): Promise<boolean> => {
    if (!driverId) return false;

    const activeRideId = currentRideIdRef.current;
    
    setState(prev => ({ ...prev, isDbSyncing: true }));

    try {
      // Ensure we have a valid session before writing
      const { data: sessionData } = await supabase.auth.getSession();
      let session = sessionData.session;

      if (!session) {
        // Try to refresh
        const { data: refreshData } = await supabase.auth.refreshSession();
        session = refreshData.session;
      }

      if (!session) {
        setState(prev => ({
          ...prev,
          isDbSyncing: false,
          authStatus: 'signed_out',
          lastDbWriteError: 'Signed out – cannot send GPS',
          dbWriteRetryCount: retryAttempt + 1,
        }));
        return false;
      }

      // Refresh session if it's about to expire
      const expiresAt = session.expires_at; // seconds
      if (typeof expiresAt === 'number') {
        const secondsLeft = expiresAt - Math.floor(Date.now() / 1000);
        if (secondsLeft < 60) {
          await supabase.auth.refreshSession();
        }
      }

      // Always set updated_at = now() to force a change
      const now = new Date().toISOString();

      // Update driver_profiles for backwards compatibility
      const profileUpdate = supabase
        .from('driver_profiles')
        .update({
          current_lat: position.lat,
          current_lng: position.lng,
          updated_at: now,
        })
        .eq('user_id', driverId);

      // If we have an active ride, do dual write
      if (activeRideId) {
        // UPSERT into ride_locations (single latest row per ride)
        const locationUpsert = supabase
          .from('ride_locations')
          .upsert(
            {
              ride_id: activeRideId,
              driver_id: driverId,
              lat: position.lat,
              lng: position.lng,
              heading: position.heading,
              speed: position.speed,
              accuracy: position.accuracy,
              updated_at: now, // Force updated_at to change EVERY time
            },
            { onConflict: 'ride_id' }
          );

        // INSERT into ride_location_history (append-only for debugging)
        const historyInsert = supabase
          .from('ride_location_history')
          .insert({
            ride_id: activeRideId,
            driver_id: driverId,
            lat: position.lat,
            lng: position.lng,
            heading: position.heading,
            speed: position.speed,
            accuracy: position.accuracy,
          });

        // Run all in parallel
        const [profileResult, locationResult, historyResult] = await Promise.all([
          profileUpdate,
          locationUpsert,
          historyInsert,
        ]);

        if (profileResult.error) {
          console.error('[GPS] Failed to update driver_profiles:', profileResult.error);
        }
        if (locationResult.error) {
          console.error('[GPS] Failed to upsert ride_location:', locationResult.error);
          throw new Error(locationResult.error.message);
        }
        if (historyResult.error) {
          // History insert failure is non-critical, just log
          console.warn('[GPS] Failed to insert ride_location_history:', historyResult.error);
        }

        // Success
        setState(prev => ({
          ...prev,
          lastDbSyncTime: Date.now(),
          isConnected: true,
          lastDbWriteError: null,
          dbWriteRetryCount: 0,
          isDbSyncing: false,
          authStatus: 'ok',
          historyWriteCount: prev.historyWriteCount + (historyResult.error ? 0 : 1),
        }));
        pendingWriteRef.current = null;
        return true;
      } else {
        // No active ride, update driver_profiles + driver_locations
        const driverLocationUpsert = supabase
          .from('driver_locations')
          .upsert(
            {
              driver_id: driverId,
              user_id: driverId,
              lat: position.lat,
              lng: position.lng,
              heading: position.heading ?? null,
              speed_kph: position.speed != null ? position.speed * 3.6 : null,
              is_online: true,
              updated_at: now,
            },
            { onConflict: 'driver_id' }
          );

        const [profileRes, driverLocRes] = await Promise.all([profileUpdate, driverLocationUpsert]);
        if (profileRes.error) {
          console.error('[GPS] Failed to update driver_profiles:', profileRes.error);
          throw new Error(profileRes.error.message);
        }
        if (driverLocRes.error) {
          console.warn('[GPS] Failed to upsert driver_locations:', driverLocRes.error);
        }
        setState(prev => ({
          ...prev,
          lastDbSyncTime: Date.now(),
          isConnected: true,
          lastDbWriteError: null,
          dbWriteRetryCount: 0,
          isDbSyncing: false,
          authStatus: 'ok',
        }));
        return true;
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Network error';
      console.error('[GPS] DB write error:', errorMessage);

      setState(prev => ({
        ...prev,
        isDbSyncing: false,
        lastDbWriteError: errorMessage,
        dbWriteRetryCount: retryAttempt + 1,
      }));

      // Retry forever: 2s up to 5 attempts, then 5s
      const delay = retryAttempt < DB_RETRY_FAST_ATTEMPTS
        ? DB_RETRY_FAST_DELAY_MS
        : DB_RETRY_SLOW_DELAY_MS;
      console.log(`[GPS] Retrying DB write in ${delay}ms (attempt ${retryAttempt + 1})`);

      pendingWriteRef.current = position;
      dbRetryTimeoutRef.current = setTimeout(() => {
        if (pendingWriteRef.current) {
          writeToDb(pendingWriteRef.current, retryAttempt + 1);
        }
      }, delay);

      return false;
    }
  }, [driverId]);

  // Force immediate write with toast feedback (for manual "SEND NOW" button)
  // Grabs a FRESH GPS fix first, updates local state immediately, then writes to DB
  const forceWriteWithFeedback = useCallback(async () => {
    // Cancel any pending retry
    if (dbRetryTimeoutRef.current) {
      clearTimeout(dbRetryTimeoutRef.current);
      dbRetryTimeoutRef.current = null;
    }

    // Try to get a fresh GPS position first
    const freshPosition = await new Promise<GPSPosition | null>((resolve) => {
      if (!('geolocation' in navigator)) {
        resolve(null);
        return;
      }
      const timeout = setTimeout(() => resolve(null), 5000); // 5s timeout
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          clearTimeout(timeout);
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            heading: pos.coords.heading,
            speed: pos.coords.speed,
            accuracy: pos.coords.accuracy,
            timestamp: pos.timestamp,
          });
        },
        () => {
          clearTimeout(timeout);
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
      );
    });

    const pos = freshPosition || lastKnownPositionRef.current || state.position;
    if (!pos) {
      toast.error('No GPS position available');
      return;
    }

    // Update local state immediately so the map reflects the new position
    if (freshPosition) {
      const now = Date.now();
      lastGpsFixAtRef.current = now;
      lastKnownPositionRef.current = freshPosition;
      setState(prev => ({
        ...prev,
        position: freshPosition,
        isConnected: true,
        lastUpdateTime: now,
        secondsSinceLastUpdate: 0,
      }));
    }

    const success = await writeToDb(pos, 0);
    if (success) {
      toast.success('Location sent!');
    } else {
      toast.error('Failed to send location');
    }
  }, [state.position, writeToDb]);

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

    // Cancel any pending retry
    if (dbRetryTimeoutRef.current) {
      clearTimeout(dbRetryTimeoutRef.current);
      dbRetryTimeoutRef.current = null;
    }

    await writeToDb(position, 0);
  }, [driverId, updateIntervalMs, minDistanceMeters, writeToDb]);

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
        lastGpsFixAtRef.current = now;
        lastKnownPositionRef.current = gpsPosition;
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
            // On error, try a one-shot getCurrentPosition, then restart watchPosition
            navigator.geolocation.getCurrentPosition(
              (pos) => {
                const gpsPosition: GPSPosition = {
                  lat: pos.coords.latitude,
                  lng: pos.coords.longitude,
                  heading: pos.coords.heading,
                  speed: pos.coords.speed,
                  accuracy: pos.coords.accuracy,
                  timestamp: pos.timestamp,
                };
                const now = Date.now();
                lastGpsFixAtRef.current = now;
                lastKnownPositionRef.current = gpsPosition;
                setState(prev => ({
                  ...prev,
                  position: gpsPosition,
                  lastUpdateTime: now,
                  secondsSinceLastUpdate: 0,
                }));
                void updateLocationInDb(gpsPosition, true);
                startStreaming();
              },
              () => {
                startStreaming();
              },
              {
                enableHighAccuracy: true,
                timeout: 15000,
                maximumAge: 0,
              }
            );
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

  // HARD HEARTBEAT: force a DB upsert every 3s while trip active
  // Uses lastKnownPosition even if GPS hasn't fired; updated_at ALWAYS changes
  useEffect(() => {
    if (!isOnTrip || !driverId) return;

    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
    }

    heartbeatIntervalRef.current = setInterval(() => {
      const activeRideId = currentRideIdRef.current;
      if (!activeRideId) return;
      
      // Use last known position, even if stale
      const pos = lastKnownPositionRef.current || state.position;
      if (!pos) return;
      
      // Force write - updated_at will always change
      void writeToDb(pos, 0);
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
    };
  }, [isOnTrip, driverId, state.position, writeToDb]);

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
    if (dbRetryTimeoutRef.current) {
      clearTimeout(dbRetryTimeoutRef.current);
      dbRetryTimeoutRef.current = null;
    }
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    setState(prev => ({
      ...prev,
      isStreaming: false,
      isConnected: false,
      lastDbWriteError: null,
      dbWriteRetryCount: 0,
      authStatus: prev.authStatus,
    }));
  }, []);

  // Manual retry function
  const retry = useCallback(() => {
    setState(prev => ({ ...prev, error: null, retryCount: 0, lastDbWriteError: null, dbWriteRetryCount: 0 }));
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
      if (dbRetryTimeoutRef.current) {
        clearTimeout(dbRetryTimeoutRef.current);
      }
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }
    };
  }, []);

  // Calculate seconds since last DB sync
  const secondsSinceDbSync = state.lastDbSyncTime 
    ? Math.floor((Date.now() - state.lastDbSyncTime) / 1000)
    : null;

  const secondsSinceLastGpsFix = lastGpsFixAtRef.current
    ? Math.floor((Date.now() - lastGpsFixAtRef.current) / 1000)
    : null;

  return {
    ...state,
    secondsSinceDbSync,
    secondsSinceLastGpsFix,
    retry,
    stopStreaming,
    startStreaming,
    forceUpdate,
    forceWriteWithFeedback,
  };
}
