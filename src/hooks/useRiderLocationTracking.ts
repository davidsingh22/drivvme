import { useEffect, useRef, useCallback, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

const UPDATE_INTERVAL_MS = 10000; // Update every 10 seconds
const OFFLINE_TIMEOUT_MS = 30000; // Mark offline after 30 seconds of no updates

/**
 * Hook to track rider location and online status.
 * Runs globally for authenticated riders to report location to the admin dashboard.
 */
export const useRiderLocationTracking = (enabled: boolean = true) => {
  const { user, roles, isDriver } = useAuth();
  const watchIdRef = useRef<number | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastPositionRef = useRef<GeolocationPosition | null>(null);
  const [isTracking, setIsTracking] = useState(false);

  // Check if user is a rider (has rider role OR has no driver role - default to rider behavior)
  // This is more permissive to ensure we track riders even if roles are slow to load
  const shouldTrack = enabled && !!user?.id && !isDriver;

  const updateLocation = useCallback(async (position: GeolocationPosition) => {
    if (!user?.id) return;

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
        // Only log if it's not an RLS error (user might not be a rider)
        if (!error.message.includes('row-level security')) {
          console.error('[RiderLocation] Update error:', error);
        }
      } else {
        if (!isTracking) setIsTracking(true);
      }
    } catch (err) {
      console.error('[RiderLocation] Failed to update:', err);
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
    if (!shouldTrack) return;

    // Check for geolocation support
    if (!navigator.geolocation) {
      console.warn('[RiderLocation] Geolocation not supported');
      return;
    }

    console.log('[RiderLocation] Starting location tracking for user:', user?.id);

    // Start watching position
    const startTracking = () => {
      // Get initial position
      navigator.geolocation.getCurrentPosition(
        (position) => {
          console.log('[RiderLocation] Got initial position:', position.coords.latitude, position.coords.longitude);
          lastPositionRef.current = position;
          updateLocation(position);
        },
        (error) => {
          console.warn('[RiderLocation] Initial position error:', error.message);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
      );

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
        }
      }, UPDATE_INTERVAL_MS);
    };

    startTracking();

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
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Cleanup
    return () => {
      console.log('[RiderLocation] Stopping location tracking');
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      markOffline();
    };
  }, [shouldTrack, user?.id, updateLocation, markOffline]);

  // Mark offline on page unload
  useEffect(() => {
    if (!user?.id) return;

    const handleBeforeUnload = () => {
      // Use sendBeacon for reliable delivery on page close - this won't work due to auth
      // but we try anyway as a best effort
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
