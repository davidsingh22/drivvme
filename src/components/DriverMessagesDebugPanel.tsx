import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';

interface DebugState {
  panelMounted: boolean;
  currentUserId: string | null;
  currentPath: string;
  // Strategy A: driver_id == auth.uid()
  strategyACount: number;
  strategyAFirstRide: { id: string; status: string } | null;
  strategyAError: string | null;
  // Strategy B: driver_id == driverProfile.id
  strategyBCount: number;
  strategyBFirstRide: { id: string; status: string } | null;
  strategyBError: string | null;
  driverProfileId: string | null;
  // Messages test
  messagesCount: number;
  messagesError: string | null;
  // Loading state
  isLoading: boolean;
}

export default function DriverMessagesDebugPanel() {
  const [debug, setDebug] = useState<DebugState>({
    panelMounted: true,
    currentUserId: null,
    currentPath: typeof window !== 'undefined' ? window.location.pathname : '',
    strategyACount: 0,
    strategyAFirstRide: null,
    strategyAError: null,
    strategyBCount: 0,
    strategyBFirstRide: null,
    strategyBError: null,
    driverProfileId: null,
    messagesCount: 0,
    messagesError: null,
    isLoading: true,
  });

  const runDiagnostics = async () => {
    setDebug(prev => ({ ...prev, isLoading: true }));

    try {
      // 1. Get current user
      const { data: userData, error: userError } = await supabase.auth.getUser();
      const userId = userData?.user?.id ?? null;

      if (userError) {
        console.error('[DebugPanel] Auth error:', userError);
      }

      // 2. Strategy A: Query rides where driver_id == userId
      let strategyACount = 0;
      let strategyAFirstRide: { id: string; status: string } | null = null;
      let strategyAError: string | null = null;

      if (userId) {
        const { data: ridesA, error: errA } = await supabase
          .from('rides')
          .select('id, status')
          .eq('driver_id', userId)
          .in('status', ['driver_assigned', 'driver_en_route', 'arrived', 'in_progress'])
          .order('created_at', { ascending: false })
          .limit(5);

        if (errA) {
          strategyAError = errA.message || JSON.stringify(errA);
        } else if (ridesA) {
          strategyACount = ridesA.length;
          strategyAFirstRide = ridesA[0] ? { id: ridesA[0].id, status: ridesA[0].status } : null;
        }
      }

      // 3. Get driver_profile.id for Strategy B
      let driverProfileId: string | null = null;
      if (userId) {
        const { data: profile } = await supabase
          .from('driver_profiles')
          .select('id')
          .eq('user_id', userId)
          .maybeSingle();
        
        driverProfileId = profile?.id ?? null;
      }

      // 4. Strategy B: Query rides where driver_id == driverProfile.id
      let strategyBCount = 0;
      let strategyBFirstRide: { id: string; status: string } | null = null;
      let strategyBError: string | null = null;

      if (driverProfileId) {
        const { data: ridesB, error: errB } = await supabase
          .from('rides')
          .select('id, status')
          .eq('driver_id', driverProfileId)
          .in('status', ['driver_assigned', 'driver_en_route', 'arrived', 'in_progress'])
          .order('created_at', { ascending: false })
          .limit(5);

        if (errB) {
          strategyBError = errB.message || JSON.stringify(errB);
        } else if (ridesB) {
          strategyBCount = ridesB.length;
          strategyBFirstRide = ridesB[0] ? { id: ridesB[0].id, status: ridesB[0].status } : null;
        }
      } else {
        strategyBError = 'No driver_profiles.id found for this user';
      }

      // 5. Messages read test
      let messagesCount = 0;
      let messagesError: string | null = null;

      const { data: msgs, error: msgErr } = await supabase
        .from('ride_messages')
        .select('*')
        .limit(5);

      if (msgErr) {
        messagesError = msgErr.message || JSON.stringify(msgErr);
      } else {
        messagesCount = msgs?.length ?? 0;
      }

      // Update state
      setDebug({
        panelMounted: true,
        currentUserId: userId,
        currentPath: window.location.pathname,
        strategyACount,
        strategyAFirstRide,
        strategyAError,
        strategyBCount,
        strategyBFirstRide,
        strategyBError,
        driverProfileId,
        messagesCount,
        messagesError,
        isLoading: false,
      });

    } catch (err: any) {
      console.error('[DebugPanel] Unexpected error:', err);
      setDebug(prev => ({
        ...prev,
        isLoading: false,
        messagesError: err?.message || 'Unexpected error',
      }));
    }
  };

  useEffect(() => {
    runDiagnostics();
  }, []);

  const hasAnyError = debug.strategyAError || debug.strategyBError || debug.messagesError;

  return (
    <Card className="p-4 mb-4 border-2 border-dashed border-yellow-500 bg-yellow-50 dark:bg-yellow-950/30">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-lg text-yellow-800 dark:text-yellow-200">
          🔍 DRIVER MESSAGES DEBUG PANEL
        </h3>
        <Button
          size="sm"
          variant="outline"
          onClick={runDiagnostics}
          disabled={debug.isLoading}
        >
          <RefreshCw className={`h-4 w-4 mr-1 ${debug.isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Panel Mounted Status */}
      <div className="text-green-600 font-bold mb-2">
        ✅ PANEL MOUNTED
      </div>

      {/* Basic Info */}
      <div className="grid grid-cols-1 gap-1 text-sm font-mono mb-4">
        <div>
          <span className="text-muted-foreground">currentUserId:</span>{' '}
          <span className="font-bold">{debug.currentUserId || 'NULL'}</span>
        </div>
        <div>
          <span className="text-muted-foreground">currentPath:</span>{' '}
          <span className="font-bold">{debug.currentPath}</span>
        </div>
        <div>
          <span className="text-muted-foreground">driverProfile.id:</span>{' '}
          <span className="font-bold">{debug.driverProfileId || 'NULL'}</span>
        </div>
      </div>

      {/* Strategy A */}
      <div className="mb-3 p-2 rounded bg-background border">
        <div className="font-semibold text-sm mb-1">
          Strategy A: rides.driver_id = auth.uid()
        </div>
        <div className="text-sm font-mono">
          <span className="text-muted-foreground">count:</span>{' '}
          <span className={debug.strategyACount > 0 ? 'text-green-600 font-bold' : ''}>
            {debug.strategyACount}
          </span>
        </div>
        {debug.strategyAFirstRide && (
          <div className="text-sm font-mono">
            <span className="text-muted-foreground">first ride:</span>{' '}
            {debug.strategyAFirstRide.id.slice(0, 8)}... [{debug.strategyAFirstRide.status}]
          </div>
        )}
        {debug.strategyAError && (
          <div className="text-red-600 font-bold text-sm mt-1 p-1 bg-red-100 dark:bg-red-900/30 rounded">
            ❌ ERROR: {debug.strategyAError}
          </div>
        )}
      </div>

      {/* Strategy B */}
      <div className="mb-3 p-2 rounded bg-background border">
        <div className="font-semibold text-sm mb-1">
          Strategy B: rides.driver_id = driver_profiles.id
        </div>
        <div className="text-sm font-mono">
          <span className="text-muted-foreground">count:</span>{' '}
          <span className={debug.strategyBCount > 0 ? 'text-green-600 font-bold' : ''}>
            {debug.strategyBCount}
          </span>
        </div>
        {debug.strategyBFirstRide && (
          <div className="text-sm font-mono">
            <span className="text-muted-foreground">first ride:</span>{' '}
            {debug.strategyBFirstRide.id.slice(0, 8)}... [{debug.strategyBFirstRide.status}]
          </div>
        )}
        {debug.strategyBError && (
          <div className="text-red-600 font-bold text-sm mt-1 p-1 bg-red-100 dark:bg-red-900/30 rounded">
            ❌ ERROR: {debug.strategyBError}
          </div>
        )}
      </div>

      {/* Messages Test */}
      <div className="mb-3 p-2 rounded bg-background border">
        <div className="font-semibold text-sm mb-1">
          Messages Read Test: ride_messages.select(*).limit(5)
        </div>
        <div className="text-sm font-mono">
          <span className="text-muted-foreground">messagesCount:</span>{' '}
          <span className={debug.messagesCount > 0 ? 'text-green-600 font-bold' : ''}>
            {debug.messagesCount}
          </span>
        </div>
        {debug.messagesError && (
          <div className="text-red-600 font-bold text-sm mt-1 p-1 bg-red-100 dark:bg-red-900/30 rounded">
            ❌ ERROR: {debug.messagesError}
          </div>
        )}
      </div>

      {/* Big Error Banner */}
      {hasAnyError && (
        <div className="mt-4 p-3 bg-red-600 text-white rounded-lg font-bold text-center">
          ⚠️ ERRORS DETECTED — CHECK ABOVE ⚠️
        </div>
      )}

      {/* Success Summary */}
      {!hasAnyError && !debug.isLoading && (
        <div className="mt-4 p-3 bg-green-600 text-white rounded-lg font-bold text-center">
          ✅ All diagnostics passed. Messaging should work if an active ride exists.
        </div>
      )}
    </Card>
  );
}
