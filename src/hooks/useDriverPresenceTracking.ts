import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { getValidAccessToken } from '@/lib/sessionRecovery';

const HEARTBEAT_MS = 15_000;
const OFFLINE_AFTER_MS = 60_000;

/**
 * Global driver presence tracker.
 * Mirrors the rider presence behavior so drivers show up in MSN immediately
 * when the app reopens, even before the dashboard fully settles.
 */
export function useDriverPresenceTracking() {
  const { user, profile, roles, authLoading, driverProfile } = useAuth();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const offlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastWriteRef = useRef(0);

  const shouldTrackDriver = !!user?.id && (roles.includes('driver') || (() => {
    try {
      return localStorage.getItem('last_route') === '/driver';
    } catch {
      return false;
    }
  })());

  const ensureSession = useCallback(async (): Promise<boolean> => {
    try {
      const token = await getValidAccessToken().catch(() => null);
      if (token) return true;

      const { data } = await supabase.auth.getSession();
      if (data.session) return true;

      const { data: refreshed } = await supabase.auth.refreshSession();
      return !!refreshed.session;
    } catch {
      return false;
    }
  }, []);

  const writePresence = useCallback(async (status: 'available' | 'offline' | 'on_trip' = 'available') => {
    if (!user?.id) return;

    const hasSession = await ensureSession();
    if (!hasSession) return;

    const now = new Date().toISOString();
    const displayName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || user.email || user.id;
    const lat = driverProfile?.current_lat ?? 45.5017;
    const lng = driverProfile?.current_lng ?? -73.5673;
    const isOnline = status !== 'offline';

    lastWriteRef.current = Date.now();

    const [driverLocationsRes, driverPresenceRes, presenceRes] = await Promise.all([
      supabase.from('driver_locations').upsert(
        {
          driver_id: user.id,
          user_id: user.id,
          lat,
          lng,
          is_online: isOnline,
          updated_at: now,
        },
        { onConflict: 'driver_id' }
      ),
      supabase.from('driver_presence').upsert(
        {
          driver_id: user.id,
          last_seen: now,
          updated_at: now,
          status,
          current_screen: 'dashboard',
          display_name: displayName,
          lat,
          lng,
        },
        { onConflict: 'driver_id' }
      ),
      supabase.from('presence').upsert(
        {
          user_id: user.id,
          role: 'DRIVER',
          display_name: displayName,
          source: 'web',
          last_seen_at: now,
          updated_at: now,
        },
        { onConflict: 'user_id' }
      ),
    ]);

    if (driverLocationsRes.error) console.warn('[DriverPresence] driver_locations error:', driverLocationsRes.error.message);
    if (driverPresenceRes.error) console.warn('[DriverPresence] driver_presence error:', driverPresenceRes.error.message);
    if (presenceRes.error) console.warn('[DriverPresence] presence error:', presenceRes.error.message);
  }, [user?.id, user?.email, profile?.first_name, profile?.last_name, driverProfile?.current_lat, driverProfile?.current_lng, ensureSession]);

  const heartbeat = useCallback(async () => {
    if (!shouldTrackDriver || authLoading || !user?.id) return;
    if (Date.now() - lastWriteRef.current < 5_000) return;

    const status = driverProfile?.is_online === false ? 'offline' : 'available';
    await writePresence(status);
  }, [shouldTrackDriver, authLoading, user?.id, driverProfile?.is_online, writePresence]);

  useEffect(() => {
    if (authLoading || !shouldTrackDriver || !user?.id) return;

    void heartbeat();
    intervalRef.current = setInterval(heartbeat, HEARTBEAT_MS);

    const resume = () => {
      if (document.visibilityState === 'visible') {
        if (offlineTimerRef.current) {
          clearTimeout(offlineTimerRef.current);
          offlineTimerRef.current = null;
        }
        lastWriteRef.current = 0;
        void heartbeat();
      }
    };

    const hide = () => {
      if (document.visibilityState === 'hidden') {
        offlineTimerRef.current = setTimeout(() => {
          void writePresence('offline');
        }, OFFLINE_AFTER_MS);
      }
    };

    const authSub = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        lastWriteRef.current = 0;
        void heartbeat();
      }
    });

    document.addEventListener('visibilitychange', hide);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('pageshow', resume);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (offlineTimerRef.current) clearTimeout(offlineTimerRef.current);
      authSub.data.subscription.unsubscribe();
      document.removeEventListener('visibilitychange', hide);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume);
      window.removeEventListener('pageshow', resume);
    };
  }, [authLoading, shouldTrackDriver, user?.id, heartbeat, writePresence]);
}
