import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface EscalationOptions {
  rideId: string;
  pickupLat: number;
  pickupLng: number;
  pickupAddress: string;
  dropoffAddress: string;
  estimatedFare: number;
  onTierChange?: (tier: number) => void;
  onDriverFound?: () => void;
}

/**
 * Hook to manage tiered driver notification escalation.
 * Closest-driver-first: only 1 driver per tier, 25s timeout each.
 * 
 * Tier 1 (0-25s): 3km radius, closest driver
 * Tier 2 (25-50s): 5km radius, next closest
 * Tier 3 (50-75s): 8km radius, next closest
 * Tier 4 (75s+): 12km radius, next closest
 * 
 * On start, reads the ride's current tier/notifiedDriverIds from DB
 * so it doesn't duplicate tier 1 (already sent by DB trigger).
 */
export function useDriverNotificationEscalation(options: EscalationOptions | null) {
  const {
    rideId,
    pickupLat,
    pickupLng,
    pickupAddress,
    dropoffAddress,
    estimatedFare,
    onTierChange,
    onDriverFound,
  } = options || {};

  const currentTierRef = useRef(1);
  const notifiedDriverIdsRef = useRef<string[]>([]);
  const escalationTimerRef = useRef<number | null>(null);
  const isActiveRef = useRef(false);

  const notifyDrivers = useCallback(async (tier: number) => {
    if (!rideId || !pickupLat || !pickupLng) return;

    console.log(`[Escalation] Notifying tier ${tier} for ride ${rideId}`);
    
    try {
      const response = await supabase.functions.invoke('notify-drivers-tiered', {
        body: {
          rideId,
          pickupAddress,
          dropoffAddress,
          estimatedFare,
          pickupLat,
          pickupLng,
          tier,
          excludeDriverIds: notifiedDriverIdsRef.current,
        },
      });

      if (response.error) {
        console.error('[Escalation] Notification error:', response.error);
        return;
      }

      const data = response.data;
      console.log(`[Escalation] Tier ${tier} result:`, data);

      // Track notified drivers to avoid duplicate notifications
      if (data?.notifiedDriverIds) {
        notifiedDriverIdsRef.current = [
          ...new Set([...notifiedDriverIdsRef.current, ...data.notifiedDriverIds])
        ];
      }

      onTierChange?.(tier);
      currentTierRef.current = tier;

    } catch (error) {
      console.error('[Escalation] Error:', error);
    }
  }, [rideId, pickupLat, pickupLng, pickupAddress, dropoffAddress, estimatedFare, onTierChange]);

  const scheduleEscalation = useCallback(() => {
    if (!isActiveRef.current) return;

    const tierTimings = {
      1: 25000,  // After 25s, escalate to tier 2 (next closest driver)
      2: 25000,  // After 50s total, escalate to tier 3
      3: 25000,  // After 75s total, escalate to tier 4
      4: null,   // No more escalation
    };

    const currentTier = currentTierRef.current;
    const nextDelay = tierTimings[currentTier as keyof typeof tierTimings];

    if (nextDelay === null) {
      console.log('[Escalation] Reached max tier, no more escalation');
      return;
    }

    // Calculate remaining time if tier 1 was already partially elapsed
    // (e.g. DB trigger sent tier 1, we're resuming)
    let adjustedDelay = nextDelay;
    if (currentTier === 1 && notifiedDriverIdsRef.current.length > 0) {
      // Check how long ago the last notification was sent
      // We'll use a shorter delay if tier 1 was already sent recently
      adjustedDelay = nextDelay; // Keep full 25s for the current tier's driver
    }

    console.log(`[Escalation] Scheduling tier ${currentTier + 1} in ${adjustedDelay / 1000}s`);

    escalationTimerRef.current = window.setTimeout(async () => {
      if (!isActiveRef.current) return;

      const nextTier = currentTier + 1;
      await notifyDrivers(nextTier);
      scheduleEscalation();
    }, adjustedDelay);
  }, [notifyDrivers]);

  const start = useCallback(async () => {
    if (!options || !rideId) return;

    console.log('[Escalation] Starting for ride:', rideId);
    isActiveRef.current = true;

    // Read ride's current state from DB to avoid duplicating tier 1
    try {
      const { data: ride } = await supabase
        .from('rides')
        .select('notification_tier, notified_driver_ids, last_notification_at, status, driver_id')
        .eq('id', rideId)
        .single();

      if (ride?.driver_id || (ride?.status && ride.status !== 'searching')) {
        console.log('[Escalation] Ride already has driver or is not searching, skipping');
        isActiveRef.current = false;
        return;
      }

      const dbTier = ride?.notification_tier || 0;
      const dbNotifiedIds = (ride?.notified_driver_ids || []) as string[];
      const lastNotifAt = ride?.last_notification_at ? new Date(ride.last_notification_at).getTime() : 0;

      if (dbTier >= 1 && dbNotifiedIds.length > 0) {
        // DB trigger already sent tier 1; resume from there
        console.log(`[Escalation] DB already at tier ${dbTier} with ${dbNotifiedIds.length} notified drivers, resuming escalation`);
        currentTierRef.current = dbTier;
        notifiedDriverIdsRef.current = dbNotifiedIds;
        onTierChange?.(dbTier);

        // Calculate remaining time for current tier's 25s window
        const elapsed = Date.now() - lastNotifAt;
        const remaining = Math.max(0, 25000 - elapsed);
        
        console.log(`[Escalation] ${remaining / 1000}s remaining for current tier, then escalate`);
        
        escalationTimerRef.current = window.setTimeout(async () => {
          if (!isActiveRef.current) return;
          const nextTier = currentTierRef.current + 1;
          if (nextTier > 4) {
            console.log('[Escalation] Already at max tier');
            return;
          }
          await notifyDrivers(nextTier);
          scheduleEscalation();
        }, remaining);
      } else {
        // No tier 1 yet — send it now
        currentTierRef.current = 1;
        notifiedDriverIdsRef.current = [];
        await notifyDrivers(1);
        scheduleEscalation();
      }
    } catch (err) {
      console.error('[Escalation] Error reading ride state, falling back to tier 1:', err);
      currentTierRef.current = 1;
      notifiedDriverIdsRef.current = [];
      await notifyDrivers(1);
      scheduleEscalation();
    }
  }, [options, rideId, notifyDrivers, scheduleEscalation, onTierChange]);

  const stop = useCallback(() => {
    console.log('[Escalation] Stopping');
    isActiveRef.current = false;
    if (escalationTimerRef.current) {
      clearTimeout(escalationTimerRef.current);
      escalationTimerRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  // Resume escalation on visibility change (tab comes back to focus)
  useEffect(() => {
    if (!rideId) return;

    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && isActiveRef.current) {
        console.log('[Escalation] Tab visible again, checking if escalation needed');
        // Re-start to recalculate timing from DB state
        start();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [rideId, start]);

  // Monitor ride status to stop escalation when driver is found
  useEffect(() => {
    if (!rideId) return;

    const channel = supabase
      .channel(`escalation-${rideId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'rides',
          filter: `id=eq.${rideId}`,
        },
        (payload) => {
          const updatedRide = payload.new as { status: string; driver_id: string | null };
          
          if (updatedRide.driver_id || updatedRide.status !== 'searching') {
            console.log('[Escalation] Driver found or status changed, stopping');
            stop();
            onDriverFound?.();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [rideId, stop, onDriverFound]);

  return { start, stop, currentTier: currentTierRef.current };
}
