import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import Navbar from '@/components/Navbar';
import AddCustomLocationForm from '@/components/AddCustomLocationForm';
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
  Loader2,
  Users,
  Car,
  Shield,
  User,
  MapPin,
  Navigation,
  Eye,
  Bell,
  Send,
  Trash2,
  Wallet,
  Mail,
  Phone,
  Radio,
  FileText,
  MessageSquare,
  HelpCircle
} from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { format } from 'date-fns';
import { SupportMessagesPanel } from '@/components/admin/SupportMessagesPanel';
import { AdminTipsPanel } from '@/components/admin/AdminTipsPanel';

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

interface UserProfile {
  id: string;
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone_number: string | null;
  created_at: string;
  roles: string[];
}

interface Ride {
  id: string;
  rider_id: string | null;
  driver_id: string | null;
  pickup_address: string;
  dropoff_address: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat: number;
  dropoff_lng: number;
  status: 'pending_payment' | 'searching' | 'driver_assigned' | 'driver_en_route' | 'arrived' | 'in_progress' | 'completed' | 'cancelled';
  estimated_fare: number;
  actual_fare: number | null;
  subtotal_before_tax: number | null;
  gst_amount: number | null;
  qst_amount: number | null;
  distance_km: number | null;
  estimated_duration_minutes: number | null;
  requested_at: string;
  accepted_at: string | null;
  pickup_at: string | null;
  dropoff_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  driver_earnings: number | null;
  platform_fee: number | null;
  rider_profile?: {
    first_name: string | null;
    last_name: string | null;
    email: string | null;
  };
  driver_profile?: {
    first_name: string | null;
    last_name: string | null;
  };
}

interface Stats {
  totalPayments: number;
  totalRevenue: number;
  pendingPayments: number;
  refundedAmount: number;
  totalUsers: number;
  totalDrivers: number;
  totalRiders: number;
  totalRides: number;
  activeRides: number;
  completedRides: number;
  cancelledRides: number;
}

const AdminDashboard = () => {
  const { user, isLoading: authLoading, roles } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [activeTab, setActiveTab] = useState('riders');
  const [payments, setPayments] = useState<Payment[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [rides, setRides] = useState<Ride[]>([]);
  const [stats, setStats] = useState<Stats>({ 
    totalPayments: 0, 
    totalRevenue: 0, 
    pendingPayments: 0, 
    refundedAmount: 0,
    totalUsers: 0,
    totalDrivers: 0,
    totalRiders: 0,
    totalRides: 0,
    activeRides: 0,
    completedRides: 0,
    cancelledRides: 0
  });
  const [rideFilter, setRideFilter] = useState('all');
  const [selectedRide, setSelectedRide] = useState<Ride | null>(null);
  const [rideDetailOpen, setRideDetailOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('all');
  const [refundDialog, setRefundDialog] = useState<{ open: boolean; payment: Payment | null }>({ open: false, payment: null });
  const [refundReason, setRefundReason] = useState('');
  const [isProcessingRefund, setIsProcessingRefund] = useState(false);
  
  // Notification testing state
  const [selectedDriverId, setSelectedDriverId] = useState<string>('');
  const [notificationTitle, setNotificationTitle] = useState('🧪 Test Notification');
  const [notificationBody, setNotificationBody] = useState('This is a test push notification from the admin dashboard.');
  const [isSendingNotification, setIsSendingNotification] = useState(false);
  const [driverSubscriptions, setDriverSubscriptions] = useState<Array<{ user_id: string; count: number }>>([]);
  
  // Custom locations state
  const [customLocations, setCustomLocations] = useState<Array<{
    id: string;
    name: string;
    address: string;
    lat: number;
    lng: number;
    category: string | null;
    created_at: string;
    is_active: boolean;
  }>>([]);
  const [isDeletingLocation, setIsDeletingLocation] = useState<string | null>(null);

  // Withdraw requests state
  const [withdrawRequests, setWithdrawRequests] = useState<Array<{
    id: string;
    driver_id: string;
    amount: number;
    contact_method: string;
    contact_value: string;
    status: string;
    admin_notes: string | null;
    created_at: string;
    processed_at: string | null;
    driver_name?: string;
    driver_email?: string;
  }>>([]);
  const [processingWithdraw, setProcessingWithdraw] = useState<string | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [isAssigningDriver, setIsAssigningDriver] = useState(false);

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
      fetchData();
      fetchDriverSubscriptions();
      fetchCustomLocations();
      fetchWithdrawRequests();
    }
  }, [user, isAdmin]);

  // Subscribe to new withdraw requests in realtime
  useEffect(() => {
    if (!user || !isAdmin) return;

    const channel = supabase
      .channel('withdraw-requests-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'withdraw_requests',
        },
        (payload) => {
          toast({
            title: '💰 New Withdraw Request!',
            description: `Driver requested $${payload.new.amount.toFixed(2)}`,
          });
          fetchWithdrawRequests();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, isAdmin]);

  const fetchCustomLocations = async () => {
    try {
      const { data, error } = await supabase
        .from('custom_locations')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setCustomLocations(data || []);
    } catch (error) {
      console.error('Error fetching custom locations:', error);
    }
  };

  const fetchWithdrawRequests = async () => {
    try {
      const { data, error } = await supabase
        .from('withdraw_requests')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Fetch driver profiles for names
      if (data && data.length > 0) {
        const driverIds = [...new Set(data.map(w => w.driver_id))];
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, first_name, last_name, email')
          .in('user_id', driverIds);

        const profilesMap: Record<string, any> = {};
        profiles?.forEach(p => {
          profilesMap[p.user_id] = p;
        });

        const requestsWithNames = data.map(w => ({
          ...w,
          driver_name: profilesMap[w.driver_id]
            ? `${profilesMap[w.driver_id].first_name || ''} ${profilesMap[w.driver_id].last_name || ''}`.trim() || 'Unknown'
            : 'Unknown',
          driver_email: profilesMap[w.driver_id]?.email || 'N/A',
        }));

        setWithdrawRequests(requestsWithNames);
      } else {
        setWithdrawRequests([]);
      }
    } catch (error) {
      console.error('Error fetching withdraw requests:', error);
    }
  };

  const updateWithdrawStatus = async (id: string, status: string) => {
    setProcessingWithdraw(id);
    try {
      const { error } = await supabase
        .from('withdraw_requests')
        .update({ 
          status, 
          processed_at: new Date().toISOString(),
          processed_by: user?.id 
        })
        .eq('id', id);

      if (error) throw error;

      toast({
        title: status === 'completed' ? '✅ Marked as Completed' : `Status updated to ${status}`,
      });
      fetchWithdrawRequests();
    } catch (error: any) {
      console.error('Error updating withdraw:', error);
      toast({
        title: 'Failed to update',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setProcessingWithdraw(null);
    }
  };

  const deleteUser = async (userId: string) => {
    if (!confirm('Are you sure you want to delete this user? This will remove their profile, roles, and related data.')) {
      return;
    }

    setDeletingUserId(userId);
    try {
      // Delete user roles first
      await supabase
        .from('user_roles')
        .delete()
        .eq('user_id', userId);

      // Delete rider_locations
      await supabase
        .from('rider_locations')
        .delete()
        .eq('user_id', userId);

      // Delete push_subscriptions
      await supabase
        .from('push_subscriptions')
        .delete()
        .eq('user_id', userId);

      // Delete profile
      const { error } = await supabase
        .from('profiles')
        .delete()
        .eq('user_id', userId);

      if (error) throw error;

      toast({ title: 'User deleted successfully' });
      fetchUsers();
    } catch (error: any) {
      console.error('Error deleting user:', error);
      toast({
        title: 'Failed to delete user',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setDeletingUserId(null);
    }
  };

  const deleteCustomLocation = async (id: string) => {
    setIsDeletingLocation(id);
    try {
      const { error } = await supabase
        .from('custom_locations')
        .delete()
        .eq('id', id);

      if (error) throw error;
      
      toast({ title: 'Location deleted' });
      fetchCustomLocations();
    } catch (error: any) {
      console.error('Error deleting location:', error);
      toast({ 
        title: 'Failed to delete', 
        description: error.message,
        variant: 'destructive' 
      });
    } finally {
      setIsDeletingLocation(null);
    }
  };

  const fetchDriverSubscriptions = async () => {
    try {
      // Get all push subscriptions grouped by user
      const { data, error } = await supabase
        .from('push_subscriptions')
        .select('user_id');

      if (error) throw error;

      // Count subscriptions per user
      const counts: Record<string, number> = {};
      data?.forEach(sub => {
        counts[sub.user_id] = (counts[sub.user_id] || 0) + 1;
      });

      const subscriptionCounts = Object.entries(counts).map(([user_id, count]) => ({
        user_id,
        count
      }));

      setDriverSubscriptions(subscriptionCounts);
    } catch (error) {
      console.error('Error fetching driver subscriptions:', error);
    }
  };

  const [lastNotificationResult, setLastNotificationResult] = useState<{
    success: boolean;
    message: string;
    timestamp: Date;
  } | null>(null);

  const sendTestNotification = async () => {
    if (!selectedDriverId) {
      toast({
        title: 'Select a Driver',
        description: 'Please select a driver to send the test notification to.',
        variant: 'destructive',
      });
      return;
    }

    setIsSendingNotification(true);
    setLastNotificationResult(null);
    const startTime = Date.now();

    try {
      const { data, error } = await supabase.functions.invoke('send-push-notification', {
        body: {
          userId: selectedDriverId,
          title: notificationTitle,
          body: notificationBody,
          url: '/driver',
          data: { type: 'test', timestamp: new Date().toISOString() }
        }
      });

      if (error) throw error;

      const duration = Date.now() - startTime;
      const selectedDriver = users.find(u => u.user_id === selectedDriverId);
      const driverName = selectedDriver?.first_name || selectedDriver?.email || 'driver';

      if (data.sent > 0) {
        const successMessage = `✅ Notification delivered to ${driverName} (${data.sent}/${data.total} subscriptions) in ${duration}ms`;
        setLastNotificationResult({
          success: true,
          message: successMessage,
          timestamp: new Date()
        });
        toast({
          title: '✅ Notification Sent!',
          description: `Delivered to ${driverName} in ${duration}ms`,
        });
      } else {
        const failMessage = `❌ No active subscriptions for ${driverName}. They may need to enable push notifications.`;
        setLastNotificationResult({
          success: false,
          message: failMessage,
          timestamp: new Date()
        });
        toast({
          title: 'No Notifications Sent',
          description: data.message || 'The driver may not have push notifications enabled.',
          variant: 'destructive',
        });
      }

      // Refresh subscription counts
      fetchDriverSubscriptions();
    } catch (error: any) {
      console.error('Error sending notification:', error);
      setLastNotificationResult({
        success: false,
        message: `❌ Failed: ${error.message || 'Unknown error'}`,
        timestamp: new Date()
      });
      toast({
        title: 'Failed to Send',
        description: error.message || 'Failed to send test notification.',
        variant: 'destructive',
      });
    } finally {
      setIsSendingNotification(false);
    }
  };

  const fetchData = async () => {
    setIsLoading(true);
    await Promise.all([fetchPayments(), fetchUsers(), fetchRides()]);
    setIsLoading(false);
  };

  const fetchPayments = async () => {
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
      
      // Calculate payment stats
      const paymentStats = paymentsWithProfiles.reduce((acc, p) => ({
        totalPayments: acc.totalPayments + 1,
        totalRevenue: acc.totalRevenue + (p.status === 'succeeded' ? p.amount : 0),
        pendingPayments: acc.pendingPayments + (p.status === 'pending' ? 1 : 0),
        refundedAmount: acc.refundedAmount + (p.status === 'refunded' ? p.amount : 0),
      }), { totalPayments: 0, totalRevenue: 0, pendingPayments: 0, refundedAmount: 0 });

      setStats(prev => ({ ...prev, ...paymentStats }));
    } catch (error: any) {
      console.error('Error fetching payments:', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch payments',
        variant: 'destructive',
      });
    }
  };

  const fetchUsers = async () => {
    try {
      // Fetch all profiles
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (profilesError) throw profilesError;

      // Fetch all user roles
      const { data: rolesData, error: rolesError } = await supabase
        .from('user_roles')
        .select('user_id, role');

      if (rolesError) throw rolesError;

      // Map roles to users
      const rolesMap: Record<string, string[]> = {};
      rolesData?.forEach(r => {
        if (!rolesMap[r.user_id]) {
          rolesMap[r.user_id] = [];
        }
        rolesMap[r.user_id].push(r.role);
      });

      const usersWithRoles: UserProfile[] = profiles?.map(p => ({
        ...p,
        roles: rolesMap[p.user_id] || []
      })) || [];

      setUsers(usersWithRoles);

      // Calculate user stats
      const totalDrivers = usersWithRoles.filter(u => u.roles.includes('driver')).length;
      const totalRiders = usersWithRoles.filter(u => u.roles.includes('rider')).length;

      setStats(prev => ({ 
        ...prev, 
        totalUsers: usersWithRoles.length,
        totalDrivers,
        totalRiders
      }));
    } catch (error: any) {
      console.error('Error fetching users:', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch users',
        variant: 'destructive',
      });
    }
  };

  const fetchRides = async () => {
    try {
      const { data: ridesData, error } = await supabase
        .from('rides')
        .select('*')
        .order('requested_at', { ascending: false });

      if (error) throw error;

      // Fetch rider and driver profiles
      const riderIds = [...new Set(ridesData?.map(r => r.rider_id).filter(Boolean))];
      const driverIds = [...new Set(ridesData?.map(r => r.driver_id).filter(Boolean))];
      const allUserIds = [...new Set([...riderIds, ...driverIds])];

      let profilesMap: Record<string, any> = {};
      
      if (allUserIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, first_name, last_name, email')
          .in('user_id', allUserIds);
        
        profiles?.forEach(p => {
          profilesMap[p.user_id] = p;
        });
      }

      const ridesWithProfiles: Ride[] = ridesData?.map(r => ({
        ...r,
        rider_profile: r.rider_id ? profilesMap[r.rider_id] : null,
        driver_profile: r.driver_id ? profilesMap[r.driver_id] : null
      })) || [];

      setRides(ridesWithProfiles);

      // Calculate ride stats
      const activeStatuses = ['searching', 'driver_assigned', 'driver_en_route', 'arrived', 'in_progress'];
      const activeRides = ridesWithProfiles.filter(r => activeStatuses.includes(r.status)).length;
      const completedRides = ridesWithProfiles.filter(r => r.status === 'completed').length;
      const cancelledRides = ridesWithProfiles.filter(r => r.status === 'cancelled').length;

      setStats(prev => ({
        ...prev,
        totalRides: ridesWithProfiles.length,
        activeRides,
        completedRides,
        cancelledRides
      }));
    } catch (error: any) {
      console.error('Error fetching rides:', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch rides',
        variant: 'destructive',
      });
    }
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

  const assignDriverToRide = async (rideId: string, driverUserId: string) => {
    setIsAssigningDriver(true);
    try {
      const { error } = await supabase
        .from('rides')
        .update({ 
          driver_id: driverUserId, 
          status: 'driver_assigned' as any,
          accepted_at: new Date().toISOString()
        })
        .eq('id', rideId);

      if (error) throw error;

      toast({ title: '✅ Driver assigned successfully' });
      fetchRides();

      // Update selected ride in dialog
      setSelectedRide(prev => prev ? { 
        ...prev, 
        driver_id: driverUserId, 
        status: 'driver_assigned',
        driver_profile: users.find(u => u.user_id === driverUserId) 
          ? { first_name: users.find(u => u.user_id === driverUserId)!.first_name, last_name: users.find(u => u.user_id === driverUserId)!.last_name }
          : undefined
      } : null);
    } catch (error: any) {
      console.error('Error assigning driver:', error);
      toast({
        title: 'Failed to assign driver',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsAssigningDriver(false);
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

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'admin':
        return <Badge className="bg-purple-500"><Shield className="w-3 h-3 mr-1" /> Admin</Badge>;
      case 'driver':
        return <Badge className="bg-blue-500"><Car className="w-3 h-3 mr-1" /> Driver</Badge>;
      case 'rider':
        return <Badge variant="secondary"><User className="w-3 h-3 mr-1" /> Rider</Badge>;
      default:
        return <Badge variant="outline">{role}</Badge>;
    }
  };

  const getRideStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge className="bg-green-500"><CheckCircle className="w-3 h-3 mr-1" /> Completed</Badge>;
      case 'searching':
        return <Badge variant="secondary"><Search className="w-3 h-3 mr-1" /> Searching</Badge>;
      case 'driver_assigned':
        return <Badge className="bg-blue-500"><Car className="w-3 h-3 mr-1" /> Assigned</Badge>;
      case 'driver_en_route':
        return <Badge className="bg-indigo-500"><Navigation className="w-3 h-3 mr-1" /> En Route</Badge>;
      case 'arrived':
        return <Badge className="bg-purple-500"><MapPin className="w-3 h-3 mr-1" /> Arrived</Badge>;
      case 'in_progress':
        return <Badge className="bg-orange-500"><Car className="w-3 h-3 mr-1" /> In Progress</Badge>;
      case 'cancelled':
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" /> Cancelled</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const filteredPayments = payments.filter(p => {
    const searchLower = searchTerm.toLowerCase();
    const matchesSearch = (
      p.id.toLowerCase().includes(searchLower) ||
      p.profiles?.email?.toLowerCase().includes(searchLower) ||
      p.profiles?.first_name?.toLowerCase().includes(searchLower) ||
      p.profiles?.last_name?.toLowerCase().includes(searchLower) ||
      p.rides?.pickup_address?.toLowerCase().includes(searchLower) ||
      p.rides?.dropoff_address?.toLowerCase().includes(searchLower)
    );
    const matchesFilter = paymentFilter === 'all' || p.status === paymentFilter;
    return matchesSearch && matchesFilter;
  });

  const filteredRides = rides.filter(r => {
    const searchLower = searchTerm.toLowerCase();
    const matchesSearch = (
      r.pickup_address?.toLowerCase().includes(searchLower) ||
      r.dropoff_address?.toLowerCase().includes(searchLower) ||
      r.rider_profile?.email?.toLowerCase().includes(searchLower) ||
      r.rider_profile?.first_name?.toLowerCase().includes(searchLower) ||
      r.rider_profile?.last_name?.toLowerCase().includes(searchLower) ||
      r.driver_profile?.first_name?.toLowerCase().includes(searchLower) ||
      r.driver_profile?.last_name?.toLowerCase().includes(searchLower)
    );
    const matchesFilter = rideFilter === 'all' || r.status === rideFilter;
    return matchesSearch && matchesFilter;
  });

  const filteredUsers = users.filter(u => {
    const searchLower = searchTerm.toLowerCase();
    return (
      u.email?.toLowerCase().includes(searchLower) ||
      u.first_name?.toLowerCase().includes(searchLower) ||
      u.last_name?.toLowerCase().includes(searchLower) ||
      u.phone_number?.toLowerCase().includes(searchLower)
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
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Admin Dashboard</h1>
            <p className="text-muted-foreground">Manage users, payments, and refunds</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => navigate('/admin/riders-live')} variant="outline" className="gap-2">
              <User className="w-4 h-4" />
              Live Riders
            </Button>
            <Button onClick={() => navigate('/admin/drivers-live')} variant="outline" className="gap-2">
              <Radio className="w-4 h-4" />
              Live Drivers
            </Button>
            <Button onClick={() => navigate('/admin/driver-documents')} variant="outline" className="gap-2">
              <FileText className="w-4 h-4" />
              Driver Documents
            </Button>
            <Button onClick={() => navigate('/admin/refunds')} className="gap-2">
              <RefreshCw className="w-4 h-4" />
              Issue Refund
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-8">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Users</CardDescription>
              <CardTitle className="text-2xl">{stats.totalUsers}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Drivers</CardDescription>
              <CardTitle className="text-2xl text-blue-600">{stats.totalDrivers}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Riders</CardDescription>
              <CardTitle className="text-2xl text-purple-600">{stats.totalRiders}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Rides</CardDescription>
              <CardTitle className="text-2xl">{stats.totalRides}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Active Rides</CardDescription>
              <CardTitle className="text-2xl text-orange-600">{stats.activeRides}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Completed</CardDescription>
              <CardTitle className="text-2xl text-green-600">{stats.completedRides}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* Secondary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Revenue</CardDescription>
              <CardTitle className="text-2xl text-green-600">${stats.totalRevenue.toFixed(2)}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Payments</CardDescription>
              <CardTitle className="text-2xl">{stats.totalPayments}</CardTitle>
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
              <CardDescription>Refunded</CardDescription>
              <CardTitle className="text-2xl text-red-600">${stats.refundedAmount.toFixed(2)}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* Main Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <div className="flex flex-col sm:flex-row justify-between gap-4">
            <TabsList>
              <TabsTrigger value="riders" className="gap-2">
                <User className="w-4 h-4" />
                Riders
              </TabsTrigger>
              <TabsTrigger value="drivers" className="gap-2">
                <Car className="w-4 h-4" />
                Drivers
              </TabsTrigger>
              <TabsTrigger value="rides" className="gap-2">
                <Navigation className="w-4 h-4" />
                Rides
              </TabsTrigger>
              <TabsTrigger value="payments" className="gap-2">
                <DollarSign className="w-4 h-4" />
                Payments
              </TabsTrigger>
              <TabsTrigger value="tips" className="gap-2">
                <DollarSign className="w-4 h-4" />
                Tips
              </TabsTrigger>
              <TabsTrigger value="notifications" className="gap-2">
                <Bell className="w-4 h-4" />
                Notifications
              </TabsTrigger>
              <TabsTrigger value="locations" className="gap-2">
                <MapPin className="w-4 h-4" />
                Locations
              </TabsTrigger>
              <TabsTrigger value="withdrawals" className="gap-2">
                <Wallet className="w-4 h-4" />
                Withdrawals
                {withdrawRequests.filter(w => w.status === 'pending').length > 0 && (
                  <Badge className="ml-1 bg-destructive text-destructive-foreground">
                    {withdrawRequests.filter(w => w.status === 'pending').length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="support" className="gap-2">
                <HelpCircle className="w-4 h-4" />
                Support
              </TabsTrigger>
            </TabsList>
            
            <div className="flex gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                <Input
                  placeholder={activeTab === 'riders' ? 'Search riders...' : activeTab === 'drivers' ? 'Search drivers...' : activeTab === 'rides' ? 'Search rides...' : 'Search payments...'}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 w-64"
                />
              </div>
              <Button variant="outline" onClick={fetchData} disabled={isLoading}>
                <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
          </div>

          {/* Riders Tab */}
          <TabsContent value="riders">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Rider</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Joined</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers
                      .filter(u => u.roles.includes('rider'))
                      .map((user) => (
                        <TableRow key={user.id}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                                <User className="w-4 h-4 text-muted-foreground" />
                              </div>
                              <span className="font-medium">
                                {user.first_name || user.last_name 
                                  ? `${user.first_name || ''} ${user.last_name || ''}`.trim()
                                  : 'No name'}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>{user.email || 'N/A'}</TableCell>
                          <TableCell>{user.phone_number || 'N/A'}</TableCell>
                          <TableCell className="whitespace-nowrap">
                            {format(new Date(user.created_at), 'MMM d, yyyy')}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => deleteUser(user.user_id)}
                              disabled={deletingUserId === user.user_id}
                            >
                              {deletingUserId === user.user_id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Trash2 className="w-4 h-4" />
                              )}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    {filteredUsers.filter(u => u.roles.includes('rider')).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          <User className="w-8 h-8 mx-auto mb-2" />
                          No riders found
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Drivers Tab */}
          <TabsContent value="drivers">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Driver</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Joined</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers
                      .filter(u => u.roles.includes('driver'))
                      .map((user) => (
                        <TableRow key={user.id}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                                <Car className="w-4 h-4 text-muted-foreground" />
                              </div>
                              <span className="font-medium">
                                {user.first_name || user.last_name 
                                  ? `${user.first_name || ''} ${user.last_name || ''}`.trim()
                                  : 'No name'}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>{user.email || 'N/A'}</TableCell>
                          <TableCell>{user.phone_number || 'N/A'}</TableCell>
                          <TableCell className="whitespace-nowrap">
                            {format(new Date(user.created_at), 'MMM d, yyyy')}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => deleteUser(user.user_id)}
                              disabled={deletingUserId === user.user_id}
                            >
                              {deletingUserId === user.user_id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Trash2 className="w-4 h-4" />
                              )}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    {filteredUsers.filter(u => u.roles.includes('driver')).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          <Car className="w-8 h-8 mx-auto mb-2" />
                          No drivers found
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Rides Tab */}
          <TabsContent value="rides">
            <div className="mb-4">
              <TabsList>
                <TabsTrigger value="all" onClick={() => setRideFilter('all')}>All</TabsTrigger>
                <TabsTrigger value="searching" onClick={() => setRideFilter('searching')}>Searching</TabsTrigger>
                <TabsTrigger value="in_progress" onClick={() => setRideFilter('in_progress')}>In Progress</TabsTrigger>
                <TabsTrigger value="completed" onClick={() => setRideFilter('completed')}>Completed</TabsTrigger>
                <TabsTrigger value="cancelled" onClick={() => setRideFilter('cancelled')}>Cancelled</TabsTrigger>
              </TabsList>
            </div>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Rider</TableHead>
                      <TableHead>Driver</TableHead>
                      <TableHead>Route</TableHead>
                      <TableHead>Fare</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRides.map((ride) => (
                      <TableRow key={ride.id}>
                        <TableCell className="whitespace-nowrap">
                          {format(new Date(ride.requested_at), 'MMM d, yyyy HH:mm')}
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium">
                              {ride.rider_profile?.first_name} {ride.rider_profile?.last_name}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {ride.rider_profile?.email || 'N/A'}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          {ride.driver_profile ? (
                            <div>
                              <p className="font-medium">
                                {ride.driver_profile?.first_name} {ride.driver_profile?.last_name}
                              </p>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">Not assigned</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="max-w-xs">
                            <p className="text-sm truncate flex items-center gap-1">
                              <MapPin className="w-3 h-3 text-green-500" />
                              {ride.pickup_address}
                            </p>
                            <p className="text-sm text-muted-foreground truncate flex items-center gap-1">
                              <MapPin className="w-3 h-3 text-red-500" />
                              {ride.dropoff_address}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="font-medium">
                          ${(ride.actual_fare || ride.estimated_fare).toFixed(2)}
                        </TableCell>
                        <TableCell>
                          {getRideStatusBadge(ride.status)}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSelectedRide(ride);
                              setRideDetailOpen(true);
                            }}
                          >
                            <Eye className="w-4 h-4 mr-1" />
                            View
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {filteredRides.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                          <Car className="w-8 h-8 mx-auto mb-2" />
                          No rides found
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Payments Tab */}
          <TabsContent value="payments">
            <div className="mb-4">
              <TabsList>
                <TabsTrigger value="all" onClick={() => setPaymentFilter('all')}>All</TabsTrigger>
                <TabsTrigger value="succeeded" onClick={() => setPaymentFilter('succeeded')}>Succeeded</TabsTrigger>
                <TabsTrigger value="pending" onClick={() => setPaymentFilter('pending')}>Pending</TabsTrigger>
                <TabsTrigger value="refunded" onClick={() => setPaymentFilter('refunded')}>Refunded</TabsTrigger>
              </TabsList>
            </div>
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
                    {filteredPayments.map((payment) => (
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
                    {filteredPayments.length === 0 && (
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

          {/* Tips Tab */}
          <TabsContent value="tips">
            <AdminTipsPanel />
          </TabsContent>

          {/* Notifications Tab */}
          <TabsContent value="notifications">
            <div className="grid gap-6 md:grid-cols-2">
              {/* Send Test Notification Card */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Send className="w-5 h-5" />
                    Send Test Notification
                  </CardTitle>
                  <CardDescription>
                    Send a test FCM push notification to a driver to verify the system is working.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Select Driver</label>
                    <Select value={selectedDriverId} onValueChange={setSelectedDriverId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a driver..." />
                      </SelectTrigger>
                      <SelectContent>
                        {users
                          .filter(u => u.roles.includes('driver'))
                          .map(driver => {
                            const subCount = driverSubscriptions.find(s => s.user_id === driver.user_id)?.count || 0;
                             const displayName = `${driver.first_name ?? ''} ${driver.last_name ?? ''}`.trim();
                             const label = displayName || driver.email || driver.user_id;
                            return (
                              <SelectItem key={driver.user_id} value={driver.user_id}>
                                <div className="flex items-center gap-2">
                                   <span className="truncate max-w-[220px]">{label}</span>
                                   {driver.email && displayName && driver.email !== label && (
                                     <span className="text-xs text-muted-foreground truncate max-w-[220px]">
                                       ({driver.email})
                                     </span>
                                   )}
                                  <Badge variant={subCount > 0 ? "default" : "secondary"} className="ml-2">
                                    {subCount} sub{subCount !== 1 ? 's' : ''}
                                  </Badge>
                                </div>
                              </SelectItem>
                            );
                          })}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Only drivers with active subscriptions will receive notifications.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Notification Title</label>
                    <Input
                      value={notificationTitle}
                      onChange={(e) => setNotificationTitle(e.target.value)}
                      placeholder="Notification title..."
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Notification Body</label>
                    <Textarea
                      value={notificationBody}
                      onChange={(e) => setNotificationBody(e.target.value)}
                      placeholder="Notification message..."
                      rows={3}
                    />
                  </div>

                  <Button 
                    onClick={sendTestNotification} 
                    disabled={isSendingNotification || !selectedDriverId}
                    className="w-full"
                  >
                    {isSendingNotification ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4 mr-2" />
                    )}
                    Send Test Notification
                  </Button>

                  {/* Notification Result Confirmation */}
                  {lastNotificationResult && (
                    <div 
                      className={`mt-4 p-4 rounded-lg border ${
                        lastNotificationResult.success 
                          ? 'bg-primary/10 border-primary/30 text-primary' 
                          : 'bg-destructive/10 border-destructive/30 text-destructive'
                      }`}
                    >
                      <p className="font-medium text-sm">{lastNotificationResult.message}</p>
                      <p className="text-xs opacity-70 mt-1">
                        {lastNotificationResult.timestamp.toLocaleTimeString()}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Subscription Status Card */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Bell className="w-5 h-5" />
                    Push Subscription Status
                  </CardTitle>
                  <CardDescription>
                    Overview of drivers with active FCM push subscriptions.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-4 bg-muted rounded-lg text-center">
                        <p className="text-2xl font-bold text-primary">
                          {driverSubscriptions.length}
                        </p>
                        <p className="text-sm text-muted-foreground">Users with Subscriptions</p>
                      </div>
                      <div className="p-4 bg-muted rounded-lg text-center">
                        <p className="text-2xl font-bold text-primary">
                          {driverSubscriptions.reduce((acc, s) => acc + s.count, 0)}
                        </p>
                        <p className="text-sm text-muted-foreground">Total Subscriptions</p>
                      </div>
                    </div>

                    <div className="border rounded-lg">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Driver</TableHead>
                            <TableHead>Email</TableHead>
                            <TableHead className="text-right">Subscriptions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {users
                            .filter(u => u.roles.includes('driver'))
                            .slice(0, 10)
                            .map(driver => {
                              const subCount = driverSubscriptions.find(s => s.user_id === driver.user_id)?.count || 0;
                              return (
                                <TableRow key={driver.user_id}>
                                  <TableCell className="font-medium">
                                    {driver.first_name} {driver.last_name}
                                  </TableCell>
                                  <TableCell className="text-muted-foreground">
                                    {driver.email}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <Badge variant={subCount > 0 ? "default" : "outline"}>
                                      {subCount}
                                    </Badge>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          {users.filter(u => u.roles.includes('driver')).length === 0 && (
                            <TableRow>
                              <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                                <Car className="w-8 h-8 mx-auto mb-2" />
                                No drivers found
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>

                    <Button 
                      variant="outline" 
                      onClick={fetchDriverSubscriptions}
                      className="w-full"
                    >
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Refresh Subscriptions
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Locations Tab */}
          <TabsContent value="locations">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Custom Locations</CardTitle>
                  <CardDescription>
                    Add locations that riders can search for (restaurants, clubs, etc.)
                  </CardDescription>
                </div>
                <AddCustomLocationForm onLocationAdded={fetchCustomLocations} />
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Address</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Added</TableHead>
                      <TableHead className="w-[80px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customLocations.map((loc) => (
                      <TableRow key={loc.id}>
                        <TableCell className="font-medium">{loc.name}</TableCell>
                        <TableCell className="text-muted-foreground max-w-xs truncate">
                          {loc.address}
                        </TableCell>
                        <TableCell>
                          {loc.category ? (
                            <Badge variant="secondary">{loc.category}</Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {format(new Date(loc.created_at), 'MMM d, yyyy')}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:text-destructive"
                            onClick={() => deleteCustomLocation(loc.id)}
                            disabled={isDeletingLocation === loc.id}
                          >
                            {isDeletingLocation === loc.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {customLocations.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          <MapPin className="w-8 h-8 mx-auto mb-2" />
                          No custom locations added yet
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
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

      {/* Ride Detail Dialog */}
      <Dialog open={rideDetailOpen} onOpenChange={setRideDetailOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Ride Details</DialogTitle>
            <DialogDescription>
              View complete information about this ride
            </DialogDescription>
          </DialogHeader>
          
          {selectedRide && (
            <div className="space-y-4 py-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Status</span>
                {getRideStatusBadge(selectedRide.status)}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-muted rounded-lg">
                  <p className="text-sm font-medium mb-2">Rider</p>
                  <p className="text-sm">
                    {selectedRide.rider_profile?.first_name} {selectedRide.rider_profile?.last_name}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {selectedRide.rider_profile?.email}
                  </p>
                </div>
                <div className="p-4 bg-muted rounded-lg">
                  <p className="text-sm font-medium mb-2">Driver</p>
                  {selectedRide.driver_profile ? (
                    <p className="text-sm">
                      {selectedRide.driver_profile?.first_name} {selectedRide.driver_profile?.last_name}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">Not assigned</p>
                  )}
                  {/* Admin driver assignment */}
                  {(selectedRide.status === 'searching' || selectedRide.status === 'pending_payment') && (
                    <div className="mt-3">
                      <Select
                        onValueChange={(driverUserId) => assignDriverToRide(selectedRide.id, driverUserId)}
                        disabled={isAssigningDriver}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={isAssigningDriver ? "Assigning..." : "Assign a driver..."} />
                        </SelectTrigger>
                        <SelectContent>
                          {users
                            .filter(u => u.roles.includes('driver'))
                            .map(driver => (
                              <SelectItem key={driver.user_id} value={driver.user_id}>
                                {driver.first_name || ''} {driver.last_name || ''} ({driver.email || 'no email'})
                              </SelectItem>
                            ))
                          }
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              </div>

              <div className="p-4 bg-muted rounded-lg space-y-2">
                <p className="text-sm font-medium">Route</p>
                <div className="flex items-start gap-2">
                  <MapPin className="w-4 h-4 text-green-500 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">Pickup</p>
                    <p className="text-sm text-muted-foreground">{selectedRide.pickup_address}</p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <MapPin className="w-4 h-4 text-red-500 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">Dropoff</p>
                    <p className="text-sm text-muted-foreground">{selectedRide.dropoff_address}</p>
                  </div>
                </div>
              </div>

              {/* Financial Breakdown */}
              <div className="p-4 bg-muted rounded-lg space-y-3">
                <p className="text-sm font-medium">Bill Breakdown</p>
                
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Subtotal (before tax)</span>
                    <span className="font-medium">
                      {selectedRide.subtotal_before_tax ? `$${selectedRide.subtotal_before_tax.toFixed(2)}` : '-'}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">GST (5%)</span>
                    <span>
                      {selectedRide.gst_amount ? `$${selectedRide.gst_amount.toFixed(2)}` : '-'}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">QST (9.975%)</span>
                    <span>
                      {selectedRide.qst_amount ? `$${selectedRide.qst_amount.toFixed(2)}` : '-'}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm pt-2 border-t border-border">
                    <span className="font-medium">Trip Total (with tax)</span>
                    <span className="font-bold">
                      {selectedRide.actual_fare ? `$${selectedRide.actual_fare.toFixed(2)}` : 
                       `$${selectedRide.estimated_fare.toFixed(2)}`}
                    </span>
                  </div>
                </div>

                <div className="pt-2 border-t border-border space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Platform Fee</span>
                    <span className="text-destructive">
                      {selectedRide.platform_fee ? `-$${selectedRide.platform_fee.toFixed(2)}` : '-'}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="font-medium text-primary">Driver Earnings</span>
                    <span className="font-bold text-primary">
                      {selectedRide.driver_earnings ? `$${selectedRide.driver_earnings.toFixed(2)}` : '-'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Estimated Fare</p>
                  <p className="font-medium">${selectedRide.estimated_fare.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Distance</p>
                  <p className="font-medium">{selectedRide.distance_km ? `${selectedRide.distance_km.toFixed(1)} km` : '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Duration</p>
                  <p className="font-medium">{selectedRide.estimated_duration_minutes ? `${selectedRide.estimated_duration_minutes} min` : '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Completed At</p>
                  <p className="font-medium text-sm">{selectedRide.dropoff_at ? format(new Date(selectedRide.dropoff_at), 'MMM d, yyyy HH:mm') : '-'}</p>
                </div>
              </div>

              {selectedRide.status === 'cancelled' && (
                <div className="p-4 bg-destructive/10 rounded-lg">
                  <p className="text-sm font-medium text-destructive">Cancellation Reason</p>
                  <p className="text-sm">{selectedRide.cancellation_reason || 'No reason provided'}</p>
                  {selectedRide.cancelled_at && (
                    <p className="text-sm text-muted-foreground mt-1">
                      Cancelled at: {format(new Date(selectedRide.cancelled_at), 'MMM d, yyyy HH:mm')}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setRideDetailOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Withdrawals Tab Content - Add after existing tabs */}
      {activeTab === 'withdrawals' && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="w-5 h-5" />
              Withdraw Requests
            </CardTitle>
            <CardDescription>
              Manage driver payout requests via e-transfer
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Driver</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {withdrawRequests.map((req) => (
                  <TableRow key={req.id}>
                    <TableCell className="whitespace-nowrap">
                      {format(new Date(req.created_at), 'MMM d, HH:mm')}
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{req.driver_name}</p>
                        <p className="text-sm text-muted-foreground">{req.driver_email}</p>
                      </div>
                    </TableCell>
                    <TableCell className="font-bold text-lg">${req.amount.toFixed(2)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {req.contact_method === 'email' ? <Mail className="w-4 h-4" /> : <Phone className="w-4 h-4" />}
                        <span className="text-sm">{req.contact_value}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={
                        req.status === 'pending' ? 'bg-warning text-warning-foreground' :
                        req.status === 'completed' ? 'bg-success text-success-foreground' :
                        req.status === 'processing' ? 'bg-primary text-primary-foreground' :
                        'bg-destructive text-destructive-foreground'
                      }>
                        {req.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {req.status === 'pending' && (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => updateWithdrawStatus(req.id, 'completed')}
                            disabled={processingWithdraw === req.id}
                          >
                            {processingWithdraw === req.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                            Done
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {withdrawRequests.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      <Wallet className="w-8 h-8 mx-auto mb-2" />
                      No withdraw requests yet
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Support Messages Tab */}
      {activeTab === 'support' && (
        <div className="mt-4">
          <SupportMessagesPanel />
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;
