/**
 * Session Recovery Utility
 * 
 * Bypasses the Supabase JS client's GoTrue layer entirely to refresh tokens.
 * This is critical for mobile WebViews (Median/GoNative) where the JS client's
 * internal auto-refresh timer gets corrupted after backgrounding for 10+ minutes,
 * causing all client methods (getSession, refreshSession, from().insert()) to hang.
 *
 * Strategy:
 * 1. Read tokens from localStorage (synchronous, never hangs)
 * 2. Check if access_token is expired by decoding the JWT
 * 3. If expired, do a raw POST to /auth/v1/token?grant_type=refresh_token
 * 4. Write the new session back to localStorage so the Supabase client picks it up
 * 5. Return a valid access_token
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
  if (!payload?.exp) return true; // Can't determine — treat as expired
  const nowSec = Math.floor(Date.now() / 1000);
  return payload.exp < nowSec + 60; // 60s buffer
}

/** Read stored session from localStorage */
function readStoredSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Handle both direct format and nested currentSession format
    if (parsed?.access_token && parsed?.refresh_token) return parsed;
    if (parsed?.currentSession?.access_token) return parsed.currentSession;
    return null;
  } catch {
    return null;
  }
}

/** Write session back to localStorage so Supabase client stays in sync */
function writeStoredSession(session: StoredSession): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    console.warn('[sessionRecovery] Failed to write session to localStorage');
  }
}

/**
 * Raw token refresh — POST directly to the Supabase Auth endpoint.
 * This NEVER touches the Supabase JS client or GoTrue internals.
 */
async function rawRefreshToken(refreshToken: string): Promise<StoredSession> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000); // 8s hard timeout

  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': ANON_KEY,
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // If the refresh token itself is expired/invalid, clear session
      if (res.status === 400 || res.status === 401) {
        console.error('[sessionRecovery] Refresh token expired/invalid — clearing session');
        try { localStorage.removeItem(STORAGE_KEY); } catch {}
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
 * Get a valid access token. This is the ONLY function you need to call.
 * 
 * - If the stored token is still valid, returns it immediately (synchronous path).
 * - If expired, performs a raw HTTP refresh and updates localStorage.
 * - Throws if no session exists or refresh fails (caller should redirect to /login).
 */
export async function getValidAccessToken(): Promise<string> {
  const stored = readStoredSession();
  if (!stored) {
    throw new Error('NO_SESSION');
  }

  // Fast path: token is still valid
  if (!isTokenExpired(stored.access_token)) {
    return stored.access_token;
  }

  // Slow path: token expired — do a raw refresh
  console.log('[sessionRecovery] Access token expired, refreshing via raw HTTP...');
  const newSession = await rawRefreshToken(stored.refresh_token);
  
  // Merge with existing stored data (preserve user metadata etc.)
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

/** Export constants for use in raw fetch calls */
export { SUPABASE_URL, ANON_KEY, STORAGE_KEY };
