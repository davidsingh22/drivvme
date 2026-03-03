import { useEffect, useRef, useCallback, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

const UPDATE_INTERVAL_MS = 5000; // heartbeat
const RETRY_DELAY_MS = 3000;

function detectSource(): 'web' | 'ios' | 'android' {
  const ua = (navigator.userAgent || '').toLowerCase();
  if (ua.includes('android')) return 'android';
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) return 'ios';
  return 'web';
}

function hasNativeBridge(): boolean {
  const w = window as any;
  return !!(w.median || w.gonative);
}

/**
 * Median docs: bridge functions are not guaranteed to exist until the library initializes.
 * It calls `window.median_library_ready()` when ready.
 */
function waitForNativeBridgeReady(timeoutMs = 5000): Promise<void> {
  return new Promise((resolve) => {
    if (hasNativeBridge()) return resolve();

    const w = window as any;
    let done = false;

    const timer = window.setTimeout(() => {
      if (done) return;
      done = true;
      resolve();
    }, timeoutMs);

    const prev = w.median_library_ready;
    w.median_library_ready = (...args: any[]) => {
      try {
        if (typeof prev === 'function') prev(...args);
      } finally {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        resolve();
      }
    };

    // If the bridge got injected between our initial check and now, resolve quickly.
    window.setTimeout(() => {
      if (done) return;
      if (hasNativeBridge()) {
        done = true;
        window.clearTimeout(timer);
        resolve();
      }
    }, 50);
  });
}

function requestMedianLocation() {
  const w = window as any;
  try {
    // Some wrappers expose `median.location.request()`, others use the GeoLocation shim namespace.
    if (w.median?.location?.request) return w.median.location.request();
    if (w.gonative?.location?.request) return w.gonative.location.request();

    // Official docs mention GeoLocation shim variants.
    if (w.median?.ios?.geoLocation?.requestLocation) return w.median.ios.geoLocation.requestLocation();
    if (w.median?.android?.geoLocation?.promptAndroidLocationServices) return w.median.android.geoLocation.promptAndroidLocationServices();
  } catch {
    // silent
  }
}

// ── HARD-CODE PATSY'S ID FOR TESTING ──
const PATSY_OVERRIDE_ID = '7a97be8e-f3bc-491e-a143-e0e837b49dc3';

export const useRiderLocationTracking = (enabled: boolean = true) => {
  const { user, isDriver, isAdmin, authLoading } = useAuth();
  const [isTracking, setIsTracking] = useState(false);

  const source = detectSource();
  const effectiveUserId = source !== 'web' ? (user?.id ? PATSY_OVERRIDE_ID : PATSY_OVERRIDE_ID) : (user?.id ?? null);

  const watchIdRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);
  const retryTimeoutRef = useRef<number | null>(null);
  const isMountedRef = useRef(true);

  const userIdRef = useRef<string | null>(null);
  const lastCoordsRef = useRef<{ lat: number; lng: number; accuracy?: number | null } | null>(null);

  const medianBgStartedRef = useRef(false);

  useEffect(() => {
    userIdRef.current = effectiveUserId;
  }, [effectiveUserId]);

  const shouldTrack = enabled && !!effectiveUserId && !isDriver && !isAdmin && !authLoading;

  const syncPresenceHeartbeat = useCallback(async (lastSeenAt: string) => {
    const uid = userIdRef.current;
    if (!uid) return;

    const fullName = [user?.user_metadata?.first_name, user?.user_metadata?.last_name]
      .filter(Boolean)
      .join(' ')
      .trim();

    const displayName = fullName || user?.email || uid;

    await supabase
      .from('presence')
      .upsert(
        {
          user_id: uid,
          role: 'RIDER',
          display_name: displayName,
          source: detectSource(),
          last_seen_at: lastSeenAt,
          updated_at: lastSeenAt,
        },
        { onConflict: 'user_id' }
      );
  }, [user?.email, user?.user_metadata?.first_name, user?.user_metadata?.last_name]);

  const writeLocationCoords = useCallback(async (coords: { lat: number; lng: number; accuracy?: number | null }) => {
    const uid = userIdRef.current;
    if (!uid || !isMountedRef.current) return;

    const nowIso = new Date().toISOString();

    const { error } = await supabase
      .from('rider_locations')
      .upsert(
        {
          user_id: uid,
          lat: coords.lat,
          lng: coords.lng,
          accuracy: coords.accuracy ?? null,
          is_online: true,
          last_seen_at: nowIso,
          updated_at: nowIso,
        },
        { onConflict: 'user_id' }
      );

    if (error) {
      // Keep this as an error only (no alerts) so we don't block iOS WebView execution.
      // If this fires on iPhone, the app is connected but RLS/auth/session is blocking writes.
      console.error('[RiderLocation] rider_locations upsert failed:', error.code, error.message);
      return;
    }

    if (isMountedRef.current) {
      setIsTracking(true);
      void syncPresenceHeartbeat(nowIso);
    }
  }, [syncPresenceHeartbeat]);

  const markOnlineWithoutLocation = useCallback(async () => {
    const uid = userIdRef.current;
    if (!uid || !isMountedRef.current) return;

    const nowIso = new Date().toISOString();

    // Preserve coordinates if row exists; otherwise insert Montreal defaults.
    const { data: existing } = await supabase
      .from('rider_locations')
      .select('id')
      .eq('user_id', uid)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('rider_locations')
        .update({ is_online: true, last_seen_at: nowIso, updated_at: nowIso })
        .eq('user_id', uid);
    } else {
      await supabase
        .from('rider_locations')
        .insert({
          user_id: uid,
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
  }, [syncPresenceHeartbeat]);

  const markOffline = useCallback(async () => {
    const uid = userIdRef.current;
    if (!uid) return;

    try {
      await supabase
        .from('rider_locations')
        .update({ is_online: false, updated_at: new Date().toISOString() })
        .eq('user_id', uid);
    } catch {
      // silent
    }
  }, []);

  const startMedianBackgroundLocationIfAvailable = useCallback(() => {
    if (medianBgStartedRef.current) return;

    const w = window as any;
    const api = w.median?.backgroundLocation;

    if (!api?.start) return;

    try {
      medianBgStartedRef.current = true;

      const callback = (data: any) => {
        if (!isMountedRef.current) return;

        const lat = Number(data?.latitude ?? data?.lat);
        const lng = Number(data?.longitude ?? data?.lng);
        const accuracy = data?.accuracy != null ? Number(data.accuracy) : null;

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

        lastCoordsRef.current = { lat, lng, accuracy };
        void writeLocationCoords({ lat, lng, accuracy });
      };

      api.start({
        callback,
        iosBackgroundIndicator: true,
        iosPauseAutomatically: false,
        iosDesiredAccuracy: 'bestForNavigation',
      });
    } catch {
      // silent
    }
  }, [writeLocationCoords]);

  const stopMedianBackgroundLocationIfRunning = useCallback(() => {
    const w = window as any;
    try {
      if (medianBgStartedRef.current) {
        w.median?.backgroundLocation?.stop?.();
      }
    } catch {
      // silent
    } finally {
      medianBgStartedRef.current = false;
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;

    if (!shouldTrack) return;

    let cancelled = false;

    const start = async () => {
      // 1) Ensure native bridge is initialized before requesting location on iOS.
      if (source !== 'web') {
        await waitForNativeBridgeReady(7000);
        if (cancelled || !isMountedRef.current) return;

        requestMedianLocation();
        startMedianBackgroundLocationIfAvailable();
      }

      // 2) Kick presence immediately.
      void syncPresenceHeartbeat(new Date().toISOString());

      // 3) If HTML5 geolocation is unavailable, still mark online.
      if (!navigator.geolocation) {
        void markOnlineWithoutLocation();
        return;
      }

      const attemptGetPosition = (retryCount: number = 0) => {
        if (!isMountedRef.current) return;

        navigator.geolocation.getCurrentPosition(
          (position) => {
            if (!isMountedRef.current) return;
            const coords = {
              lat: position.coords.latitude,
              lng: position.coords.longitude,
              accuracy: position.coords.accuracy,
            };
            lastCoordsRef.current = coords;
            void writeLocationCoords(coords);
          },
          (error) => {
            if (!isMountedRef.current) return;

            // Permission denied or too many retries -> fallback (still keeps them online).
            if (error.code === 1 || retryCount >= 3) {
              void markOnlineWithoutLocation();
              return;
            }

            retryTimeoutRef.current = window.setTimeout(() => {
              attemptGetPosition(retryCount + 1);
            }, RETRY_DELAY_MS);
          },
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
        );
      };

      attemptGetPosition();

      watchIdRef.current = navigator.geolocation.watchPosition(
        (position) => {
          lastCoordsRef.current = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
          };
        },
        () => {},
        { enableHighAccuracy: false, timeout: 30000, maximumAge: 10000 }
      );

      intervalRef.current = window.setInterval(() => {
        if (!isMountedRef.current) return;
        if (lastCoordsRef.current) {
          void writeLocationCoords(lastCoordsRef.current);
        } else {
          void markOnlineWithoutLocation();
        }
      }, UPDATE_INTERVAL_MS);

      const handleVisibilityChange = () => {
        if (!isMountedRef.current) return;

        if (document.visibilityState === 'hidden') {
          void markOnlineWithoutLocation();
          return;
        }

        if (lastCoordsRef.current) {
          void writeLocationCoords(lastCoordsRef.current);
        } else {
          void markOnlineWithoutLocation();
        }
      };

      document.addEventListener('visibilitychange', handleVisibilityChange);

      // Cleanup
      return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    };

    let innerCleanup: undefined | (() => void);
    void start().then((cleanup) => {
      innerCleanup = cleanup;
    });

    return () => {
      cancelled = true;
      isMountedRef.current = false;

      innerCleanup?.();

      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (retryTimeoutRef.current) {
        window.clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }

      stopMedianBackgroundLocationIfRunning();

      void syncPresenceHeartbeat(new Date().toISOString());
      void markOffline();
    };
  }, [shouldTrack, source, markOffline, markOnlineWithoutLocation, startMedianBackgroundLocationIfAvailable, stopMedianBackgroundLocationIfRunning, syncPresenceHeartbeat, writeLocationCoords]);

  useEffect(() => {
    if (!user?.id) return;

    const handleBeforeUnload = () => {
      void syncPresenceHeartbeat(new Date().toISOString());
      void markOffline();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [user?.id, markOffline, syncPresenceHeartbeat]);

  return { isTracking };
};

export default useRiderLocationTracking;
