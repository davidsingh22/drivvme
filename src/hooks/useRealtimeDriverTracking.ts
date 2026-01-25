import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useMapboxToken } from '@/hooks/useMapboxToken';

export interface DriverLocation {
  lat: number;
  lng: number;
  heading?: number | null;
  speed?: number | null;
  accuracy?: number | null;
  updatedAt: number;
}

interface ETAInfo {
  minutes: number;
  distanceKm: number;
  lastCalculated: number;
}

interface UseRealtimeDriverTrackingOptions {
  rideId: string | null;
  driverId: string | null;
  targetLocation: { lat: number; lng: number } | null;
  enabled: boolean;
}

const ETA_REFRESH_INTERVAL = 10000; // 10 seconds
const ETA_DISTANCE_THRESHOLD = 100; // 100 meters
const LIVE_THRESHOLD_MS = 8000; // 8 seconds for LIVE badge
const RESUBSCRIBE_DELAY = 1000; // 1 second delay before resubscribe
const POLL_INTERVAL = 3000; // 3 seconds - aggressive polling fallback

// Haversine distance in meters
const getDistanceMeters = (
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number => {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// Fallback ETA calculation when API fails
const calculateFallbackETA = (
  driverLat: number, driverLng: number,
  targetLat: number, targetLng: number
): ETAInfo => {
  const distanceM = getDistanceMeters(driverLat, driverLng, targetLat, targetLng);
  const distanceKm = distanceM / 1000;
  // Assume average speed of 30 km/h in city
  const avgSpeedKmh = 30;
  const minutes = Math.max(1, Math.round((distanceKm / avgSpeedKmh) * 60));
  return { minutes, distanceKm, lastCalculated: Date.now() };
};

export function useRealtimeDriverTracking({
  rideId,
  driverId,
  targetLocation,
  enabled,
}: UseRealtimeDriverTrackingOptions) {
  const [driverLocation, setDriverLocation] = useState<DriverLocation | null>(null);
  const [eta, setEta] = useState<ETAInfo | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdateSeconds, setLastUpdateSeconds] = useState(0);
  const [dataSource, setDataSource] = useState<'REALTIME' | 'POLL' | 'FALLBACK' | 'NONE'>('NONE');
  const [hasNoUpdatesError, setHasNoUpdatesError] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [waitingForDriver, setWaitingForDriver] = useState(false);

  const { token: mapboxToken } = useMapboxToken();
  const lastETAPositionRef = useRef<{ lat: number; lng: number } | null>(null);
  const etaIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const updateTimerRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastRealtimeUpdateRef = useRef<number>(0);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const resubscribeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const subscriptionCountRef = useRef<number>(0);
  const lastResubscribeAtRef = useRef<number>(0);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch ETA from Mapbox Directions API
  const fetchETA = useCallback(async (
    driverLoc: { lat: number; lng: number },
    target: { lat: number; lng: number },
    force = false
  ) => {
    if (!mapboxToken) {
      // Use fallback
      setEta(calculateFallbackETA(driverLoc.lat, driverLoc.lng, target.lat, target.lng));
      return;
    }

    // Check if we need to update based on distance
    if (!force && lastETAPositionRef.current) {
      const distance = getDistanceMeters(
        lastETAPositionRef.current.lat,
        lastETAPositionRef.current.lng,
        driverLoc.lat,
        driverLoc.lng
      );
      if (distance < ETA_DISTANCE_THRESHOLD && eta) {
        return; // Not moved enough, keep current ETA
      }
    }

    // Abort any pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch(
        `https://api.mapbox.com/directions/v5/mapbox/driving/${driverLoc.lng},${driverLoc.lat};${target.lng},${target.lat}?access_token=${mapboxToken}`,
        { signal: abortControllerRef.current.signal }
      );
      const data = await response.json();

      if (data.routes?.[0]) {
        lastETAPositionRef.current = { lat: driverLoc.lat, lng: driverLoc.lng };
        setEta({
          minutes: Math.max(1, Math.round(data.routes[0].duration / 60)),
          distanceKm: data.routes[0].distance / 1000,
          lastCalculated: Date.now(),
        });
      } else {
        // API returned no routes, use fallback
        setEta(calculateFallbackETA(driverLoc.lat, driverLoc.lng, target.lat, target.lng));
      }
    } catch (err) {
      if ((err as any)?.name !== 'AbortError') {
        console.error('[Tracking] ETA fetch error, using fallback:', err);
        setEta(calculateFallbackETA(driverLoc.lat, driverLoc.lng, target.lat, target.lng));
      }
    }
  }, [mapboxToken, eta]);

  // Subscribe to realtime updates
  const subscribe = useCallback(() => {
    if (!rideId || !enabled) return;

    // Remove existing channel if any
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    subscriptionCountRef.current += 1;
    const subscriptionId = subscriptionCountRef.current;
    console.log(`[Tracking] Subscribing to ride_locations for rideId: ${rideId} (sub #${subscriptionId})`);
    setIsReconnecting(false);

    const handleLocationPayload = (payload: any) => {
      const updated = payload.new as {
        lat: number;
        lng: number;
        speed: number | null;
        accuracy: number | null;
        heading: number | null;
        created_at: string;
        updated_at?: string;
      };

      console.log(`[Tracking] Realtime location update (sub #${subscriptionId}):`, updated);
      
      const location: DriverLocation = {
        lat: updated.lat,
        lng: updated.lng,
        speed: updated.speed,
        accuracy: updated.accuracy,
        heading: updated.heading,
        updatedAt: new Date(updated.updated_at || updated.created_at).getTime(),
      };
      setDriverLocation(location);
      setIsConnected(true);
      setDataSource('REALTIME');
      setHasNoUpdatesError(false);
      setIsReconnecting(false);
      setWaitingForDriver(false);
      lastRealtimeUpdateRef.current = Date.now();

      // Update ETA when driver moves
      if (targetLocation) {
        fetchETA(location, targetLocation);
      }
    };

    const channel = supabase
      .channel(`ride-locations-realtime-${rideId}-${subscriptionId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'ride_locations',
          filter: `ride_id=eq.${rideId}`,
        },
        handleLocationPayload
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'ride_locations',
          filter: `ride_id=eq.${rideId}`,
        },
        handleLocationPayload
      )
      .subscribe((status) => {
        console.log(`[Tracking] Realtime subscription status (sub #${subscriptionId}):`, status);
        setIsConnected(status === 'SUBSCRIBED');
        // If the channel is repeatedly closing, we still have polling fallback.
        if (status === 'CLOSED') {
          // Light backoff + rate limit to avoid thrashing
          const now = Date.now();
          if (now - lastResubscribeAtRef.current > 3000) {
            lastResubscribeAtRef.current = now;
            setIsReconnecting(true);
            if (resubscribeTimeoutRef.current) {
              clearTimeout(resubscribeTimeoutRef.current);
            }
            resubscribeTimeoutRef.current = setTimeout(() => {
              subscribe();
            }, RESUBSCRIBE_DELAY);
          }
        }
      });

    channelRef.current = channel;
  }, [rideId, enabled, targetLocation, fetchETA]);

  // Resubscribe function
  const resubscribe = useCallback(() => {
    console.log('[Tracking] Resubscribing to realtime channel...');
    setIsReconnecting(true);
    
    // Clear existing timeout
    if (resubscribeTimeoutRef.current) {
      clearTimeout(resubscribeTimeoutRef.current);
    }
    
    // Small delay before resubscribe to avoid hammering
    resubscribeTimeoutRef.current = setTimeout(() => {
      subscribe();
    }, RESUBSCRIBE_DELAY);
  }, [subscribe]);

  // Fetch initial driver location from ride_locations or fallback to driver_profiles
  useEffect(() => {
    if (!enabled) return;
    if (!rideId && !driverId) return;

    const fetchInitial = async () => {
      // Try ride_locations first (preferred - keyed by rideId)
      if (rideId) {
        const { data: locData } = await supabase
          .from('ride_locations')
          .select('lat, lng, speed, accuracy, heading, created_at, updated_at')
          .eq('ride_id', rideId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (locData) {
          const location: DriverLocation = {
            lat: locData.lat,
            lng: locData.lng,
            speed: locData.speed,
            accuracy: locData.accuracy,
            heading: locData.heading,
            updatedAt: new Date(locData.updated_at || locData.created_at).getTime(),
          };
          setDriverLocation(location);
          setIsConnected(true);
          setDataSource('POLL');
          setWaitingForDriver(false);
          lastRealtimeUpdateRef.current = Date.now();

          if (targetLocation) {
            fetchETA(location, targetLocation, true);
          }
          return;
        } else {
          // No row exists yet
          setWaitingForDriver(true);
        }
      }

      // Fallback to driver_profiles
      if (driverId) {
        const { data } = await supabase
          .from('driver_profiles')
          .select('current_lat, current_lng, updated_at')
          .eq('user_id', driverId)
          .single();

        if (data?.current_lat && data?.current_lng) {
          const location: DriverLocation = {
            lat: data.current_lat,
            lng: data.current_lng,
            updatedAt: new Date(data.updated_at).getTime(),
          };
          setDriverLocation(location);
          setIsConnected(true);
          setDataSource('FALLBACK');
          setWaitingForDriver(false);
          lastRealtimeUpdateRef.current = Date.now();

          if (targetLocation) {
            fetchETA(location, targetLocation, true);
          }
        }
      }
    };

    fetchInitial();
  }, [rideId, driverId, enabled, targetLocation, fetchETA]);

  // Subscribe to realtime ride_locations updates
  useEffect(() => {
    if (!rideId || !enabled) {
      return;
    }

    subscribe();

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      if (resubscribeTimeoutRef.current) {
        clearTimeout(resubscribeTimeoutRef.current);
      }
    };
  }, [rideId, enabled, subscribe]);

  // AGGRESSIVE POLLING FALLBACK: fetch latest row every 3s
  // Always runs regardless of realtime status - this is our safety net
  useEffect(() => {
    if (!rideId || !enabled) return;

    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }

    const pollForLocation = async () => {
      const { data: locData, error } = await supabase
        .from('ride_locations')
        .select('lat, lng, speed, accuracy, heading, created_at, updated_at')
        .eq('ride_id', rideId)
        .maybeSingle();

      if (error) {
        console.error('[Tracking] Poll error:', error);
        return;
      }
      
      if (!locData) {
        // No row exists yet - driver hasn't sent any GPS
        setWaitingForDriver(true);
        return;
      }

      setWaitingForDriver(false);
      const updatedAtMs = new Date(locData.updated_at || locData.created_at).getTime();
      const currentUpdatedAt = driverLocation?.updatedAt ?? 0;

      // Only apply if the DB row is newer than what we already have
      if (updatedAtMs > currentUpdatedAt) {
        const location: DriverLocation = {
          lat: locData.lat,
          lng: locData.lng,
          speed: locData.speed,
          accuracy: locData.accuracy,
          heading: locData.heading,
          updatedAt: updatedAtMs,
        };
        setDriverLocation(location);
        setDataSource('POLL');
        setHasNoUpdatesError(false);
        
        if (targetLocation) {
          fetchETA(location, targetLocation, true);
        }
      }
    };

    // Poll immediately on mount
    pollForLocation();
    
    pollIntervalRef.current = setInterval(pollForLocation, POLL_INTERVAL);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [rideId, enabled, driverLocation?.updatedAt, targetLocation, fetchETA]);

  // Fallback subscription to driver_profiles (if no ride_locations updates)
  useEffect(() => {
    if (!driverId || !enabled) {
      return;
    }

    const channel = supabase
      .channel(`driver-tracking-fallback-${driverId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'driver_profiles',
          filter: `user_id=eq.${driverId}`,
        },
        (payload) => {
          const updated = payload.new as {
            current_lat: number | null;
            current_lng: number | null;
            updated_at: string;
          };

          if (updated.current_lat && updated.current_lng) {
            // Only use fallback if no recent updates from primary source
            const timeSinceRealtime = Date.now() - lastRealtimeUpdateRef.current;
            if (timeSinceRealtime > 5000) {
              const location: DriverLocation = {
                lat: updated.current_lat,
                lng: updated.current_lng,
                updatedAt: new Date(updated.updated_at).getTime(),
              };
              setDriverLocation(location);
              setDataSource('FALLBACK');
              setLastUpdateSeconds(0);
              setHasNoUpdatesError(false);
              setWaitingForDriver(false);

              if (targetLocation) {
                fetchETA(location, targetLocation);
              }
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [driverId, enabled, targetLocation, fetchETA]);

  // Periodic ETA refresh (every 10 seconds)
  useEffect(() => {
    if (!driverLocation || !targetLocation || !enabled) return;

    etaIntervalRef.current = setInterval(() => {
      fetchETA(driverLocation, targetLocation, true);
    }, ETA_REFRESH_INTERVAL);

    return () => {
      if (etaIntervalRef.current) {
        clearInterval(etaIntervalRef.current);
      }
    };
  }, [driverLocation, targetLocation, enabled, fetchETA]);

  // Track seconds since last update + compute isLive
  useEffect(() => {
    if (!enabled) return;

    updateTimerRef.current = setInterval(() => {
      const ageMs = driverLocation ? (Date.now() - driverLocation.updatedAt) : Number.POSITIVE_INFINITY;
      const seconds = Number.isFinite(ageMs) ? Math.floor(ageMs / 1000) : 999;
      setLastUpdateSeconds(seconds);

      // LIVE = driver updated_at is < 8 seconds old
      const live = !!driverLocation && ageMs < LIVE_THRESHOLD_MS;
      setIsLive(live);
      
      if (!live && driverLocation) {
        setHasNoUpdatesError(true);
        // Auto-resubscribe once when we hit the threshold
        if (!isReconnecting && channelRef.current) {
          resubscribe();
        }
      } else if (live) {
        setHasNoUpdatesError(false);
      }
    }, 1000);

    return () => {
      if (updateTimerRef.current) {
        clearInterval(updateTimerRef.current);
      }
    };
  }, [enabled, driverLocation, isReconnecting, resubscribe]);

  // Resubscribe on window 'online' event
  useEffect(() => {
    if (!enabled || !rideId) return;

    const handleOnline = () => {
      console.log('[Tracking] Network online - resubscribing');
      resubscribe();
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [enabled, rideId, resubscribe]);

  // Resubscribe on visibility change (tab becomes visible)
  useEffect(() => {
    if (!enabled || !rideId) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[Tracking] Tab visible - resubscribing');
        resubscribe();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [enabled, rideId, resubscribe]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (etaIntervalRef.current) {
        clearInterval(etaIntervalRef.current);
      }
      if (updateTimerRef.current) {
        clearInterval(updateTimerRef.current);
      }
      if (resubscribeTimeoutRef.current) {
        clearTimeout(resubscribeTimeoutRef.current);
      }
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, []);

  // Manual recenter function
  const recenter = useCallback(() => {
    return driverLocation;
  }, [driverLocation]);

  return {
    driverLocation,
    eta,
    isConnected,
    lastUpdateSeconds,
    dataSource,
    hasNoUpdatesError,
    isReconnecting,
    isLive,
    waitingForDriver,
    recenter,
    resubscribe,
  };
}
