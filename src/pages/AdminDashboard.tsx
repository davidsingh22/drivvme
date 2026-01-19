import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import Navbar from '@/components/Navbar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { 
  DollarSign, 
  RefreshCw, 
  Search, 
  AlertCircle,
  CheckCircle,
  XCircle,
  Clock,
  Loader2
} from 'lucide-react';
import { format } from 'date-fns';

interface Payment {
  id: string;
  ride_id: string;
  payer_id: string | null;
  amount: number;
  currency: string;
  status: 'pending' | 'succeeded' | 'failed' | 'refunded';
  payment_type: string;
  stripe_payment_intent_id: string | null;
  created_at: string;
  rides?: {
    pickup_address: string;
    dropoff_address: string;
    status: string;
    rider_id: string | null;
  };
  profiles?: {
    first_name: string | null;
    last_name: string | null;
    email: string | null;
  };
}

interface Stats {
  totalPayments: number;
  totalRevenue: number;
  pendingPayments: number;
  refundedAmount: number;
}

const AdminDashboard = () => {
  const { user, isLoading: authLoading, roles } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [payments, setPayments] = useState<Payment[]>([]);
  const [stats, setStats] = useState<Stats>({ totalPayments: 0, totalRevenue: 0, pendingPayments: 0, refundedAmount: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [refundDialog, setRefundDialog] = useState<{ open: boolean; payment: Payment | null }>({ open: false, payment: null });
  const [refundReason, setRefundReason] = useState('');
  const [isProcessingRefund, setIsProcessingRefund] = useState(false);

  const isAdmin = roles.includes('admin' as any);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/login');
    } else if (!authLoading && !isAdmin) {
      navigate('/');
      toast({
        title: 'Access Denied',
        description: 'You do not have admin privileges.',
        variant: 'destructive',
      });
    }
  }, [user, authLoading, isAdmin, navigate, toast]);

  useEffect(() => {
    if (user && isAdmin) {
      fetchPayments();
    }
  }, [user, isAdmin]);

  const fetchPayments = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('payments')
        .select(`
          *,
          rides (
            pickup_address,
            dropoff_address,
            status,
            rider_id
          )
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Fetch payer profiles separately
      const payerIds = [...new Set(data?.map(p => p.payer_id).filter(Boolean))];
      let profilesMap: Record<string, any> = {};
      
      if (payerIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, first_name, last_name, email')
          .in('user_id', payerIds);
        
        profiles?.forEach(p => {
          profilesMap[p.user_id] = p;
        });
      }

      const paymentsWithProfiles = data?.map(p => ({
        ...p,
        profiles: p.payer_id ? profilesMap[p.payer_id] : null
      })) || [];

      setPayments(paymentsWithProfiles);
      calculateStats(paymentsWithProfiles);
    } catch (error: any) {
      console.error('Error fetching payments:', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch payments',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const calculateStats = (paymentData: Payment[]) => {
    const stats = paymentData.reduce((acc, p) => ({
      totalPayments: acc.totalPayments + 1,
      totalRevenue: acc.totalRevenue + (p.status === 'succeeded' ? p.amount : 0),
      pendingPayments: acc.pendingPayments + (p.status === 'pending' ? 1 : 0),
      refundedAmount: acc.refundedAmount + (p.status === 'refunded' ? p.amount : 0),
    }), { totalPayments: 0, totalRevenue: 0, pendingPayments: 0, refundedAmount: 0 });
    
    setStats(stats);
  };

  const handleRefund = async () => {
    if (!refundDialog.payment) return;
    
    setIsProcessingRefund(true);
    try {
      const { data, error } = await supabase.functions.invoke('refund-payment', {
        body: { 
          paymentId: refundDialog.payment.id,
          reason: refundReason 
        }
      });

      if (error) throw error;

      toast({
        title: 'Refund Processed',
        description: `$${data.amount} ${data.currency} has been refunded.`,
      });

      setRefundDialog({ open: false, payment: null });
      setRefundReason('');
      fetchPayments();
    } catch (error: any) {
      console.error('Refund error:', error);
      toast({
        title: 'Refund Failed',
        description: error.message || 'Failed to process refund',
        variant: 'destructive',
      });
    } finally {
      setIsProcessingRefund(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'succeeded':
        return <Badge className="bg-green-500"><CheckCircle className="w-3 h-3 mr-1" /> Succeeded</Badge>;
      case 'pending':
        return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" /> Pending</Badge>;
      case 'failed':
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" /> Failed</Badge>;
      case 'refunded':
        return <Badge variant="outline"><RefreshCw className="w-3 h-3 mr-1" /> Refunded</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const filteredPayments = payments.filter(p => {
    const searchLower = searchTerm.toLowerCase();
    return (
      p.id.toLowerCase().includes(searchLower) ||
      p.profiles?.email?.toLowerCase().includes(searchLower) ||
      p.profiles?.first_name?.toLowerCase().includes(searchLower) ||
      p.profiles?.last_name?.toLowerCase().includes(searchLower) ||
      p.rides?.pickup_address?.toLowerCase().includes(searchLower) ||
      p.rides?.dropoff_address?.toLowerCase().includes(searchLower)
    );
  });

  if (authLoading || !isAdmin) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      <main className="container mx-auto px-4 py-8 pt-20">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">Admin Dashboard</h1>
          <p className="text-muted-foreground">Manage payments and refunds</p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Payments</CardDescription>
              <CardTitle className="text-2xl">{stats.totalPayments}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Revenue</CardDescription>
              <CardTitle className="text-2xl text-green-600">${stats.totalRevenue.toFixed(2)}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Pending Payments</CardDescription>
              <CardTitle className="text-2xl text-yellow-600">{stats.pendingPayments}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Refunded Amount</CardDescription>
              <CardTitle className="text-2xl text-red-600">${stats.refundedAmount.toFixed(2)}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        <Tabs defaultValue="all" className="space-y-4">
          <div className="flex flex-col sm:flex-row justify-between gap-4">
            <TabsList>
              <TabsTrigger value="all">All Payments</TabsTrigger>
              <TabsTrigger value="succeeded">Succeeded</TabsTrigger>
              <TabsTrigger value="pending">Pending</TabsTrigger>
              <TabsTrigger value="refunded">Refunded</TabsTrigger>
            </TabsList>
            
            <div className="flex gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                <Input
                  placeholder="Search payments..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 w-64"
                />
              </div>
              <Button variant="outline" onClick={fetchPayments} disabled={isLoading}>
                <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
          </div>

          {['all', 'succeeded', 'pending', 'refunded'].map((tab) => (
            <TabsContent key={tab} value={tab}>
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>Ride</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredPayments
                        .filter(p => tab === 'all' || p.status === tab)
                        .map((payment) => (
                          <TableRow key={payment.id}>
                            <TableCell className="whitespace-nowrap">
                              {format(new Date(payment.created_at), 'MMM d, yyyy HH:mm')}
                            </TableCell>
                            <TableCell>
                              <div>
                                <p className="font-medium">
                                  {payment.profiles?.first_name} {payment.profiles?.last_name}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                  {payment.profiles?.email || 'N/A'}
                                </p>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="max-w-xs">
                                <p className="text-sm truncate">{payment.rides?.pickup_address}</p>
                                <p className="text-sm text-muted-foreground truncate">→ {payment.rides?.dropoff_address}</p>
                              </div>
                            </TableCell>
                            <TableCell className="font-medium">
                              ${payment.amount.toFixed(2)} {payment.currency}
                            </TableCell>
                            <TableCell>
                              {getStatusBadge(payment.status)}
                            </TableCell>
                            <TableCell>
                              {payment.status === 'succeeded' && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setRefundDialog({ open: true, payment })}
                                >
                                  <RefreshCw className="w-4 h-4 mr-1" />
                                  Refund
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      {filteredPayments.filter(p => tab === 'all' || p.status === tab).length === 0 && (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                            <AlertCircle className="w-8 h-8 mx-auto mb-2" />
                            No payments found
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      </main>

      {/* Refund Dialog */}
      <Dialog open={refundDialog.open} onOpenChange={(open) => setRefundDialog({ open, payment: open ? refundDialog.payment : null })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Process Refund</DialogTitle>
            <DialogDescription>
              This will refund ${refundDialog.payment?.amount.toFixed(2)} {refundDialog.payment?.currency} to the customer.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="p-4 bg-muted rounded-lg">
              <p className="text-sm font-medium">Payment Details</p>
              <p className="text-sm text-muted-foreground">
                Customer: {refundDialog.payment?.profiles?.first_name} {refundDialog.payment?.profiles?.last_name}
              </p>
              <p className="text-sm text-muted-foreground">
                Amount: ${refundDialog.payment?.amount.toFixed(2)} {refundDialog.payment?.currency}
              </p>
            </div>
            
            <div>
              <label className="text-sm font-medium">Refund Reason (optional)</label>
              <Textarea
                placeholder="Enter reason for refund..."
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                className="mt-2"
              />
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefundDialog({ open: false, payment: null })}>
              Cancel
            </Button>
            <Button onClick={handleRefund} disabled={isProcessingRefund}>
              {isProcessingRefund && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Process Refund
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminDashboard;
