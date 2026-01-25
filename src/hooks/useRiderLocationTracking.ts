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
  const watchIdRef = useRef<number | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastPositionRef = useRef<GeolocationPosition | null>(null);
  const [isTracking, setIsTracking] = useState(false);
  const hasInitializedRef = useRef(false);

  // Check if user is a rider (not a driver and not admin viewing the page)
  // Wait for auth to finish loading to avoid race conditions
  const shouldTrack = enabled && !authLoading && !!user?.id && !isDriver && !roles.includes('admin');

  const updateLocation = useCallback(async (position: GeolocationPosition) => {
    if (!user?.id) return;

    console.log('[RiderLocation] Updating location:', position.coords.latitude, position.coords.longitude);

    try {
      const { error } = await supabase
        .from('rider_locations')
        .upsert({
          user_id: user.id,
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
      } else {
        if (!isTracking) setIsTracking(true);
      }
    } catch (err) {
      console.error('[RiderLocation] Failed to update:', err);
    }
  }, [user?.id, isTracking]);

  // Mark as online even without location - fallback for when geolocation is denied
  const markOnlineWithoutLocation = useCallback(async () => {
    if (!user?.id) return;

    console.log('[RiderLocation] Marking online without precise location');

    try {
      // First check if we already have a record
      const { data: existing } = await supabase
        .from('rider_locations')
        .select('id')
        .eq('user_id', user.id)
        .single();

      if (existing) {
        // Update existing record to mark online
        await supabase
          .from('rider_locations')
          .update({
            is_online: true,
            last_seen_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', user.id);
      } else {
        // Create a new record with default location (0,0 - will be updated when location is available)
        // Use Montreal as a reasonable default
        await supabase
          .from('rider_locations')
          .upsert({
            user_id: user.id,
            lat: 45.5017,
            lng: -73.5673,
            accuracy: 10000, // High accuracy value indicates approximate location
            is_online: true,
            last_seen_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'user_id'
          });
      }
      
      if (!isTracking) setIsTracking(true);
    } catch (err) {
      console.error('[RiderLocation] Failed to mark online:', err);
    }
  }, [user?.id, isTracking]);

  const markOffline = useCallback(async () => {
    if (!user?.id) return;

    try {
      await supabase
        .from('rider_locations')
        .update({ 
          is_online: false,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', user.id);
    } catch (err) {
      // Silent fail - user might not have a location record
    }
  }, [user?.id]);

  useEffect(() => {
    if (!shouldTrack) {
      console.log('[RiderLocation] Not tracking - conditions not met:', {
        enabled,
        authLoading,
        userId: user?.id,
        isDriver,
        roles
      });
      return;
    }

    // Prevent double initialization
    if (hasInitializedRef.current) return;
    hasInitializedRef.current = true;

    console.log('[RiderLocation] Starting location tracking for user:', user?.id);

    // Check for geolocation support
    if (!navigator.geolocation) {
      console.warn('[RiderLocation] Geolocation not supported - marking online anyway');
      markOnlineWithoutLocation();
      return;
    }

    const attemptGetPosition = (retryCount: number = 0) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          console.log('[RiderLocation] Got position:', position.coords.latitude, position.coords.longitude);
          lastPositionRef.current = position;
          updateLocation(position);
        },
        (error) => {
          console.warn('[RiderLocation] Position error:', error.code, error.message);
          
          if (error.code === 1) {
            // Permission denied - mark online without location
            console.log('[RiderLocation] Permission denied - using fallback');
            markOnlineWithoutLocation();
          } else if (retryCount < 3) {
            // Retry for timeout or unavailable errors
            console.log('[RiderLocation] Retrying in', RETRY_DELAY_MS, 'ms (attempt', retryCount + 1, ')');
            retryTimeoutRef.current = setTimeout(() => {
              attemptGetPosition(retryCount + 1);
            }, RETRY_DELAY_MS);
          } else {
            // Max retries reached - mark online without location
            console.log('[RiderLocation] Max retries reached - using fallback');
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
      if (lastPositionRef.current) {
        updateLocation(lastPositionRef.current);
      } else {
        // No position available - just mark as still online
        markOnlineWithoutLocation();
      }
    }, UPDATE_INTERVAL_MS);

    // Handle visibility changes
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        // App going to background - mark offline after timeout
        setTimeout(() => {
          if (document.visibilityState === 'hidden') {
            markOffline();
          }
        }, OFFLINE_TIMEOUT_MS);
      } else {
        // App coming to foreground - resume tracking
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
      console.log('[RiderLocation] Stopping location tracking');
      hasInitializedRef.current = false;
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
