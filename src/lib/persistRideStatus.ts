import { supabase } from '@/integrations/supabase/client';
import { ensureFreshSession } from '@/lib/ensureFreshSession';
import { withTimeout } from '@/lib/withTimeout';

interface PersistRideStatusOptions {
  rideId: string;
  expectedStatus: string;
  updates: Record<string, any>;
  driverId?: string | null;
  label: string;
  maxAttempts?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
}

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const getRetryDelayMs = (attempt: number, baseDelayMs: number) => {
  const exponentialDelay = baseDelayMs * 2 ** attempt;
  const jitter = Math.floor(Math.random() * 350);
  return Math.min(exponentialDelay + jitter, 6000);
};

const isAuthError = (error: unknown) => {
  if (!error) return false;
  const normalized = JSON.stringify(error).toLowerCase();
  return [
    'jwt',
    'auth',
    'token',
    'session',
    'not authenticated',
    'unauthorized',
    'forbidden',
    '401',
    '403',
    'pgrst301',
  ].some((term) => normalized.includes(term));
};

async function verifyRideStatus(rideId: string, expectedStatus: string) {
  try {
    const { data, error } = await supabase
      .from('rides')
      .select('status')
      .eq('id', rideId)
      .maybeSingle();

    return !error && data?.status === expectedStatus;
  } catch {
    return false;
  }
}

async function attemptPersistRideStatus({
  rideId,
  expectedStatus,
  updates,
  driverId,
  label,
  maxAttempts,
  baseDelayMs,
  timeoutMs,
}: Required<PersistRideStatusOptions>): Promise<{ success: boolean; sawAuthError: boolean }> {
  let sawAuthError = false;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const query = supabase
        .from('rides')
        .update(updates)
        .eq('id', rideId);

      const filteredQuery = driverId ? query.eq('driver_id', driverId) : query;

      const { data, error } = await withTimeout(
        filteredQuery.select('id, status').maybeSingle().then((result) => result),
        timeoutMs,
        label,
      );

      if (!error && data?.status === expectedStatus) {
        return { success: true, sawAuthError };
      }

      if (isAuthError(error)) {
        sawAuthError = true;
      }
    } catch (error) {
      if (isAuthError(error)) {
        sawAuthError = true;
      }
    }

    if (await verifyRideStatus(rideId, expectedStatus)) {
      return { success: true, sawAuthError };
    }

    if (attempt < maxAttempts - 1) {
      await sleep(getRetryDelayMs(attempt, baseDelayMs));
    }
  }

  return {
    success: await verifyRideStatus(rideId, expectedStatus),
    sawAuthError,
  };
}

export async function persistRideStatus({
  rideId,
  expectedStatus,
  updates,
  driverId,
  label,
  maxAttempts = 4,
  baseDelayMs = 500,
  timeoutMs = 10000,
}: PersistRideStatusOptions): Promise<boolean> {
  const options = {
    rideId,
    expectedStatus,
    updates,
    driverId: driverId ?? null,
    label,
    maxAttempts,
    baseDelayMs,
    timeoutMs,
  };

  const initialAttempt = await attemptPersistRideStatus(options);
  if (initialAttempt.success) {
    return true;
  }

  if (!initialAttempt.sawAuthError) {
    return false;
  }

  console.warn('[persistRideStatus] auth issue detected, refreshing session before one final retry', {
    rideId,
    expectedStatus,
    label,
  });

  await ensureFreshSession().catch((error) => {
    console.warn('[persistRideStatus] session refresh failed before retry:', error);
  });

  const retryAttempt = await attemptPersistRideStatus({
    ...options,
    maxAttempts: Math.min(options.maxAttempts, 2),
    baseDelayMs: Math.min(options.baseDelayMs, 300),
  });

  return retryAttempt.success;
}
