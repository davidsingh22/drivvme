import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

/**
 * Session Recovery Utility
 *
 * Bypasses the auth client's normal timing when mobile WebViews wake up with a
 * stale or half-restored session. It can read/write the stored session directly,
 * refresh tokens over raw HTTP, and then re-hydrate the auth client.
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
const STORAGE_KEY = 'sb-siadshsaiuecesydqzqo-auth-token';

interface StoredSession {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in?: number;
  token_type?: string;
  user?: any;
  [key: string]: any;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: number | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(`TIMEOUT_${timeoutMs}`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;

  try {
    return JSON.stringify(error);
  } catch {
    return 'Unknown error';
  }
}

/** Decode JWT payload without a library */
function decodeJwtPayload(token: string): { exp?: number; [key: string]: any } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

/** Check if a JWT is expired (with 60s buffer) */
function isTokenExpired(token: string): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return true;
  const nowSec = Math.floor(Date.now() / 1000);
  return payload.exp < nowSec + 60;
}

/** Read stored session from localStorage */
function readStoredSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.access_token && parsed?.refresh_token) return parsed;
    if (parsed?.currentSession?.access_token) return parsed.currentSession;
    return null;
  } catch {
    return null;
  }
}

/** Write session back to localStorage so the auth client stays in sync */
function writeStoredSession(session: StoredSession): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    console.warn('[sessionRecovery] Failed to write session to localStorage');
  }
}

/**
 * Raw token refresh — POST directly to the auth endpoint.
 * This never depends on the auth client being healthy.
 */
async function rawRefreshToken(refreshToken: string): Promise<StoredSession> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: ANON_KEY,
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if (res.status === 400 || res.status === 401) {
        console.error('[sessionRecovery] Refresh token expired/invalid — clearing session');
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          // ignore
        }
        throw new Error('SESSION_EXPIRED');
      }
      throw new Error(`Token refresh failed (${res.status}): ${body}`);
    }

    const contentType = res.headers.get('content-type');
    if (!contentType?.includes('application/json')) {
      const text = await res.text().catch(() => '');
      console.error('[sessionRecovery] Non-JSON refresh response:', text.substring(0, 200));
      throw new Error('Token refresh returned unexpected response');
    }

    const data = await res.json();
    if (!data?.access_token || !data?.refresh_token) {
      throw new Error('Invalid refresh response — missing tokens');
    }

    return data as StoredSession;
  } catch (err: any) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      throw new Error('Token refresh timed out (8s)');
    }
    throw err;
  }
}

/**
 * Ensure the auth client has a real active session, recovering it when needed.
 * Returns null only after getSession, raw recovery, setSession, and refreshSession
 * have all failed.
 */
export async function ensureSupabaseSession(): Promise<Session | null> {
  try {
    const { data, error } = await withTimeout(supabase.auth.getSession(), 3500);
    if (error) console.warn('[sessionRecovery] getSession error:', error.message);
    if (data.session?.user?.id) return data.session;
    console.warn('[sessionRecovery] No active session from auth client, attempting recovery');
  } catch (error) {
    console.warn('[sessionRecovery] getSession threw:', getErrorMessage(error));
  }

  const stored = readStoredSession();
  if (!stored?.refresh_token) {
    console.error('[sessionRecovery] No stored session available for recovery');
    return null;
  }

  let recovered = stored;

  if (isTokenExpired(recovered.access_token)) {
    try {
      console.warn('[sessionRecovery] Stored access token expired, refreshing via raw HTTP');
      recovered = { ...stored, ...(await rawRefreshToken(stored.refresh_token)) };
      writeStoredSession(recovered);
    } catch (error) {
      console.error('[sessionRecovery] Raw refresh failed:', getErrorMessage(error));
      return null;
    }
  }

  try {
    const { data, error } = await withTimeout(
      supabase.auth.setSession({
        access_token: recovered.access_token,
        refresh_token: recovered.refresh_token,
      }),
      5000
    );

    if (error) {
      console.error('[sessionRecovery] setSession error:', error.message);
    }
    if (data.session?.user?.id) {
      return data.session;
    }
  } catch (error) {
    console.error('[sessionRecovery] setSession threw:', getErrorMessage(error));
  }

  try {
    const { data, error } = await withTimeout(supabase.auth.refreshSession(), 5000);
    if (error) {
      console.error('[sessionRecovery] refreshSession error:', error.message);
    }
    if (data.session?.user?.id) {
      return data.session;
    }
  } catch (error) {
    console.error('[sessionRecovery] refreshSession threw:', getErrorMessage(error));
  }

  try {
    const { data, error } = await withTimeout(supabase.auth.getSession(), 3500);
    if (error) {
      console.error('[sessionRecovery] final getSession error:', error.message);
    }
    if (data.session?.user?.id) return data.session;
  } catch (error) {
    console.error('[sessionRecovery] final getSession threw:', getErrorMessage(error));
  }

  console.error('[sessionRecovery] Session recovery failed');
  return null;
}

/**
 * Get a valid access token.
 * - Returns immediately if the stored token is still valid.
 * - Refreshes via raw HTTP if expired.
 * - Throws if no recoverable session exists.
 */
export async function getValidAccessToken(): Promise<string> {
  const stored = readStoredSession();
  if (!stored) {
    throw new Error('NO_SESSION');
  }

  if (!isTokenExpired(stored.access_token)) {
    return stored.access_token;
  }

  console.log('[sessionRecovery] Access token expired, refreshing via raw HTTP...');
  const newSession = await rawRefreshToken(stored.refresh_token);

  const merged: StoredSession = {
    ...stored,
    ...newSession,
  };
  writeStoredSession(merged);

  console.log('[sessionRecovery] Token refreshed successfully');
  return newSession.access_token;
}

/** Quick check: is there any session at all? */
export function hasStoredSession(): boolean {
  return readStoredSession() !== null;
}

export { ANON_KEY, STORAGE_KEY, SUPABASE_URL };
