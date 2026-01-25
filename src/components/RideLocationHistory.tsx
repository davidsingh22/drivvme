import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { History, MapPin, Gauge, Target } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { ScrollArea } from '@/components/ui/scroll-area';

interface LocationRecord {
  id: string;
  lat: number;
  lng: number;
  speed: number | null;
  accuracy: number | null;
  created_at: string;
}

interface RideLocationHistoryProps {
  rideId: string | null;
  enabled: boolean;
}

export function RideLocationHistory({ rideId, enabled }: RideLocationHistoryProps) {
  const [locations, setLocations] = useState<LocationRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Fetch initial location history
  useEffect(() => {
    if (!rideId || !enabled) {
      setLocations([]);
      return;
    }

    const fetchLocations = async () => {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('ride_locations')
        .select('id, lat, lng, speed, accuracy, created_at')
        .eq('ride_id', rideId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (!error && data) {
        setLocations(data);
      }
      setIsLoading(false);
    };

    fetchLocations();
  }, [rideId, enabled]);

  // Subscribe to realtime updates for this ride
  useEffect(() => {
    if (!rideId || !enabled) return;

    const channel = supabase
      .channel(`ride-locations-${rideId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'ride_locations',
          filter: `ride_id=eq.${rideId}`,
        },
        (payload) => {
          const newLocation = payload.new as LocationRecord;
          setLocations((prev) => {
            // Add to front, keep max 50
            const updated = [newLocation, ...prev].slice(0, 50);
            return updated;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [rideId, enabled]);

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-US', { 
      hour12: false, 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit' 
    });
  };

  const formatCoord = (n: number) => n.toFixed(6);
  
  const formatSpeed = (mps: number | null) => {
    if (mps == null) return '--';
    return `${(mps * 3.6).toFixed(1)}`;
  };

  const formatAccuracy = (m: number | null) => {
    if (m == null) return '--';
    return `±${m.toFixed(0)}m`;
  };

  if (!rideId || !enabled) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-lg border border-border bg-card p-3"
    >
      <div className="flex items-center gap-2 mb-3">
        <History className="w-4 h-4 text-primary" />
        <span className="font-semibold text-sm text-foreground">
          Location History ({locations.length})
        </span>
      </div>

      {isLoading ? (
        <div className="text-center py-4 text-muted-foreground text-sm">
          Loading...
        </div>
      ) : locations.length === 0 ? (
        <div className="text-center py-4 text-muted-foreground text-sm">
          No location updates yet
        </div>
      ) : (
        <ScrollArea className="h-48">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="text-muted-foreground border-b border-border">
                <th className="text-left py-1 px-1">Time</th>
                <th className="text-left py-1 px-1">Lat</th>
                <th className="text-left py-1 px-1">Lng</th>
                <th className="text-right py-1 px-1">Speed</th>
                <th className="text-right py-1 px-1">Acc</th>
              </tr>
            </thead>
            <tbody>
              {locations.map((loc, idx) => (
                <motion.tr
                  key={loc.id}
                  initial={idx === 0 ? { backgroundColor: 'rgba(34, 197, 94, 0.2)' } : {}}
                  animate={{ backgroundColor: 'transparent' }}
                  transition={{ duration: 1 }}
                  className="border-b border-border/50 hover:bg-muted/50"
                >
                  <td className="py-1 px-1 text-foreground">{formatTime(loc.created_at)}</td>
                  <td className="py-1 px-1 text-foreground">{formatCoord(loc.lat)}</td>
                  <td className="py-1 px-1 text-foreground">{formatCoord(loc.lng)}</td>
                  <td className="py-1 px-1 text-right text-foreground">{formatSpeed(loc.speed)}</td>
                  <td className="py-1 px-1 text-right text-muted-foreground">{formatAccuracy(loc.accuracy)}</td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </ScrollArea>
      )}
    </motion.div>
  );
}
