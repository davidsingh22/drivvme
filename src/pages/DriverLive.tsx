import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { MapPin, Gauge, Compass, Target, Clock, Wifi, WifiOff, Send, RefreshCw, CheckCircle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import Navbar from '@/components/Navbar';

interface GPSState {
  lat: number | null;
  lng: number | null;
  speed: number | null;
  heading: number | null;
  accuracy: number | null;
  timestamp: number | null;
  permissionStatus: 'prompt' | 'granted' | 'denied' | 'unknown';
  error: string | null;
  lastUpdateTime: number | null;
  secondsSinceUpdate: number;
}

interface LocationRecord {
  id: string;
  lat: number;
  lng: number;
  speed: number | null;
  accuracy: number | null;
  heading: number | null;
  created_at: string;
  ride_id: string;
}

const DriverLive = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [gpsState, setGpsState] = useState<GPSState>({
    lat: null,
    lng: null,
    speed: null,
    heading: null,
    accuracy: null,
    timestamp: null,
    permissionStatus: 'unknown',
    error: null,
    lastUpdateTime: null,
    secondsSinceUpdate: 0,
  });
  
  const [rideId, setRideId] = useState<string>('test-ride-' + Date.now());
  const [autoStream, setAutoStream] = useState(false);
  const [locationHistory, setLocationHistory] = useState<LocationRecord[]>([]);
  const [writeCount, setWriteCount] = useState(0);
  const [errorCount, setErrorCount] = useState(0);
  
  const watchIdRef = useRef<number | null>(null);
  const autoStreamIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const secondsTimerRef = useRef<NodeJS.Timeout | null>(null);
  const latestPositionRef = useRef<{ lat: number; lng: number; speed: number | null; heading: number | null; accuracy: number | null } | null>(null);

  // Check permission status
  useEffect(() => {
    const checkPermission = async () => {
      if ('permissions' in navigator) {
        try {
          const result = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
          setGpsState(prev => ({ ...prev, permissionStatus: result.state as 'prompt' | 'granted' | 'denied' }));
          
          result.addEventListener('change', () => {
            setGpsState(prev => ({ ...prev, permissionStatus: result.state as 'prompt' | 'granted' | 'denied' }));
          });
        } catch {
          // Firefox doesn't support geolocation permission query
        }
      }
    };
    checkPermission();
  }, []);

  // Start GPS watch immediately
  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setGpsState(prev => ({ ...prev, error: 'Geolocation not supported' }));
      return;
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const now = Date.now();
        const posData = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          speed: position.coords.speed,
          heading: position.coords.heading,
          accuracy: position.coords.accuracy,
        };
        
        latestPositionRef.current = posData;
        
        setGpsState(prev => ({
          ...prev,
          ...posData,
          timestamp: position.timestamp,
          permissionStatus: 'granted',
          error: null,
          lastUpdateTime: now,
          secondsSinceUpdate: 0,
        }));
      },
      (error) => {
        setGpsState(prev => ({
          ...prev,
          error: `${error.code}: ${error.message}`,
          permissionStatus: error.code === 1 ? 'denied' : prev.permissionStatus,
        }));
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 15000,
      }
    );

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  // Track seconds since last update
  useEffect(() => {
    secondsTimerRef.current = setInterval(() => {
      setGpsState(prev => {
        if (!prev.lastUpdateTime) return prev;
        const seconds = Math.floor((Date.now() - prev.lastUpdateTime) / 1000);
        return { ...prev, secondsSinceUpdate: seconds };
      });
    }, 1000);

    return () => {
      if (secondsTimerRef.current) {
        clearInterval(secondsTimerRef.current);
      }
    };
  }, []);

  // Write location to backend
  const writeToBackend = useCallback(async (manual = false) => {
    if (!user?.id) {
      toast({
        title: 'Not authenticated',
        description: 'Please log in first',
        variant: 'destructive',
      });
      return;
    }

    const pos = latestPositionRef.current;
    if (!pos) {
      toast({
        title: 'No GPS data',
        description: 'Waiting for GPS fix...',
        variant: 'destructive',
      });
      return;
    }

    try {
      const { data, error } = await supabase
        .from('ride_locations')
        .insert({
          ride_id: rideId,
          driver_id: user.id,
          lat: pos.lat,
          lng: pos.lng,
          speed: pos.speed,
          heading: pos.heading,
          accuracy: pos.accuracy,
        })
        .select()
        .single();

      if (error) {
        setErrorCount(prev => prev + 1);
        toast({
          title: '❌ Write failed',
          description: error.message,
          variant: 'destructive',
        });
      } else {
        setWriteCount(prev => prev + 1);
        if (manual) {
          toast({
            title: '✅ Saved location',
            description: `Row ${data.id.slice(0, 8)}... written`,
          });
        }
        // Add to local history
        setLocationHistory(prev => [data, ...prev].slice(0, 20));
      }
    } catch (err) {
      setErrorCount(prev => prev + 1);
      toast({
        title: '❌ Network error',
        description: String(err),
        variant: 'destructive',
      });
    }
  }, [user?.id, rideId, toast]);

  // Auto-stream toggle
  useEffect(() => {
    if (autoStream && user?.id) {
      autoStreamIntervalRef.current = setInterval(() => {
        writeToBackend(false);
      }, 3000);
      
      toast({
        title: '🔄 Auto-streaming started',
        description: 'Writing every 3 seconds',
      });
    } else {
      if (autoStreamIntervalRef.current) {
        clearInterval(autoStreamIntervalRef.current);
        autoStreamIntervalRef.current = null;
      }
    }

    return () => {
      if (autoStreamIntervalRef.current) {
        clearInterval(autoStreamIntervalRef.current);
      }
    };
  }, [autoStream, user?.id, writeToBackend]);

  // Fetch location history
  const fetchHistory = useCallback(async () => {
    if (!user?.id) return;

    const { data, error } = await supabase
      .from('ride_locations')
      .select('id, lat, lng, speed, accuracy, heading, created_at, ride_id')
      .eq('driver_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20);

    if (!error && data) {
      setLocationHistory(data);
    }
  }, [user?.id]);

  // Initial fetch
  useEffect(() => {
    if (user?.id) {
      fetchHistory();
    }
  }, [user?.id, fetchHistory]);

  const formatCoord = (n: number | null) => n != null ? n.toFixed(6) : '--';
  const formatSpeed = (mps: number | null) => mps != null ? `${(mps * 3.6).toFixed(1)} km/h` : '--';
  const formatHeading = (deg: number | null) => deg != null ? `${deg.toFixed(0)}°` : '--';
  const formatAccuracy = (m: number | null) => m != null ? `±${m.toFixed(0)}m` : '--';
  const formatTime = (ts: number | null) => ts != null ? new Date(ts).toLocaleTimeString() : '--';

  const getPermissionBadge = () => {
    switch (gpsState.permissionStatus) {
      case 'granted':
        return <span className="inline-flex items-center gap-1 px-3 py-1 text-sm font-bold bg-primary/20 text-primary rounded-full"><Wifi className="w-4 h-4" />GRANTED</span>;
      case 'denied':
        return <span className="inline-flex items-center gap-1 px-3 py-1 text-sm font-bold bg-destructive/20 text-destructive rounded-full"><WifiOff className="w-4 h-4" />DENIED</span>;
      case 'prompt':
        return <span className="inline-flex items-center gap-1 px-3 py-1 text-sm font-bold bg-secondary text-secondary-foreground rounded-full">PROMPT</span>;
      default:
        return <span className="inline-flex items-center gap-1 px-3 py-1 text-sm font-bold bg-muted text-muted-foreground rounded-full">UNKNOWN</span>;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      <div className="pt-20 pb-8 container mx-auto px-4 max-w-2xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          {/* Header */}
          <div className="text-center">
            <h1 className="text-3xl font-bold text-foreground mb-2">🛰️ Driver GPS Debug</h1>
            <p className="text-muted-foreground">Testing GPS capture & backend writes</p>
          </div>

          {/* Permission Status */}
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">Permission Status</h2>
              {getPermissionBadge()}
            </div>
            {gpsState.error && (
              <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-destructive text-sm">
                ⚠️ {gpsState.error}
              </div>
            )}
          </Card>

          {/* Live GPS Data */}
          <Card className="p-6">
            <h2 className="text-xl font-semibold mb-4">📍 Live GPS Data</h2>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <MapPin className="w-4 h-4" />
                  Latitude
                </div>
                <div className="text-2xl font-mono font-bold text-foreground">
                  {formatCoord(gpsState.lat)}
                </div>
              </div>
              
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <MapPin className="w-4 h-4" />
                  Longitude
                </div>
                <div className="text-2xl font-mono font-bold text-foreground">
                  {formatCoord(gpsState.lng)}
                </div>
              </div>
              
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Gauge className="w-4 h-4" />
                  Speed
                </div>
                <div className="text-2xl font-mono font-bold text-foreground">
                  {formatSpeed(gpsState.speed)}
                </div>
              </div>
              
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Compass className="w-4 h-4" />
                  Heading
                </div>
                <div className="text-2xl font-mono font-bold text-foreground">
                  {formatHeading(gpsState.heading)}
                </div>
              </div>
              
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Target className="w-4 h-4" />
                  Accuracy
                </div>
                <div className="text-2xl font-mono font-bold text-foreground">
                  {formatAccuracy(gpsState.accuracy)}
                </div>
              </div>
              
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Clock className="w-4 h-4" />
                  Timestamp
                </div>
                <div className="text-2xl font-mono font-bold text-foreground">
                  {formatTime(gpsState.timestamp)}
                </div>
              </div>
            </div>

            {/* Last Update Timer */}
            <div className="mt-4 p-4 bg-muted rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Last GPS update:</span>
                <span className={`text-2xl font-mono font-bold ${gpsState.secondsSinceUpdate > 5 ? 'text-destructive' : 'text-primary'}`}>
                  {gpsState.secondsSinceUpdate}s ago
                </span>
              </div>
            </div>
          </Card>

          {/* Backend Controls */}
          <Card className="p-6">
            <h2 className="text-xl font-semibold mb-4">📡 Backend Controls</h2>
            
            {/* Ride ID */}
            <div className="mb-4">
              <Label htmlFor="rideId" className="text-sm text-muted-foreground">Ride ID (for testing)</Label>
              <Input
                id="rideId"
                value={rideId}
                onChange={(e) => setRideId(e.target.value)}
                placeholder="Enter ride ID"
                className="mt-1 font-mono"
              />
            </div>

            {/* Driver ID */}
            <div className="mb-4 p-3 bg-muted rounded-lg">
              <span className="text-sm text-muted-foreground">Driver ID: </span>
              <span className="font-mono text-sm text-foreground">{user?.id || 'Not logged in'}</span>
            </div>

            {/* Auto Stream Toggle */}
            <div className="flex items-center justify-between mb-4 p-4 border border-border rounded-lg">
              <div className="flex items-center gap-2">
                <RefreshCw className={`w-5 h-5 ${autoStream ? 'animate-spin text-primary' : 'text-muted-foreground'}`} />
                <div>
                  <div className="font-medium">Auto-stream (every 3s)</div>
                  <div className="text-sm text-muted-foreground">
                    Writes: {writeCount} | Errors: {errorCount}
                  </div>
                </div>
              </div>
              <Switch
                checked={autoStream}
                onCheckedChange={setAutoStream}
                disabled={!user?.id}
              />
            </div>

            {/* Manual Ping Button */}
            <Button
              onClick={() => writeToBackend(true)}
              disabled={!user?.id || !latestPositionRef.current}
              className="w-full"
              size="lg"
            >
              <Send className="w-5 h-5 mr-2" />
              Send Ping to Backend
            </Button>
          </Card>

          {/* Location History */}
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">📋 Location History (Last 20)</h2>
              <Button variant="outline" size="sm" onClick={fetchHistory}>
                <RefreshCw className="w-4 h-4 mr-1" />
                Refresh
              </Button>
            </div>
            
            {locationHistory.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No location records yet. Send a ping to create one.
              </div>
            ) : (
              <ScrollArea className="h-64">
                <table className="w-full text-xs font-mono">
                  <thead>
                    <tr className="text-muted-foreground border-b border-border">
                      <th className="text-left py-2 px-1">Time</th>
                      <th className="text-left py-2 px-1">Lat</th>
                      <th className="text-left py-2 px-1">Lng</th>
                      <th className="text-right py-2 px-1">Spd</th>
                      <th className="text-right py-2 px-1">Acc</th>
                    </tr>
                  </thead>
                  <tbody>
                    {locationHistory.map((loc, idx) => (
                      <motion.tr
                        key={loc.id}
                        initial={idx === 0 ? { backgroundColor: 'hsl(var(--primary) / 0.2)' } : {}}
                        animate={{ backgroundColor: 'transparent' }}
                        transition={{ duration: 1 }}
                        className="border-b border-border/50 hover:bg-muted/50"
                      >
                        <td className="py-2 px-1 text-foreground">
                          {new Date(loc.created_at).toLocaleTimeString('en-US', { 
                            hour12: false, 
                            hour: '2-digit', 
                            minute: '2-digit', 
                            second: '2-digit' 
                          })}
                        </td>
                        <td className="py-2 px-1 text-foreground">{loc.lat.toFixed(5)}</td>
                        <td className="py-2 px-1 text-foreground">{loc.lng.toFixed(5)}</td>
                        <td className="py-2 px-1 text-right text-foreground">
                          {loc.speed != null ? (loc.speed * 3.6).toFixed(0) : '--'}
                        </td>
                        <td className="py-2 px-1 text-right text-muted-foreground">
                          {loc.accuracy != null ? `±${loc.accuracy.toFixed(0)}` : '--'}
                        </td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            )}
          </Card>

          {/* Status Summary */}
          <Card className="p-4 bg-muted">
            <div className="flex items-center justify-around text-center">
              <div>
                <div className="text-2xl font-bold text-primary">{writeCount}</div>
                <div className="text-xs text-muted-foreground">Successful Writes</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-destructive">{errorCount}</div>
                <div className="text-xs text-muted-foreground">Errors</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-foreground">{locationHistory.length}</div>
                <div className="text-xs text-muted-foreground">DB Records</div>
              </div>
            </div>
          </Card>
        </motion.div>
      </div>
    </div>
  );
};

export default DriverLive;
