import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { getValidAccessToken } from '@/lib/sessionRecovery';

const HEARTBEAT_MS = 15_000; // 15 seconds — matches rider cadence

/**
 * Global driver presence tracker — mirrors the rider's useRiderLocationTracking.
 * Runs at the App level for authenticated drivers to ensure driver_locations,
 * driver_presence, and presence tables stay fresh even on mobile resume.
 */
export function useDriverPresenceTracking() {
  const { user, profile, roles, isDriver, driverProfile } = useAuth();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastWriteRef = useRef(0);
  const mountedRef = useRef(true);

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

  const upsertPresence = useCallback(async () => {
    const userId = user?.id;
    if (!userId || !mountedRef.current) return;

    // Throttle — no more than once per 10s
    if (Date.now() - lastWriteRef.current < 10_000) return;

    const hasSession = await ensureSession();
    if (!hasSession) {
      console.warn('[DriverPresence] No valid session — skipping heartbeat');
      return;
    }

    const now = new Date().toISOString();
    const displayName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || user.email || userId;
    const isOnline = driverProfile?.is_online ?? true;

    lastWriteRef.current = Date.now();

    // Update all 3 tables in parallel — same pattern the rider tracker uses
    const [locRes, presRes, dpRes] = await Promise.all([
      // driver_locations — upsert so it works even if row doesn't exist yet
      supabase.from('driver_locations').upsert(
        {
          driver_id: userId,
          user_id: userId,
          lat: driverProfile?.current_lat ?? 45.5017,
          lng: driverProfile?.current_lng ?? -73.5673,
          is_online: isOnline,
          updated_at: now,
        },
        { onConflict: 'driver_id' }
      ),
      // presence table (generic — used by MSN)
      supabase.from('presence').upsert(
        {
          user_id: userId,
          role: 'DRIVER',
          display_name: displayName,
          source: 'web',
          last_seen_at: now,
          updated_at: now,
        },
        { onConflict: 'user_id' }
      ),
      // driver_presence — upsert
      supabase.from('driver_presence').upsert(
        {
          driver_id: userId,
          last_seen: now,
          updated_at: now,
          status: isOnline ? 'available' : 'offline',
          current_screen: 'dashboard',
          display_name: displayName,
        },
        { onConflict: 'driver_id' }
      ),
    ]);

    if (locRes.error) console.warn('[DriverPresence] driver_locations error:', locRes.error.message);
    if (presRes.error) console.warn('[DriverPresence] presence error:', presRes.error.message);
    if (dpRes.error) console.warn('[DriverPresence] driver_presence error:', dpRes.error.message);
  }, [user?.id, user?.email, profile?.first_name, profile?.last_name, driverProfile?.is_online, driverProfile?.current_lat, driverProfile?.current_lng, ensureSession]);

  useEffect(() => {
    mountedRef.current = true;

    if (!user?.id || !isDriver) {
      return () => { mountedRef.current = false; };
    }

    // Immediate write on mount
    void upsertPresence();

    // Heartbeat interval
    intervalRef.current = setInterval(upsertPresence, HEARTBEAT_MS);

    // Visibility change — aggressive recovery on app resume (same as rider)
    const handleVisibility = async () => {
      if (document.visibilityState === 'visible') {
        lastWriteRef.current = 0; // force through throttle
        void upsertPresence();
      }
    };
    const handleFocus = () => {
      lastWriteRef.current = 0;
      void upsertPresence();
    };
    const handlePageShow = () => {
      lastWriteRef.current = 0;
      void upsertPresence();
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('pageshow', handlePageShow);

    return () => {
      mountedRef.current = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, [user?.id, isDriver, upsertPresence]);
}
