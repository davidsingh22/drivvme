import { useState, useEffect } from 'react';
import { Navigation } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import DriverNavigationMap from './DriverNavigationMap';

interface ActiveRide {
  id: string;
  status: string;
  pickup_lat: number;
  pickup_lng: number;
  pickup_address: string;
  dropoff_lat: number;
  dropoff_lng: number;
  dropoff_address: string;
}

export default function DriverFloatingGPSButton() {
  const { user } = useAuth();
  const { language } = useLanguage();
  const [activeRide, setActiveRide] = useState<ActiveRide | null>(null);
  const [showNavigation, setShowNavigation] = useState(false);
  const [driverLocation, setDriverLocation] = useState<{ lat: number; lng: number } | null>(null);

  // Fetch driver's active ride
  useEffect(() => {
    if (!user?.id) return;

    const fetchActiveRide = async () => {
      const { data } = await supabase
        .from('rides')
        .select('id, status, pickup_lat, pickup_lng, pickup_address, dropoff_lat, dropoff_lng, dropoff_address')
        .eq('driver_id', user.id)
        .in('status', ['driver_assigned', 'driver_en_route', 'arrived', 'in_progress'])
        .limit(1)
        .maybeSingle();

      setActiveRide(data);
    };

    fetchActiveRide();

    // Subscribe to ride changes
    const channel = supabase
      .channel('driver-floating-gps')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'rides',
          filter: `driver_id=eq.${user.id}`,
        },
        (payload) => {
          const ride = payload.new as ActiveRide;
          if (ride && ['driver_assigned', 'driver_en_route', 'arrived', 'in_progress'].includes(ride.status)) {
            setActiveRide(ride);
          } else {
            setActiveRide(null);
            setShowNavigation(false);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  // Get driver's current location
  useEffect(() => {
    if (!activeRide || !showNavigation) return;

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        setDriverLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      (error) => {
        console.error('GPS error:', error);
      },
      { enableHighAccuracy: true, maximumAge: 5000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [activeRide, showNavigation]);

  // Don't render if no active ride
  if (!activeRide) return null;

  const destination = activeRide.status === 'in_progress'
    ? { lat: activeRide.dropoff_lat, lng: activeRide.dropoff_lng, address: activeRide.dropoff_address }
    : { lat: activeRide.pickup_lat, lng: activeRide.pickup_lng, address: activeRide.pickup_address };

  const destinationType = activeRide.status === 'in_progress' ? 'dropoff' : 'pickup';

  return (
    <>
      {/* Floating GPS Button - Fixed at bottom right */}
      <Button
        onClick={() => setShowNavigation(true)}
        className="fixed bottom-24 right-4 z-50 h-16 w-16 rounded-full shadow-2xl bg-primary hover:bg-primary/90 animate-pulse"
        size="icon"
      >
        <Navigation className="h-8 w-8" />
      </Button>

      {/* Fullscreen Navigation Map */}
      {showNavigation && (
        <DriverNavigationMap
          driverLocation={driverLocation}
          destination={destination}
          destinationType={destinationType}
          onClose={() => setShowNavigation(false)}
        />
      )}
    </>
  );
}
