/**
 * Watchdog — self-healing monitor that runs every 60 seconds.
 *
 * 1. Checks Supabase realtime connectivity → reconnects if dead.
 * 2. Checks presence heartbeat freshness → re-upserts if stale (>15 s).
 * 3. Checks session token health → refreshes if expiring soon.
 * 4. Checks driver online + GPS freshness → re-triggers presence if stale.
 *
 * All actions are non-blocking fire-and-forget. The watchdog never throws.
 */

import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { fireSessionRefresh } from '@/lib/ensureFreshSession';

const WATCHDOG_INTERVAL_MS = 60_000; // 60 seconds
const STALE_THRESHOLD_MS = 15_000;   // 15 seconds without update = stale

// Global timestamps that other hooks can stamp into
// This lets the watchdog observe freshness without coupling to hook internals
export const watchdogTimestamps = {
  lastPresenceUpsert: 0,
  lastRealtimeEvent: 0,
  lastGpsWrite: 0,
};

/** Stamp a timestamp from any hook */
export function stampWatchdog(key: keyof typeof watchdogTimestamps) {
  watchdogTimestamps[key] = Date.now();
}

export function useWatchdog() {
  const { user, roles } = useAuth();
  const isDriver = roles.includes('driver');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!user?.id) return;

    const runWatchdog = async () => {
      const now = Date.now();
      const tag = '[Watchdog]';

      try {
        // ── 1. Session health ──────────────────────────────────
        // Fire-and-forget token refresh (2 s hard cap inside ensureFreshSession)
        fireSessionRefresh();

        // ── 2. Presence heartbeat freshness ────────────────────
        const presenceAge = now - watchdogTimestamps.lastPresenceUpsert;
        if (watchdogTimestamps.lastPresenceUpsert > 0 && presenceAge > STALE_THRESHOLD_MS) {
          console.warn(`${tag} Presence stale (${Math.round(presenceAge / 1000)}s) — re-upserting`);
          void supabase.from('presence').upsert(
            {
              user_id: user.id,
              last_seen_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id' }
          ).then(({ error }) => {
            if (error) console.error(`${tag} presence re-upsert failed:`, error.message);
            else stampWatchdog('lastPresenceUpsert');
          });
        }

        // ── 3. Realtime connectivity ───────────────────────────
        // Check all active channels — if any are in a bad state, remove + let hooks re-subscribe
        const channels = supabase.getChannels();
        let reconnectedCount = 0;
        for (const ch of channels) {
          // Channel states: 'joined', 'joining', 'leaving', 'closed', 'errored'
          const state = (ch as any).state;
          if (state === 'errored' || state === 'closed') {
            console.warn(`${tag} Channel "${(ch as any).topic}" in state "${state}" — removing for reconnect`);
            supabase.removeChannel(ch);
            reconnectedCount++;
          }
        }
        if (reconnectedCount > 0) {
          console.log(`${tag} Removed ${reconnectedCount} dead channel(s) — hooks will re-subscribe`);
        }

        // ── 4. Driver online but GPS stale ─────────────────────
        if (isDriver && watchdogTimestamps.lastGpsWrite > 0) {
          const gpsAge = now - watchdogTimestamps.lastGpsWrite;
          if (gpsAge > STALE_THRESHOLD_MS) {
            console.warn(`${tag} Driver GPS stale (${Math.round(gpsAge / 1000)}s) — re-upserting driver_presence`);
            void supabase.from('driver_presence').upsert(
              {
                driver_id: user.id,
                status: 'online',
                last_seen: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                current_screen: 'dashboard',
              },
              { onConflict: 'driver_id' }
            ).then(({ error }) => {
              if (error) console.error(`${tag} driver_presence re-upsert failed:`, error.message);
            });
          }
        }
      } catch (err) {
        // Watchdog must never crash — swallow everything
        console.error(`${tag} unexpected error (swallowed):`, err);
      }
    };

    // Run once immediately, then every 60s
    runWatchdog();
    intervalRef.current = setInterval(runWatchdog, WATCHDOG_INTERVAL_MS);

    // Also run on visibility resume (app foregrounded)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        console.log('[Watchdog] App foregrounded — running check');
        runWatchdog();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // Run on network reconnect
    const handleOnline = () => {
      console.log('[Watchdog] Network online — running check');
      runWatchdog();
    };
    window.addEventListener('online', handleOnline);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('online', handleOnline);
    };
  }, [user?.id, isDriver]);
}
