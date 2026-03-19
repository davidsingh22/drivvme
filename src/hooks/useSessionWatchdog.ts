/**
 * Global Session Watchdog
 *
 * Proactively refreshes auth tokens every 2 minutes so background systems
 * (polling, realtime, presence) never silently fail due to expired tokens.
 *
 * Also refreshes on visibility change (app foregrounded).
 *
 * Emits a custom event 'session-refreshed' when a token refresh actually occurs,
 * so realtime subscriptions can reinitialize.
 */
import { useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { ensureFreshSession } from '@/lib/resilientRequest';

const WATCHDOG_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

export function useSessionWatchdog() {
  const { user } = useAuth();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!user?.id) return;

    const run = async () => {
      try {
        await ensureFreshSession();
      } catch (err: any) {
        console.warn('[SessionWatchdog] refresh failed (non-fatal):', err?.message);
      }
      // Schedule next run
      timerRef.current = setTimeout(run, WATCHDOG_INTERVAL_MS);
    };

    // First run after 2 min
    timerRef.current = setTimeout(run, WATCHDOG_INTERVAL_MS);

    // Also refresh on visibility change
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        ensureFreshSession().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [user?.id]);
}
