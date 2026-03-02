import { useEffect, useRef, useCallback, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

const UPDATE_INTERVAL_MS = 10000;
const OFFLINE_TIMEOUT_MS = 30000;
const RETRY_DELAY_MS = 5000;

/**
 * Hook to track rider location and online status.
 * Tracks ALL authenticated users except confirmed drivers/admins.
 */
export const useRiderLocationTracking = (enabled: boolean = true) => {
  const { user, isDriver, isAdmin } = useAuth();
  const [isTracking, setIsTracking] = useState(false);
  
  const watchIdRef = useRef<number | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastPositionRef = useRef<GeolocationPosition | null>(null);
  const isMountedRef = useRef(true);
  const userIdRef = useRef<string | null>(null);

  useEffect(() => {
    userIdRef.current = user?.id ?? null;
  }, [user?.id]);

  // Track if user is authenticated AND not a driver/admin
  // This is intentionally permissive - better to track too many than miss new riders
  const shouldTrack = enabled && !!user?.id && !isDriver && !isAdmin;

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

  const markOnlineWithoutLocation = useCallback(async () => {
    const userId = userIdRef.current;
    if (!userId || !isMountedRef.current) return;

    try {
      // First try to just update is_online without overwriting coords
      const { data: existing } = await supabase
        .from('rider_locations')
        .select('id')
        .eq('user_id', userId)
        .maybeSingle();

      if (existing) {
        // Row exists — only update online status, preserve real coordinates
        await supabase
          .from('rider_locations')
          .update({
            is_online: true,
            last_seen_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', userId);
      } else {
        // No row yet — insert with Montreal default (will be overwritten when GPS fires)
        await supabase
          .from('rider_locations')
          .insert({
            user_id: userId,
            lat: 45.5017,
            lng: -73.5673,
            accuracy: 10000,
            is_online: true,
            last_seen_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
      }
      
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
      // Silent fail
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;

    if (!shouldTrack) return;

    console.log('[RiderLocation] Starting tracking for:', user?.id);

    if (!navigator.geolocation) {
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
          
          if (error.code === 1 || retryCount >= 3) {
            markOnlineWithoutLocation();
          } else {
            retryTimeoutRef.current = setTimeout(() => {
              attemptGetPosition(retryCount + 1);
            }, RETRY_DELAY_MS);
          }
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
      );
    };

    attemptGetPosition();

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => { lastPositionRef.current = position; },
      () => {},
      { enableHighAccuracy: false, timeout: 30000, maximumAge: 10000 }
    );

    intervalRef.current = setInterval(() => {
      if (!isMountedRef.current) return;
      if (lastPositionRef.current) {
        updateLocation(lastPositionRef.current);
      } else {
        markOnlineWithoutLocation();
      }
    }, UPDATE_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (!isMountedRef.current) return;
      
      if (document.visibilityState === 'hidden') {
        // Preserve online status when app goes to background
        markOnlineWithoutLocation();
        return;
      }

      // When app comes back to foreground, immediately refresh location
      if (lastPositionRef.current) {
        updateLocation(lastPositionRef.current);
      } else {
        markOnlineWithoutLocation();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

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

  useEffect(() => {
    if (!user?.id) return;
    const handleBeforeUnload = () => markOffline();
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [user?.id, markOffline]);

  return { isTracking };
};

export default useRiderLocationTracking;
