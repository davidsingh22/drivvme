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
 * 
 * Tier 1 (0-10s): 3km radius, 2 drivers max
 * Tier 2 (10-20s): 5km radius, 3 drivers max
 * Tier 3 (20-30s): 8km radius, 3 drivers max
 * Tier 4 (30s+): 12km radius, 3 drivers max
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
      1: 10000,  // After 10s, escalate to tier 2
      2: 10000,  // After 20s total, escalate to tier 3
      3: 10000,  // After 30s total, escalate to tier 4
      4: null,   // No more escalation
    };

    const currentTier = currentTierRef.current;
    const nextDelay = tierTimings[currentTier as keyof typeof tierTimings];

    if (nextDelay === null) {
      console.log('[Escalation] Reached max tier, no more escalation');
      return;
    }

    console.log(`[Escalation] Scheduling tier ${currentTier + 1} in ${nextDelay / 1000}s`);

    escalationTimerRef.current = window.setTimeout(async () => {
      if (!isActiveRef.current) return;

      const nextTier = currentTier + 1;
      await notifyDrivers(nextTier);
      scheduleEscalation();
    }, nextDelay);
  }, [notifyDrivers]);

  const start = useCallback(async () => {
    if (!options) return;

    console.log('[Escalation] Starting for ride:', rideId);
    isActiveRef.current = true;
    currentTierRef.current = 1;
    notifiedDriverIdsRef.current = [];

    // Start with tier 1
    await notifyDrivers(1);
    scheduleEscalation();
  }, [options, rideId, notifyDrivers, scheduleEscalation]);

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
