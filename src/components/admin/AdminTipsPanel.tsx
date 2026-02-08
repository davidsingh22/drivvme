import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DollarSign, Loader2, CheckCircle, CreditCard, RefreshCw, Bell } from 'lucide-react';
import { format } from 'date-fns';

interface PendingTip {
  id: string;
  rider_id: string | null;
  driver_id: string | null;
  tip_amount: number;
  tip_status: string;
  pickup_address: string;
  dropoff_address: string;
  dropoff_at: string | null;
  actual_fare: number | null;
  estimated_fare: number;
  rider_name: string;
  rider_email: string;
  driver_name: string;
}

export function AdminTipsPanel() {
  const { toast } = useToast();
  const [tips, setTips] = useState<PendingTip[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [chargingId, setChargingId] = useState<string | null>(null);
  const [notifyingId, setNotifyingId] = useState<string | null>(null);

  useEffect(() => {
    fetchTips();

    // Realtime subscription for new tips
    const channel = supabase
      .channel('admin-tips-realtime')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'rides',
        filter: 'tip_status=eq.pending',
      }, () => {
        fetchTips();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const fetchTips = async () => {
    setIsLoading(true);
    try {
      const { data: ridesData, error } = await supabase
        .from('rides')
        .select('id, rider_id, driver_id, tip_amount, tip_status, pickup_address, dropoff_address, dropoff_at, actual_fare, estimated_fare')
        .not('tip_amount', 'is', null)
        .gt('tip_amount', 0)
        .order('updated_at', { ascending: false });

      if (error) throw error;

      if (!ridesData || ridesData.length === 0) {
        setTips([]);
        setIsLoading(false);
        return;
      }

      // Fetch profiles for riders and drivers
      const userIds = [
        ...new Set([
          ...ridesData.map(r => r.rider_id).filter(Boolean),
          ...ridesData.map(r => r.driver_id).filter(Boolean),
        ])
      ] as string[];

      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, first_name, last_name, email')
        .in('user_id', userIds);

      const profilesMap: Record<string, any> = {};
      profiles?.forEach(p => { profilesMap[p.user_id] = p; });

      const tipsWithNames: PendingTip[] = ridesData.map(r => {
        const riderProfile = r.rider_id ? profilesMap[r.rider_id] : null;
        const driverProfile = r.driver_id ? profilesMap[r.driver_id] : null;
        return {
          ...r,
          tip_amount: Number(r.tip_amount),
          tip_status: (r as any).tip_status || 'pending',
          rider_name: riderProfile 
            ? `${riderProfile.first_name || ''} ${riderProfile.last_name || ''}`.trim() || 'Unknown'
            : 'Unknown',
          rider_email: riderProfile?.email || 'N/A',
          driver_name: driverProfile 
            ? `${driverProfile.first_name || ''} ${driverProfile.last_name || ''}`.trim() || 'Unknown'
            : 'Unknown',
        };
      });

      setTips(tipsWithNames);
    } catch (error) {
      console.error('Error fetching tips:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const chargeTip = async (tip: PendingTip) => {
    setChargingId(tip.id);
    try {
      const { data, error } = await supabase.functions.invoke('charge-tip', {
        body: { rideId: tip.id, tipAmount: tip.tip_amount, adminCharge: true },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast({
        title: '✅ Tip Charged!',
        description: `$${tip.tip_amount.toFixed(2)} charged to ${tip.rider_name}'s card`,
      });

      fetchTips();
    } catch (error: any) {
      console.error('Error charging tip:', error);
      toast({
        title: 'Failed to charge tip',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setChargingId(null);
    }
  };

  const notifyDriver = async (tip: PendingTip) => {
    if (!tip.driver_id) return;
    setNotifyingId(tip.id);
    try {
      // Insert in-app notification
      await supabase.from('notifications').insert({
        user_id: tip.driver_id,
        ride_id: tip.id,
        type: 'tip_charged',
        title: 'You received a tip! 🎉',
        message: `You received a $${tip.tip_amount.toFixed(2)} tip from ${tip.rider_name}`,
      });

      // Send push notification via FCM
      await supabase.functions.invoke('send-fcm-notification', {
        body: {
          userId: tip.driver_id,
          title: 'You received a tip! 🎉',
          body: `You received a $${tip.tip_amount.toFixed(2)} tip from ${tip.rider_name}`,
          data: { type: 'tip_charged', rideId: tip.id },
        },
      });

      toast({
        title: '✅ Driver Notified',
        description: `${tip.driver_name} has been notified about their $${tip.tip_amount.toFixed(2)} tip`,
      });
    } catch (error: any) {
      console.error('Error notifying driver:', error);
      toast({
        title: 'Failed to notify driver',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setNotifyingId(null);
    }
  };

  const pendingTips = tips.filter(t => t.tip_status === 'pending');
  const chargedTips = tips.filter(t => t.tip_status === 'charged');

  return (
    <div className="space-y-6">
      {/* Pending Tips */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="w-5 h-5" />
            Pending Tips
            {pendingTips.length > 0 && (
              <Badge className="bg-warning text-warning-foreground ml-2">
                {pendingTips.length}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Tips submitted by riders awaiting your approval to charge
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Rider</TableHead>
                <TableHead>Driver</TableHead>
                <TableHead>Trip</TableHead>
                <TableHead>Fare</TableHead>
                <TableHead>Tip Amount</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pendingTips.map((tip) => (
                <TableRow key={tip.id}>
                  <TableCell className="whitespace-nowrap">
                    {tip.dropoff_at ? format(new Date(tip.dropoff_at), 'MMM d, HH:mm') : 'N/A'}
                  </TableCell>
                  <TableCell>
                    <div>
                      <p className="font-medium">{tip.rider_name}</p>
                      <p className="text-sm text-muted-foreground">{tip.rider_email}</p>
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">{tip.driver_name}</TableCell>
                  <TableCell>
                    <div className="max-w-xs">
                      <p className="text-sm truncate">{tip.pickup_address}</p>
                      <p className="text-sm text-muted-foreground truncate">→ {tip.dropoff_address}</p>
                    </div>
                  </TableCell>
                  <TableCell>${(tip.actual_fare || tip.estimated_fare).toFixed(2)}</TableCell>
                  <TableCell>
                    <span className="font-bold text-lg text-accent">${tip.tip_amount.toFixed(2)}</span>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      onClick={() => chargeTip(tip)}
                      disabled={chargingId === tip.id}
                      className="gap-1"
                    >
                      {chargingId === tip.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <CreditCard className="w-4 h-4" />
                      )}
                      Charge
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {pendingTips.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    <DollarSign className="w-8 h-8 mx-auto mb-2" />
                    No pending tips
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Charged Tips History */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-success" />
                Charged Tips
              </CardTitle>
              <CardDescription>Previously charged tips</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={fetchTips}>
              <RefreshCw className="w-4 h-4 mr-1" />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Rider</TableHead>
                <TableHead>Driver</TableHead>
                <TableHead>Tip Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Notify</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {chargedTips.map((tip) => (
                <TableRow key={tip.id}>
                  <TableCell className="whitespace-nowrap">
                    {tip.dropoff_at ? format(new Date(tip.dropoff_at), 'MMM d, HH:mm') : 'N/A'}
                  </TableCell>
                  <TableCell>{tip.rider_name}</TableCell>
                  <TableCell>{tip.driver_name}</TableCell>
                  <TableCell className="font-bold">${tip.tip_amount.toFixed(2)}</TableCell>
                  <TableCell>
                    <Badge className="bg-success text-success-foreground">Charged</Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => notifyDriver(tip)}
                      disabled={notifyingId === tip.id}
                      className="gap-1"
                    >
                      {notifyingId === tip.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Bell className="w-4 h-4" />
                      )}
                      Notify
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {chargedTips.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    No charged tips yet
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
