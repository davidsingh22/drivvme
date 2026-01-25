import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import Navbar from '@/components/Navbar';

interface LocationRow {
  id: string;
  ride_id: string;
  driver_id: string;
  lat: number;
  lng: number;
  speed: number | null;
  accuracy: number | null;
  heading: number | null;
  created_at: string;
  updated_at: string;
}

type Status = 'none' | 'live' | 'stale';

const AdminRideLocations = () => {
  const [rideId, setRideId] = useState('');
  const [activeRideId, setActiveRideId] = useState<string | null>(null);
  const [locationRow, setLocationRow] = useState<LocationRow | null>(null);
  const [secondsSince, setSecondsSince] = useState<number | null>(null);
  const [status, setStatus] = useState<Status>('none');
  const [updateCount, setUpdateCount] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch initial row when rideId is set
  useEffect(() => {
    if (!activeRideId) {
      setLocationRow(null);
      setStatus('none');
      return;
    }

    const fetchRow = async () => {
      const { data, error } = await supabase
        .from('ride_locations')
        .select('*')
        .eq('ride_id', activeRideId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('Fetch error:', error);
        setStatus('none');
        return;
      }

      if (data) {
        setLocationRow(data as LocationRow);
        setStatus('live');
      } else {
        setLocationRow(null);
        setStatus('none');
      }
    };

    fetchRow();
  }, [activeRideId]);

  // Subscribe to realtime updates (INSERT + UPDATE)
  useEffect(() => {
    if (!activeRideId) return;

    console.log('[AdminRideLocations] Subscribing to ride_id:', activeRideId);

    const handlePayload = (payload: any) => {
      console.log('[AdminRideLocations] Realtime update:', payload);
      const row = payload.new as LocationRow;
      setLocationRow(row);
      setStatus('live');
      setUpdateCount(prev => prev + 1);
    };

    const channel = supabase
      .channel(`admin-ride-locations-${activeRideId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'ride_locations',
          filter: `ride_id=eq.${activeRideId}`,
        },
        handlePayload
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'ride_locations',
          filter: `ride_id=eq.${activeRideId}`,
        },
        handlePayload
      )
      .subscribe((status) => {
        console.log('[AdminRideLocations] Subscription status:', status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeRideId]);

  // Timer to track seconds since updated_at
  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    if (!locationRow) {
      setSecondsSince(null);
      return;
    }

    const calcSeconds = () => {
      const updatedAt = new Date(locationRow.updated_at).getTime();
      const now = Date.now();
      const seconds = Math.floor((now - updatedAt) / 1000);
      setSecondsSince(seconds);

      // Update status based on staleness
      if (seconds >= 10) {
        setStatus('stale');
      } else {
        setStatus('live');
      }
    };

    calcSeconds();
    timerRef.current = setInterval(calcSeconds, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [locationRow?.updated_at]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (rideId.trim()) {
      setActiveRideId(rideId.trim());
      setUpdateCount(0);
    }
  };

  const getStatusConfig = () => {
    switch (status) {
      case 'live':
        return {
          bg: 'bg-green-500',
          text: 'Receiving live driver GPS',
          textColor: 'text-green-500',
        };
      case 'stale':
        return {
          bg: 'bg-yellow-500',
          text: 'No updates in 10s+',
          textColor: 'text-yellow-500',
        };
      case 'none':
      default:
        return {
          bg: 'bg-red-500',
          text: 'No rows found for this rideId',
          textColor: 'text-red-500',
        };
    }
  };

  const statusConfig = getStatusConfig();

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto px-4 pt-20 pb-8 max-w-3xl">
        <h1 className="text-2xl font-bold mb-6">Admin: Ride Locations (Realtime Debug)</h1>

        {/* Ride ID Input */}
        <form onSubmit={handleSubmit} className="mb-6">
          <div className="flex gap-3">
            <div className="flex-1">
              <Label htmlFor="rideId">Ride ID (UUID)</Label>
              <Input
                id="rideId"
                value={rideId}
                onChange={(e) => setRideId(e.target.value)}
                placeholder="Enter ride_id to monitor..."
                className="font-mono"
              />
            </div>
            <Button type="submit" className="mt-6">
              Monitor
            </Button>
          </div>
        </form>

        {activeRideId && (
          <>
            {/* Status Banner */}
            <div className={`${statusConfig.bg} rounded-lg p-4 mb-6`}>
              <div className="flex items-center justify-between">
                <span className="text-white font-bold text-lg">
                  {statusConfig.text}
                </span>
                <span className="text-white/80 text-sm">
                  Updates received: {updateCount}
                </span>
              </div>
            </div>

            {/* Seconds Since Update - BIG */}
            <Card className="p-6 mb-6 text-center">
              <p className="text-muted-foreground text-sm mb-2">Seconds since updated_at</p>
              <p className={`font-mono text-6xl font-bold ${statusConfig.textColor}`}>
                {secondsSince !== null ? secondsSince : '--'}
              </p>
              <p className="text-muted-foreground text-xs mt-2">
                {locationRow?.updated_at 
                  ? new Date(locationRow.updated_at).toLocaleTimeString()
                  : 'No data'}
              </p>
            </Card>

            {/* Location Data Table */}
            <Card className="overflow-hidden">
              <div className="p-4 border-b border-border bg-muted/50">
                <h2 className="font-semibold">Latest ride_locations row</h2>
                <p className="text-xs text-muted-foreground font-mono">
                  ride_id: {activeRideId}
                </p>
              </div>

              {locationRow ? (
                <div className="divide-y divide-border">
                  <Row label="ride_id" value={locationRow.ride_id} mono />
                  <Row label="driver_id" value={locationRow.driver_id} mono />
                  <Row label="lat" value={locationRow.lat.toFixed(6)} />
                  <Row label="lng" value={locationRow.lng.toFixed(6)} />
                  <Row label="speed" value={locationRow.speed?.toFixed(2) ?? 'null'} />
                  <Row label="accuracy" value={locationRow.accuracy?.toFixed(1) ?? 'null'} />
                  <Row label="heading" value={locationRow.heading?.toFixed(1) ?? 'null'} />
                  <Row label="created_at" value={locationRow.created_at} />
                  <Row label="updated_at" value={locationRow.updated_at} highlight />
                </div>
              ) : (
                <div className="p-8 text-center text-muted-foreground">
                  No rows found for this ride_id
                </div>
              )}
            </Card>
          </>
        )}

        {!activeRideId && (
          <Card className="p-8 text-center text-muted-foreground">
            Enter a ride_id above to start monitoring realtime location updates.
          </Card>
        )}
      </div>
    </div>
  );
};

// Helper row component
const Row = ({ label, value, mono, highlight }: { 
  label: string; 
  value: string; 
  mono?: boolean;
  highlight?: boolean;
}) => (
  <div className={`flex justify-between px-4 py-3 ${highlight ? 'bg-primary/5' : ''}`}>
    <span className="text-muted-foreground text-sm">{label}</span>
    <span className={`text-sm font-medium ${mono ? 'font-mono text-xs' : ''}`}>
      {value}
    </span>
  </div>
);

export default AdminRideLocations;
