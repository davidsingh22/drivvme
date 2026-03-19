import { supabase } from '@/integrations/supabase/client';
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
        return true;
      }
    } catch {
      // verification below handles transient failures
    }

    if (await verifyRideStatus(rideId, expectedStatus)) {
      return true;
    }

    if (attempt < maxAttempts - 1) {
      await sleep(getRetryDelayMs(attempt, baseDelayMs));
    }
  }

  return verifyRideStatus(rideId, expectedStatus);
}
