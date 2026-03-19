import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import Navbar from '@/components/Navbar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { 
  FileText, 
  Search, 
  Loader2, 
  User, 
  ArrowLeft,
  CheckCircle,
  Clock,
  XCircle,
  Eye,
  Car
} from 'lucide-react';
import { format } from 'date-fns';

interface DriverDocument {
  id: string;
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone_number: string | null;
  avatar_url: string | null;
  driver_license_url: string | null;
  has_criminal_record: boolean;
  agreement_accepted: boolean;
  agreement_accepted_at: string | null;
  application_status: string;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_color: string | null;
  license_plate: string | null;
  created_at: string;
}

const AdminDriverDocuments = () => {
  const { user, isLoading: authLoading, roles } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [drivers, setDrivers] = useState<DriverDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);

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
      fetchDriverDocuments();
    }
  }, [user, isAdmin]);

  const fetchDriverDocuments = async () => {
    setIsLoading(true);
    try {
      // Get all driver profiles with their documents
      const { data: driverProfiles, error: driverError } = await supabase
        .from('driver_profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (driverError) throw driverError;

      if (!driverProfiles || driverProfiles.length === 0) {
        setDrivers([]);
        return;
      }

      // Get profiles for all drivers
      const userIds = driverProfiles.map(d => d.user_id);
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('*')
        .in('user_id', userIds);

      if (profilesError) throw profilesError;

      // Merge the data
      const driversWithProfiles: DriverDocument[] = driverProfiles.map(dp => {
        const profile = profiles?.find(p => p.user_id === dp.user_id);
        return {
          id: dp.id,
          user_id: dp.user_id,
          first_name: profile?.first_name || null,
          last_name: profile?.last_name || null,
          email: profile?.email || null,
          phone_number: profile?.phone_number || null,
          avatar_url: profile?.avatar_url || null,
          driver_license_url: dp.driver_license_url || null,
          has_criminal_record: dp.has_criminal_record || false,
          agreement_accepted: dp.agreement_accepted || false,
          agreement_accepted_at: dp.agreement_accepted_at,
          application_status: dp.application_status || 'pending',
          vehicle_make: dp.vehicle_make,
          vehicle_model: dp.vehicle_model,
          vehicle_color: dp.vehicle_color,
          license_plate: dp.license_plate,
          created_at: dp.created_at,
        };
      });

      setDrivers(driversWithProfiles);
    } catch (error: any) {
      console.error('Error fetching driver documents:', error);
      toast({
        title: 'Error',
        description: 'Failed to load driver documents.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const updateApplicationStatus = async (userId: string, status: 'approved' | 'rejected') => {
    setUpdatingStatus(userId);
    try {
      const { error } = await supabase
        .from('driver_profiles')
        .update({ 
          application_status: status,
          is_verified: status === 'approved'
        })
        .eq('user_id', userId);

      if (error) throw error;

      toast({
        title: status === 'approved' ? 'Driver Approved' : 'Driver Rejected',
        description: `The driver application has been ${status}.`,
      });

      fetchDriverDocuments();
    } catch (error: any) {
      console.error('Error updating status:', error);
      toast({
        title: 'Error',
        description: 'Failed to update application status.',
        variant: 'destructive',
      });
    } finally {
      setUpdatingStatus(null);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'approved':
        return <Badge className="bg-green-500"><CheckCircle className="w-3 h-3 mr-1" /> Approved</Badge>;
      case 'pending':
        return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" /> Pending</Badge>;
      case 'rejected':
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" /> Rejected</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const filteredDrivers = drivers.filter(d => {
    const searchLower = searchTerm.toLowerCase();
    const matchesSearch = (
      d.first_name?.toLowerCase().includes(searchLower) ||
      d.last_name?.toLowerCase().includes(searchLower) ||
      d.email?.toLowerCase().includes(searchLower) ||
      d.phone_number?.toLowerCase().includes(searchLower)
    );
    const matchesFilter = statusFilter === 'all' || d.application_status === statusFilter;
    return matchesSearch && matchesFilter;
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
        <div className="flex items-center gap-4 mb-8">
          <Button variant="ghost" size="icon" onClick={() => navigate('/admin')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold text-foreground">Driver Documents</h1>
            <p className="text-muted-foreground">Review driver licenses and agreements</p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Drivers</CardDescription>
              <CardTitle className="text-2xl">{drivers.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Pending Review</CardDescription>
              <CardTitle className="text-2xl text-yellow-600">
                {drivers.filter(d => d.application_status === 'pending').length}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Approved</CardDescription>
              <CardTitle className="text-2xl text-green-600">
                {drivers.filter(d => d.application_status === 'approved').length}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Rejected</CardDescription>
              <CardTitle className="text-2xl text-red-600">
                {drivers.filter(d => d.application_status === 'rejected').length}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
            <Input
              placeholder="Search drivers..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="flex gap-2">
            <Button 
              variant={statusFilter === 'all' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStatusFilter('all')}
            >
              All
            </Button>
            <Button 
              variant={statusFilter === 'pending' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStatusFilter('pending')}
            >
              Pending
            </Button>
            <Button 
              variant={statusFilter === 'approved' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStatusFilter('approved')}
            >
              Approved
            </Button>
            <Button 
              variant={statusFilter === 'rejected' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStatusFilter('rejected')}
            >
              Rejected
            </Button>
          </div>
        </div>

        {/* Drivers Table */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Driver</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Vehicle</TableHead>
                    <TableHead>Documents</TableHead>
                    <TableHead>Criminal Record</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Applied</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDrivers.map((driver) => (
                    <TableRow key={driver.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-10 w-10">
                            {driver.avatar_url ? (
                              <AvatarImage src={driver.avatar_url} alt={driver.first_name || 'Driver'} />
                            ) : (
                              <AvatarFallback>
                                <User className="h-5 w-5" />
                              </AvatarFallback>
                            )}
                          </Avatar>
                          <div>
                            <p className="font-medium">
                              {driver.first_name || driver.last_name 
                                ? `${driver.first_name || ''} ${driver.last_name || ''}`.trim()
                                : 'No name'}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          <p>{driver.email || 'N/A'}</p>
                          <p className="text-muted-foreground">{driver.phone_number || 'N/A'}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          <p>{driver.vehicle_make} {driver.vehicle_model}</p>
                          <p className="text-muted-foreground">
                            {driver.vehicle_color} • {driver.license_plate}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          {driver.driver_license_url ? (
                            <Badge variant="outline" className="text-green-600 border-green-600">
                              <FileText className="w-3 h-3 mr-1" /> License Uploaded
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-destructive border-destructive">
                              No License
                            </Badge>
                          )}
                          {driver.agreement_accepted ? (
                            <Badge variant="outline" className="text-green-600 border-green-600">
                              <CheckCircle className="w-3 h-3 mr-1" /> Agreement Signed
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-destructive border-destructive">
                              Not Signed
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={driver.has_criminal_record ? 'destructive' : 'secondary'}>
                          {driver.has_criminal_record ? 'Yes' : 'No'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {getStatusBadge(driver.application_status)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {format(new Date(driver.created_at), 'MMM d, yyyy')}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => navigate(`/admin/driver-documents/${driver.user_id}`)}
                          >
                            <Eye className="w-4 h-4 mr-1" />
                            View
                          </Button>
                          {driver.application_status === 'pending' && (
                            <>
                              <Button
                                variant="default"
                                size="sm"
                                onClick={() => updateApplicationStatus(driver.user_id, 'approved')}
                                disabled={updatingStatus === driver.user_id}
                              >
                                {updatingStatus === driver.user_id ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  'Approve'
                                )}
                              </Button>
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => updateApplicationStatus(driver.user_id, 'rejected')}
                                disabled={updatingStatus === driver.user_id}
                              >
                                Reject
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredDrivers.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                        <Car className="w-12 h-12 mx-auto mb-3 opacity-50" />
                        <p className="text-lg font-medium">No drivers found</p>
                        <p className="text-sm">Driver applications will appear here</p>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default AdminDriverDocuments;
