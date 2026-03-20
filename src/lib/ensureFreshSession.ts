/**
 * Non-blocking session refresh utility.
 *
 * Fire-and-forget: call this *in parallel* with ride actions.
 * It will silently refresh the token in the background (max 2s).
 * If it times out or fails, the caller should NOT block — the
 * Supabase client will still use whatever token it already has.
 */

import { supabase } from '@/integrations/supabase/client';

let refreshInFlight: Promise<void> | null = null;

export async function ensureFreshSession(): Promise<void> {
  // Coalesce concurrent calls
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        await supabase.auth.refreshSession();
      } else {
        // Proactively refresh if token expires in < 60s
        const expiresAt = data.session.expires_at ?? 0;
        if (expiresAt * 1000 - Date.now() < 60_000) {
          await supabase.auth.refreshSession();
        }
      }
    } catch (e) {
      console.warn('[ensureFreshSession] background refresh failed (non-blocking):', e);
    }
  })();

  // Hard 2-second timeout — never block longer than this
  const timeout = new Promise<void>((resolve) => window.setTimeout(resolve, 2000));
  await Promise.race([refreshInFlight, timeout]);
  refreshInFlight = null;
}

/**
 * Fire-and-forget wrapper — never throws, never blocks the caller.
 * Use this before ride actions to refresh the token in the background.
 */
export function fireSessionRefresh(): void {
  ensureFreshSession().catch(() => {});
}
