import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

const UPDATE_INTERVAL_MS = 10000; // Update every 10 seconds
const OFFLINE_TIMEOUT_MS = 30000; // Mark offline after 30 seconds of no updates

/**
 * Hook to track rider location and online status.
 * Should be used on rider-facing pages to report location to the admin dashboard.
 */
export const useRiderLocationTracking = (enabled: boolean = true) => {
  const { user, isRider } = useAuth();
  const watchIdRef = useRef<number | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastPositionRef = useRef<GeolocationPosition | null>(null);

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
        console.error('[RiderLocation] Update error:', error);
      }
    } catch (err) {
      console.error('[RiderLocation] Failed to update:', err);
    }
  }, [user?.id]);

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
      console.error('[RiderLocation] Failed to mark offline:', err);
    }
  }, [user?.id]);

  useEffect(() => {
    if (!enabled || !user?.id || !isRider) return;

    // Check for geolocation support
    if (!navigator.geolocation) {
      console.warn('[RiderLocation] Geolocation not supported');
      return;
    }

    // Start watching position
    const startTracking = () => {
      // Get initial position
      navigator.geolocation.getCurrentPosition(
        (position) => {
          lastPositionRef.current = position;
          updateLocation(position);
        },
        (error) => {
          console.warn('[RiderLocation] Initial position error:', error);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
      );

      // Watch for position changes
      watchIdRef.current = navigator.geolocation.watchPosition(
        (position) => {
          lastPositionRef.current = position;
        },
        (error) => {
          console.warn('[RiderLocation] Watch error:', error);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
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
  }, [enabled, user?.id, isRider, updateLocation, markOffline]);

  // Mark offline on page unload
  useEffect(() => {
    if (!user?.id) return;

    const handleBeforeUnload = () => {
      // Use sendBeacon for reliable delivery on page close
      const data = JSON.stringify({
        user_id: user.id,
        is_online: false,
        updated_at: new Date().toISOString()
      });
      
      // Note: This is a best-effort approach
      navigator.sendBeacon && navigator.sendBeacon(
        `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rider_locations?user_id=eq.${user.id}`,
        data
      );
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [user?.id]);
};

export default useRiderLocationTracking;
