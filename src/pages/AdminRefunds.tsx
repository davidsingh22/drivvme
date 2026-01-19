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
import { Textarea } from '@/components/ui/textarea';
import { 
  RefreshCw, 
  Search, 
  CheckCircle,
  XCircle,
  Loader2,
  ArrowLeft,
  DollarSign,
  User,
  MapPin,
  Calendar
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
    phone_number: string | null;
  };
}

const AdminRefunds = () => {
  const { user, isLoading: authLoading, roles } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [payments, setPayments] = useState<Payment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);
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
        .eq('status', 'succeeded')
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Fetch payer profiles separately
      const payerIds = [...new Set(data?.map(p => p.payer_id).filter(Boolean))];
      let profilesMap: Record<string, any> = {};
      
      if (payerIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, first_name, last_name, email, phone_number')
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

  const handleRefund = async () => {
    if (!selectedPayment) return;
    
    setIsProcessingRefund(true);
    try {
      const { data, error } = await supabase.functions.invoke('refund-payment', {
        body: { 
          paymentId: selectedPayment.id,
          reason: refundReason 
        }
      });

      if (error) throw error;

      toast({
        title: 'Refund Successful! ✓',
        description: `$${data.amount} ${data.currency} has been refunded to ${selectedPayment.profiles?.first_name || 'the customer'}.`,
      });

      setSelectedPayment(null);
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

  const filteredPayments = payments.filter(p => {
    const searchLower = searchTerm.toLowerCase();
    return (
      p.id.toLowerCase().includes(searchLower) ||
      p.profiles?.email?.toLowerCase().includes(searchLower) ||
      p.profiles?.first_name?.toLowerCase().includes(searchLower) ||
      p.profiles?.last_name?.toLowerCase().includes(searchLower) ||
      p.profiles?.phone_number?.toLowerCase().includes(searchLower) ||
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
        {/* Header */}
        <div className="mb-8">
          <Button variant="ghost" onClick={() => navigate('/admin')} className="mb-4">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Dashboard
          </Button>
          <h1 className="text-3xl font-bold text-foreground">Issue Refunds</h1>
          <p className="text-muted-foreground">Search for a payment and issue a refund quickly</p>
        </div>

        <div className="grid lg:grid-cols-2 gap-8">
          {/* Left: Search & Select Payment */}
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Search className="w-5 h-5" />
                  Find Payment
                </CardTitle>
                <CardDescription>
                  Search by customer name, email, phone, or address
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2 mb-4">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                    <Input
                      placeholder="Search payments..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                  <Button variant="outline" onClick={fetchPayments} disabled={isLoading}>
                    <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                  </Button>
                </div>

                <div className="space-y-2 max-h-[500px] overflow-y-auto">
                  {filteredPayments.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <DollarSign className="w-12 h-12 mx-auto mb-2 opacity-50" />
                      <p>No refundable payments found</p>
                    </div>
                  ) : (
                    filteredPayments.map((payment) => (
                      <div
                        key={payment.id}
                        onClick={() => setSelectedPayment(payment)}
                        className={`p-4 rounded-lg border cursor-pointer transition-all ${
                          selectedPayment?.id === payment.id
                            ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                            : 'border-border hover:border-primary/50 hover:bg-muted/50'
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <User className="w-4 h-4 text-muted-foreground" />
                              <span className="font-medium">
                                {payment.profiles?.first_name} {payment.profiles?.last_name}
                              </span>
                            </div>
                            <p className="text-sm text-muted-foreground mb-1">
                              {payment.profiles?.email}
                            </p>
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Calendar className="w-3 h-3" />
                              {format(new Date(payment.created_at), 'MMM d, yyyy h:mm a')}
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="font-bold text-lg">${payment.amount.toFixed(2)}</p>
                            <Badge className="bg-green-500">
                              <CheckCircle className="w-3 h-3 mr-1" />
                              Paid
                            </Badge>
                          </div>
                        </div>
                        <div className="mt-2 pt-2 border-t border-border">
                          <div className="flex items-start gap-1 text-xs text-muted-foreground">
                            <MapPin className="w-3 h-3 mt-0.5 shrink-0" />
                            <span className="truncate">{payment.rides?.pickup_address}</span>
                          </div>
                          <div className="flex items-start gap-1 text-xs text-muted-foreground">
                            <span className="ml-3">→ {payment.rides?.dropoff_address}</span>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right: Refund Form */}
          <div>
            <Card className={selectedPayment ? 'border-primary' : ''}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <RefreshCw className="w-5 h-5" />
                  Process Refund
                </CardTitle>
                <CardDescription>
                  {selectedPayment 
                    ? 'Review details and confirm the refund'
                    : 'Select a payment from the list to refund'
                  }
                </CardDescription>
              </CardHeader>
              <CardContent>
                {selectedPayment ? (
                  <div className="space-y-6">
                    {/* Customer Info */}
                    <div className="p-4 bg-muted rounded-lg space-y-3">
                      <h4 className="font-semibold">Customer Details</h4>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <p className="text-muted-foreground">Name</p>
                          <p className="font-medium">
                            {selectedPayment.profiles?.first_name} {selectedPayment.profiles?.last_name}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Email</p>
                          <p className="font-medium">{selectedPayment.profiles?.email || 'N/A'}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Phone</p>
                          <p className="font-medium">{selectedPayment.profiles?.phone_number || 'N/A'}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Payment Date</p>
                          <p className="font-medium">
                            {format(new Date(selectedPayment.created_at), 'MMM d, yyyy')}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Ride Info */}
                    <div className="p-4 bg-muted rounded-lg space-y-3">
                      <h4 className="font-semibold">Ride Details</h4>
                      <div className="text-sm space-y-2">
                        <div className="flex items-start gap-2">
                          <div className="w-2 h-2 rounded-full bg-green-500 mt-1.5" />
                          <div>
                            <p className="text-muted-foreground">Pickup</p>
                            <p className="font-medium">{selectedPayment.rides?.pickup_address}</p>
                          </div>
                        </div>
                        <div className="flex items-start gap-2">
                          <div className="w-2 h-2 rounded-full bg-red-500 mt-1.5" />
                          <div>
                            <p className="text-muted-foreground">Dropoff</p>
                            <p className="font-medium">{selectedPayment.rides?.dropoff_address}</p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Refund Amount */}
                    <div className="p-6 bg-destructive/10 border border-destructive/20 rounded-lg text-center">
                      <p className="text-sm text-muted-foreground mb-1">Refund Amount</p>
                      <p className="text-4xl font-bold text-destructive">
                        ${selectedPayment.amount.toFixed(2)} {selectedPayment.currency}
                      </p>
                    </div>

                    {/* Reason */}
                    <div>
                      <label className="text-sm font-medium">Refund Reason (optional)</label>
                      <Textarea
                        placeholder="Enter reason for refund..."
                        value={refundReason}
                        onChange={(e) => setRefundReason(e.target.value)}
                        className="mt-2"
                        rows={3}
                      />
                    </div>

                    {/* Action Buttons */}
                    <div className="flex gap-3">
                      <Button 
                        variant="outline" 
                        onClick={() => {
                          setSelectedPayment(null);
                          setRefundReason('');
                        }}
                        className="flex-1"
                      >
                        <XCircle className="w-4 h-4 mr-2" />
                        Cancel
                      </Button>
                      <Button 
                        onClick={handleRefund} 
                        disabled={isProcessingRefund}
                        className="flex-1 bg-destructive hover:bg-destructive/90"
                      >
                        {isProcessingRefund ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <RefreshCw className="w-4 h-4 mr-2" />
                        )}
                        Confirm Refund
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <DollarSign className="w-16 h-16 mx-auto mb-4 opacity-30" />
                    <p className="text-lg">Select a payment to refund</p>
                    <p className="text-sm">Choose from the list on the left</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
};

export default AdminRefunds;
