/**
 * Resilient Request Utility
 *
 * Ensures every critical Supabase operation:
 * 1. Has a valid (non-expired) access token before firing
 * 2. Has a hard timeout so the UI never gets stuck
 * 3. Logs auth status for debugging stale-session issues
 *
 * IMPORTANT: Does NOT touch the driver-completion direct PATCH logic.
 */
import { supabase } from '@/integrations/supabase/client';
import { getValidAccessToken } from '@/lib/sessionRecovery';

const MAX_TIMEOUT_MS = 8000;

/**
 * Ensure the Supabase JS client has a fresh, valid session before making a request.
 * If the token is expired, this refreshes it via raw HTTP (bypassing frozen GoTrue).
 * Then pokes the Supabase client so it picks up the fresh token.
 */
export async function ensureFreshSession(): Promise<void> {
  try {
    // getValidAccessToken reads from localStorage, refreshes if expired
    const token = await getValidAccessToken();
    console.log('[resilientRequest] ✅ Token valid, length:', token.length);

    // Poke the Supabase JS client so it picks up the refreshed token
    // (setSession is a no-op if the token is already current)
    try {
      const stored = localStorage.getItem('sb-siadshsaiuecesydqzqo-auth-token');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.access_token && parsed?.refresh_token) {
          await supabase.auth.setSession({
            access_token: parsed.access_token,
            refresh_token: parsed.refresh_token,
          });
        }
      }
    } catch (syncErr) {
      // Non-fatal: the raw token in localStorage is what matters for REST calls
      console.warn('[resilientRequest] Supabase client sync failed (non-fatal):', syncErr);
    }
  } catch (err: any) {
    if (err?.message === 'NO_SESSION') {
      console.warn('[resilientRequest] No session found — user needs to log in');
      throw err;
    }
    if (err?.message === 'SESSION_EXPIRED') {
      console.error('[resilientRequest] Refresh token expired — forcing re-auth');
      throw err;
    }
    console.error('[resilientRequest] Token refresh failed:', err);
    throw err;
  }
}

/**
 * Wraps any async operation with:
 *  1. Token refresh (ensures valid auth)
 *  2. Hard timeout (UI never stuck)
 *  3. Logging
 *
 * @param label   Human-readable label for logs
 * @param fn      The async work to perform
 * @param timeoutMs  Max time before aborting (default 8s)
 */
export async function resilientCall<T>(
  label: string,
  fn: () => Promise<T>,
  timeoutMs = MAX_TIMEOUT_MS,
): Promise<T> {
  console.log(`[resilientRequest] ▶ ${label} — refreshing auth...`);
  const authStart = Date.now();

  try {
    await ensureFreshSession();
  } catch (err: any) {
    console.error(`[resilientRequest] ❌ ${label} — auth refresh failed after ${Date.now() - authStart}ms:`, err?.message);
    throw err;
  }

  console.log(`[resilientRequest] ✅ ${label} — auth OK (${Date.now() - authStart}ms), executing...`);

  // Execute with timeout
  const start = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([fn(), timeoutPromise]);
    console.log(`[resilientRequest] ✅ ${label} — done (${Date.now() - start}ms)`);
    return result;
  } catch (err: any) {
    console.error(`[resilientRequest] ❌ ${label} — failed after ${Date.now() - start}ms:`, err?.message);
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
