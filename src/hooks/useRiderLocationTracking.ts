import { useEffect, useRef, useCallback, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

const UPDATE_INTERVAL_MS = 5000; // 5s heartbeat for native diagnosis
const RETRY_DELAY_MS = 3000;

function detectSource(): 'web' | 'ios' | 'android' {
  const ua = (navigator.userAgent || '').toLowerCase();
  if (ua.includes('android')) return 'android';
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) return 'ios';
  return 'web';
}

/**
 * Hook to track rider location and online status.
 * Tracks ALL authenticated users except confirmed drivers/admins.
 */
export const useRiderLocationTracking = (enabled: boolean = true) => {
  const { user, isDriver, isAdmin, authLoading } = useAuth();
  const [isTracking, setIsTracking] = useState(false);

  const watchIdRef = useRef<number | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastPositionRef = useRef<GeolocationPosition | null>(null);
  const isMountedRef = useRef(true);
  const userIdRef = useRef<string | null>(null);
  const debugLoggedRef = useRef(false);

  useEffect(() => {
    userIdRef.current = user?.id ?? null;
  }, [user?.id]);

  // Track if user is authenticated AND not a driver/admin
  // This is intentionally permissive - better to track too many than miss new riders
  const shouldTrack = enabled && !!user?.id && !isDriver && !isAdmin && !authLoading;

  // Heavy debug logging for native diagnosis
  useEffect(() => {
    const source = detectSource();
    if (source !== 'web' || !debugLoggedRef.current) {
      debugLoggedRef.current = true;
      console.log('[RiderLocation:DEBUG] ──────────────────────');
      console.log('[RiderLocation:DEBUG] source:', source);
      console.log('[RiderLocation:DEBUG] enabled:', enabled);
      console.log('[RiderLocation:DEBUG] user?.id:', user?.id ?? 'NULL');
      console.log('[RiderLocation:DEBUG] isDriver:', isDriver);
      console.log('[RiderLocation:DEBUG] isAdmin:', isAdmin);
      console.log('[RiderLocation:DEBUG] authLoading:', authLoading);
      console.log('[RiderLocation:DEBUG] shouldTrack:', shouldTrack);
      console.log('[RiderLocation:DEBUG] navigator.geolocation?', !!navigator.geolocation);
      console.log('[RiderLocation:DEBUG] ──────────────────────');
    }
  }, [enabled, user?.id, isDriver, isAdmin, authLoading, shouldTrack]);

  const syncPresenceHeartbeat = useCallback(async (lastSeenAt: string) => {
    const userId = userIdRef.current;
    if (!userId) return;

    const fullName = [user?.user_metadata?.first_name, user?.user_metadata?.last_name]
      .filter(Boolean)
      .join(' ')
      .trim();

    const displayName = fullName || user?.email || userId;

    const { error } = await supabase
      .from('presence')
      .upsert(
        {
          user_id: userId,
          role: 'RIDER',
          display_name: displayName,
          source: detectSource(),
          last_seen_at: lastSeenAt,
          updated_at: lastSeenAt,
        },
        { onConflict: 'user_id' }
      );

    if (error) {
      console.error('[Presence] Rider sync error:', error.message);
    }
  }, [user?.email, user?.user_metadata?.first_name, user?.user_metadata?.last_name]);

  const updateLocation = useCallback(async (position: GeolocationPosition) => {
    const userId = userIdRef.current;
    if (!userId || !isMountedRef.current) return;

    try {
      const nowIso = new Date().toISOString();
      console.log(`[RiderLocation:WRITE] Upserting lat=${position.coords.latitude.toFixed(4)} lng=${position.coords.longitude.toFixed(4)} acc=${position.coords.accuracy?.toFixed(0)} for ${userId.slice(0, 8)}`);

      const { error } = await supabase
        .from('rider_locations')
        .upsert({
          user_id: userId,
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          is_online: true,
          last_seen_at: nowIso,
          updated_at: nowIso,
        }, {
          onConflict: 'user_id'
        });

      if (error) {
        console.error('[RiderLocation:WRITE] ❌ DB error:', error.code, error.message, error.details);
        // Native-visible alert so testers can see the failure on-screen
        try {
          window.alert(`GPS Update Failed\n\nCode: ${error.code}\nMessage: ${error.message}\nDetails: ${error.details || 'none'}`);
        } catch (_) { /* alert may be blocked in some contexts */ }
      } else {
        console.log('[RiderLocation:WRITE] ✅ Success at', nowIso);
        if (isMountedRef.current) {
          setIsTracking(true);
          void syncPresenceHeartbeat(nowIso);
        }
      }
    } catch (err) {
      console.error('[RiderLocation:WRITE] ❌ Exception:', err);
    }
  }, [syncPresenceHeartbeat]);

  const markOnlineWithoutLocation = useCallback(async () => {
    const userId = userIdRef.current;
    if (!userId || !isMountedRef.current) return;

    try {
      const nowIso = new Date().toISOString();
      console.log(`[RiderLocation:FALLBACK] markOnlineWithoutLocation for ${userId.slice(0, 8)} at ${nowIso}`);

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
            last_seen_at: nowIso,
            updated_at: nowIso,
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
            last_seen_at: nowIso,
            updated_at: nowIso,
          });
      }

      if (isMountedRef.current) {
        setIsTracking(true);
        void syncPresenceHeartbeat(nowIso);
      }
    } catch (err) {
      console.error('[RiderLocation] Failed to mark online:', err);
    }
  }, [syncPresenceHeartbeat]);

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

    if (!shouldTrack) {
      console.log('[RiderLocation:GUARD] ⛔ NOT tracking — shouldTrack=false, enabled=', enabled, 'user=', user?.id?.slice(0,8), 'isDriver=', isDriver, 'isAdmin=', isAdmin, 'authLoading=', authLoading);
      return;
    }

    console.log('[RiderLocation:START] ✅ Starting tracking for:', user?.id, 'source:', detectSource());
    void syncPresenceHeartbeat(new Date().toISOString());

    if (!navigator.geolocation) {
      console.warn('[RiderLocation:START] ⚠️ No geolocation API — falling back');
      markOnlineWithoutLocation();
      return;
    }

    const attemptGetPosition = (retryCount: number = 0) => {
      if (!isMountedRef.current) return;

      console.log(`[RiderLocation:GPS] getCurrentPosition attempt #${retryCount}`);

      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (!isMountedRef.current) return;
          console.log(`[RiderLocation:GPS] ✅ Got position: ${position.coords.latitude.toFixed(4)}, ${position.coords.longitude.toFixed(4)}`);
          lastPositionRef.current = position;
          updateLocation(position);
        },
        (error) => {
          if (!isMountedRef.current) return;
          console.warn(`[RiderLocation:GPS] ❌ Error code=${error.code} msg=${error.message} retry=${retryCount}`);
          // Native-visible alert for GPS permission/hardware failures
          try {
            window.alert(`GPS Error\n\nCode: ${error.code}\nMessage: ${error.message}\nRetry: ${retryCount}`);
          } catch (_) {}

          if (error.code === 1 || retryCount >= 3) {
            console.log('[RiderLocation:GPS] Giving up on GPS, using fallback');
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
      void syncPresenceHeartbeat(new Date().toISOString());
      markOffline();
    };
  }, [shouldTrack, user?.id, updateLocation, markOffline, markOnlineWithoutLocation, syncPresenceHeartbeat]);

  useEffect(() => {
    if (!user?.id) return;
    const handleBeforeUnload = () => {
      void syncPresenceHeartbeat(new Date().toISOString());
      markOffline();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [user?.id, markOffline, syncPresenceHeartbeat]);

  return { isTracking };
};

export default useRiderLocationTracking;
