import { useEffect, useRef, useCallback, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

const UPDATE_INTERVAL_MS = 10000; // Update every 10 seconds
const OFFLINE_TIMEOUT_MS = 30000; // Mark offline after 30 seconds of no updates
const RETRY_DELAY_MS = 5000; // Retry location fetch after 5 seconds

/**
 * Hook to track rider location and online status.
 * Runs globally for authenticated riders to report location to the admin dashboard.
 */
export const useRiderLocationTracking = (enabled: boolean = true) => {
  const { user, roles, isDriver, authLoading } = useAuth();
  const [isTracking, setIsTracking] = useState(false);
  
  // Use refs for mutable values to avoid callback dependency issues
  const watchIdRef = useRef<number | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastPositionRef = useRef<GeolocationPosition | null>(null);
  const isMountedRef = useRef(true);
  const userIdRef = useRef<string | null>(null);

  // Keep userIdRef in sync
  useEffect(() => {
    userIdRef.current = user?.id ?? null;
  }, [user?.id]);

  // Check if user is a rider (not a driver and not admin viewing the page)
  const shouldTrack = enabled && !authLoading && !!user?.id && !isDriver && !roles.includes('admin');

  // Stable update function using refs
  const updateLocation = useCallback(async (position: GeolocationPosition) => {
    const userId = userIdRef.current;
    if (!userId || !isMountedRef.current) return;

    try {
      const { error } = await supabase
        .from('rider_locations')
        .upsert({
          user_id: userId,
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          is_online: true,
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'user_id'
        });

      if (error) {
        console.error('[RiderLocation] Update error:', error);
      } else if (isMountedRef.current) {
        setIsTracking(true);
      }
    } catch (err) {
      console.error('[RiderLocation] Failed to update:', err);
    }
  }, []);

  // Mark as online even without location - fallback for when geolocation is denied
  const markOnlineWithoutLocation = useCallback(async () => {
    const userId = userIdRef.current;
    if (!userId || !isMountedRef.current) return;

    try {
      // Use Montreal as a reasonable default
      await supabase
        .from('rider_locations')
        .upsert({
          user_id: userId,
          lat: 45.5017,
          lng: -73.5673,
          accuracy: 10000,
          is_online: true,
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'user_id'
        });
      
      if (isMountedRef.current) {
        setIsTracking(true);
      }
    } catch (err) {
      console.error('[RiderLocation] Failed to mark online:', err);
    }
  }, []);

  const markOffline = useCallback(async () => {
    const userId = userIdRef.current;
    if (!userId) return;

    try {
      await supabase
        .from('rider_locations')
        .update({ 
          is_online: false,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId);
    } catch {
      // Silent fail - user might not have a location record
    }
  }, []);

  // Main tracking effect
  useEffect(() => {
    isMountedRef.current = true;

    if (!shouldTrack) {
      return;
    }

    console.log('[RiderLocation] Starting location tracking for user:', user?.id);

    // Check for geolocation support
    if (!navigator.geolocation) {
      console.warn('[RiderLocation] Geolocation not supported - marking online anyway');
      markOnlineWithoutLocation();
      return;
    }

    const attemptGetPosition = (retryCount: number = 0) => {
      if (!isMountedRef.current) return;

      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (!isMountedRef.current) return;
          lastPositionRef.current = position;
          updateLocation(position);
        },
        (error) => {
          if (!isMountedRef.current) return;
          console.warn('[RiderLocation] Position error:', error.code, error.message);
          
          if (error.code === 1) {
            // Permission denied - mark online without location
            markOnlineWithoutLocation();
          } else if (retryCount < 3) {
            // Retry for timeout or unavailable errors
            retryTimeoutRef.current = setTimeout(() => {
              attemptGetPosition(retryCount + 1);
            }, RETRY_DELAY_MS);
          } else {
            // Max retries reached - mark online without location
            markOnlineWithoutLocation();
          }
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
      );
    };

    // Start getting position
    attemptGetPosition();

    // Watch for position changes
    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        lastPositionRef.current = position;
      },
      (error) => {
        console.warn('[RiderLocation] Watch error:', error.message);
      },
      { enableHighAccuracy: false, timeout: 30000, maximumAge: 10000 }
    );

    // Set up interval to send updates
    intervalRef.current = setInterval(() => {
      if (!isMountedRef.current) return;
      if (lastPositionRef.current) {
        updateLocation(lastPositionRef.current);
      } else {
        markOnlineWithoutLocation();
      }
    }, UPDATE_INTERVAL_MS);

    // Handle visibility changes
    const handleVisibilityChange = () => {
      if (!isMountedRef.current) return;
      
      if (document.visibilityState === 'hidden') {
        setTimeout(() => {
          if (document.visibilityState === 'hidden') {
            markOffline();
          }
        }, OFFLINE_TIMEOUT_MS);
      } else {
        if (lastPositionRef.current) {
          updateLocation(lastPositionRef.current);
        } else {
          markOnlineWithoutLocation();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Cleanup
    return () => {
      isMountedRef.current = false;
      
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      markOffline();
    };
  }, [shouldTrack, user?.id, updateLocation, markOffline, markOnlineWithoutLocation]);

  // Mark offline on page unload
  useEffect(() => {
    if (!user?.id) return;

    const handleBeforeUnload = () => {
      markOffline();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [user?.id, markOffline]);

  return { isTracking };
};

export default useRiderLocationTracking;
