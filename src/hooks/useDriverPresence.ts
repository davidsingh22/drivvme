import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export type DriverStatus = 'offline' | 'online' | 'available' | 'on_trip';
export type DriverScreen = 'dashboard' | 'live' | 'earnings' | 'messages';

const HEARTBEAT_MS = 30_000;
const OFFLINE_AFTER_MS = 60_000;
const LOCATION_UPDATE_MS = 12_000; // ~12s GPS refresh for lat/lng

/**
 * Tracks driver presence in `driver_presence` table.
 * Heartbeats every 30s, marks offline after 60s inactivity.
 * Updates lat/lng every ~12s.
 */
export function useDriverPresence(
  status: DriverStatus,
  currentScreen: DriverScreen = 'dashboard'
) {
  const { user, profile, roles } = useAuth();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const locationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const offlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusRef = useRef(status);
  const screenRef = useRef(currentScreen);
  statusRef.current = status;
  screenRef.current = currentScreen;

  const isDriver = roles.includes('driver');

  const displayName =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') ||
    user?.email ||
    '';

  const upsertPresence = useCallback(
    async (
      overrideStatus?: DriverStatus,
      lat?: number | null,
      lng?: number | null
    ) => {
      if (!user?.id) return;
      try {
        const payload: Record<string, unknown> = {
          driver_id: user.id,
          status: overrideStatus ?? statusRef.current,
          current_screen: screenRef.current,
          last_seen: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          display_name: displayName,
        };
        if (lat != null && lng != null) {
          payload.lat = lat;
          payload.lng = lng;
        }
        const { error } = await supabase
          .from('driver_presence')
          .upsert(payload as any, { onConflict: 'driver_id' });
        if (error) {
          console.error('[DriverPresence] upsert error:', error.message, error.details);
        } else {
          console.log('[DriverPresence] upsert OK — status:', payload.status);
        }
      } catch (e: any) {
        console.error('[DriverPresence] upsert exception:', e.message);
      }
    },
    [user?.id, displayName]
  );

  // Get current GPS and upsert with it
  const upsertWithLocation = useCallback(() => {
    if (!navigator.geolocation) {
      upsertPresence();
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        upsertPresence(undefined, pos.coords.latitude, pos.coords.longitude);
      },
      () => {
        upsertPresence(); // no location, still heartbeat
      },
      { enableHighAccuracy: false, timeout: 5000, maximumAge: 15000 }
    );
  }, [upsertPresence]);

  // Main lifecycle
  useEffect(() => {
    if (!user?.id || !isDriver) return;

    // Initial upsert with location
    upsertWithLocation();

    // Heartbeat every 30s
    intervalRef.current = setInterval(() => upsertPresence(), HEARTBEAT_MS);

    // Location update every ~12s
    locationIntervalRef.current = setInterval(upsertWithLocation, LOCATION_UPDATE_MS);

    // Visibility handling
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        offlineTimerRef.current = setTimeout(() => {
          upsertPresence('offline');
        }, OFFLINE_AFTER_MS);
      } else {
        if (offlineTimerRef.current) {
          clearTimeout(offlineTimerRef.current);
          offlineTimerRef.current = null;
        }
        upsertWithLocation();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (locationIntervalRef.current) clearInterval(locationIntervalRef.current);
      if (offlineTimerRef.current) clearTimeout(offlineTimerRef.current);
      document.removeEventListener('visibilitychange', handleVisibility);
      upsertPresence('offline');
    };
  }, [user?.id, isDriver, upsertPresence, upsertWithLocation]);

  // Update when status or screen changes
  useEffect(() => {
    if (!user?.id || !isDriver) return;
    upsertPresence(status);
  }, [status, currentScreen, user?.id, isDriver, upsertPresence]);
}
