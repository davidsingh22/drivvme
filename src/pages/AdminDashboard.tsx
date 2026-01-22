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
  Loader2,
  Users,
  Car,
  Shield,
  User,
  MapPin,
  Navigation,
  Eye
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
  
  const [activeTab, setActiveTab] = useState('users');
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
    }
  }, [user, isAdmin]);

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
          <Button onClick={() => navigate('/admin/refunds')} className="gap-2">
            <RefreshCw className="w-4 h-4" />
            Issue Refund
          </Button>
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
              <TabsTrigger value="users" className="gap-2">
                <Users className="w-4 h-4" />
                Users
              </TabsTrigger>
              <TabsTrigger value="rides" className="gap-2">
                <Car className="w-4 h-4" />
                Rides
              </TabsTrigger>
              <TabsTrigger value="payments" className="gap-2">
                <DollarSign className="w-4 h-4" />
                Payments
              </TabsTrigger>
            </TabsList>
            
            <div className="flex gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                <Input
                  placeholder={activeTab === 'users' ? 'Search users...' : activeTab === 'rides' ? 'Search rides...' : 'Search payments...'}
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

          {/* Users Tab */}
          <TabsContent value="users">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Roles</TableHead>
                      <TableHead>Joined</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers.map((user) => (
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
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {user.roles.length > 0 ? (
                              user.roles.map(role => (
                                <span key={role}>{getRoleBadge(role)}</span>
                              ))
                            ) : (
                              <Badge variant="outline">No role</Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {format(new Date(user.created_at), 'MMM d, yyyy')}
                        </TableCell>
                      </TableRow>
                    ))}
                    {filteredUsers.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          <Users className="w-8 h-8 mx-auto mb-2" />
                          No users found
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

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Estimated Fare</p>
                  <p className="font-medium">${selectedRide.estimated_fare.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Actual Fare</p>
                  <p className="font-medium">{selectedRide.actual_fare ? `$${selectedRide.actual_fare.toFixed(2)}` : '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Distance</p>
                  <p className="font-medium">{selectedRide.distance_km ? `${selectedRide.distance_km.toFixed(1)} km` : '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Duration</p>
                  <p className="font-medium">{selectedRide.estimated_duration_minutes ? `${selectedRide.estimated_duration_minutes} min` : '-'}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Driver Earnings</p>
                  <p className="font-medium">{selectedRide.driver_earnings ? `$${selectedRide.driver_earnings.toFixed(2)}` : '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Platform Fee</p>
                  <p className="font-medium">{selectedRide.platform_fee ? `$${selectedRide.platform_fee.toFixed(2)}` : '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Requested At</p>
                  <p className="font-medium text-sm">{format(new Date(selectedRide.requested_at), 'MMM d, yyyy HH:mm')}</p>
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
    </div>
  );
};

export default AdminDashboard;
