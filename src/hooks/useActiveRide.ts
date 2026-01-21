import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Database } from '@/integrations/supabase/types';

type Ride = Database['public']['Tables']['rides']['Row'];

const getActiveRideKey = (userId: string) => `drivvme_active_ride:${userId}`;

interface ActiveRideState {
  rideId: string;
  status: string;
  driverId: string | null;
  pickupAddress: string;
  dropoffAddress: string;
  lastUpdated: number;
}

export function useActiveRide(userId: string | undefined) {
  const [activeRide, setActiveRide] = useState<Ride | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Persist ride to localStorage (user-specific key)
  const persistRide = useCallback((ride: Ride | null) => {
    if (!userId) return;
    
    if (!ride || ['completed', 'cancelled'].includes(ride.status)) {
      localStorage.removeItem(getActiveRideKey(userId));
      return;
    }
    
    const state: ActiveRideState = {
      rideId: ride.id,
      status: ride.status,
      driverId: ride.driver_id,
      pickupAddress: ride.pickup_address,
      dropoffAddress: ride.dropoff_address,
      lastUpdated: Date.now(),
    };
    localStorage.setItem(getActiveRideKey(userId), JSON.stringify(state));
  }, [userId]);

  // Load persisted ride on mount
  useEffect(() => {
    if (!userId) {
      setIsLoading(false);
      return;
    }

    const loadActiveRide = async () => {
      setIsLoading(true);
      
      try {
        // First check localStorage for cached ride (user-specific)
        const cached = localStorage.getItem(getActiveRideKey(userId));
        let cachedState: ActiveRideState | null = null;
        
        if (cached) {
          try {
            cachedState = JSON.parse(cached);
          } catch {
            localStorage.removeItem(getActiveRideKey(userId));
          }
        }

        // Always fetch fresh from DB to ensure accuracy
        const { data: rides, error } = await supabase
          .from('rides')
          .select('*')
          .eq('rider_id', userId)
          .not('status', 'in', '("completed","cancelled")')
          .order('created_at', { ascending: false })
          .limit(1);

        if (error) {
          console.error('Error fetching active ride:', error);
          setIsLoading(false);
          return;
        }

        const ride = rides?.[0] || null;
        setActiveRide(ride);
        persistRide(ride);
      } catch (error) {
        console.error('Error loading active ride:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadActiveRide();
  }, [userId, persistRide]);

  // Update ride and persist
  const updateRide = useCallback((ride: Ride | null) => {
    setActiveRide(ride);
    persistRide(ride);
  }, [persistRide]);

  // Clear ride (on completion/cancel)
  const clearRide = useCallback(() => {
    setActiveRide(null);
    if (userId) {
      localStorage.removeItem(getActiveRideKey(userId));
    }
  }, [userId]);

  return {
    activeRide,
    isLoading,
    updateRide,
    clearRide,
  };
}
