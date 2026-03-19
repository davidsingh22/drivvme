import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import Navbar from '@/components/Navbar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  FileText, 
  Loader2, 
  User, 
  ArrowLeft,
  CheckCircle,
  Clock,
  XCircle,
  Car,
  Phone,
  Mail,
  Calendar,
  ExternalLink,
  AlertTriangle
} from 'lucide-react';
import { format } from 'date-fns';

interface DriverDetail {
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
  is_verified: boolean;
  created_at: string;
}

interface DriverAgreement {
  id: string;
  is_independent_contractor: boolean;
  is_responsible_for_taxes: boolean;
  agrees_to_terms: boolean;
  signed_at: string;
  user_agent: string | null;
}

const AdminDriverDocumentDetail = () => {
  const { driverId } = useParams<{ driverId: string }>();
  const { user, isLoading: authLoading, profileLoading, roles } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [driver, setDriver] = useState<DriverDetail | null>(null);
  const [agreement, setAgreement] = useState<DriverAgreement | null>(null);
  const [licenseUrl, setLicenseUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const isAdmin = roles.includes('admin' as any);

  useEffect(() => {
    if (authLoading || profileLoading) return;
    if (!user) {
      navigate('/login');
    } else if (roles.length > 0 && !isAdmin) {
      navigate('/');
      toast({
        title: 'Access Denied',
        description: 'You do not have admin privileges.',
        variant: 'destructive',
      });
    }
  }, [user, authLoading, profileLoading, isAdmin, roles.length, navigate, toast]);

  useEffect(() => {
    if (user && isAdmin && driverId) {
      fetchDriverDetail();
    }
  }, [user, isAdmin, driverId]);

  const fetchDriverDetail = async () => {
    if (!driverId) return;
    
    setIsLoading(true);
    try {
      // Get driver profile
      const { data: driverProfile, error: driverError } = await supabase
        .from('driver_profiles')
        .select('*')
        .eq('user_id', driverId)
        .single();

      if (driverError) throw driverError;

      // Get user profile
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', driverId)
        .single();

      if (profileError && profileError.code !== 'PGRST116') {
        throw profileError;
      }

      // Get agreement
      const { data: agreementData, error: agreementError } = await supabase
        .from('driver_agreements')
        .select('*')
        .eq('driver_id', driverId)
        .order('signed_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (agreementError && agreementError.code !== 'PGRST116') {
        console.error('Agreement fetch error:', agreementError);
      }

      // Get signed URL for license if exists
      if (driverProfile.driver_license_url) {
        const { data: signedUrl, error: urlError } = await supabase.storage
          .from('driver-licenses')
          .createSignedUrl(driverProfile.driver_license_url, 60 * 60); // 1 hour

        if (!urlError && signedUrl) {
          setLicenseUrl(signedUrl.signedUrl);
        }
      }

      const driverData: DriverDetail = {
        id: driverProfile.id,
        user_id: driverProfile.user_id,
        first_name: profile?.first_name || null,
        last_name: profile?.last_name || null,
        email: profile?.email || null,
        phone_number: profile?.phone_number || null,
        avatar_url: profile?.avatar_url || null,
        driver_license_url: driverProfile.driver_license_url,
        has_criminal_record: driverProfile.has_criminal_record || false,
        agreement_accepted: driverProfile.agreement_accepted || false,
        agreement_accepted_at: driverProfile.agreement_accepted_at,
        application_status: driverProfile.application_status || 'pending',
        vehicle_make: driverProfile.vehicle_make,
        vehicle_model: driverProfile.vehicle_model,
        vehicle_color: driverProfile.vehicle_color,
        license_plate: driverProfile.license_plate,
        is_verified: driverProfile.is_verified || false,
        created_at: driverProfile.created_at,
      };

      setDriver(driverData);
      setAgreement(agreementData || null);
    } catch (error: any) {
      console.error('Error fetching driver detail:', error);
      toast({
        title: 'Error',
        description: 'Failed to load driver details.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const updateApplicationStatus = async (status: 'approved' | 'rejected') => {
    if (!driver) return;
    
    setUpdatingStatus(true);
    try {
      const { error } = await supabase
        .from('driver_profiles')
        .update({ 
          application_status: status,
          is_verified: status === 'approved'
        })
        .eq('user_id', driver.user_id);

      if (error) throw error;

      toast({
        title: status === 'approved' ? 'Driver Approved' : 'Driver Rejected',
        description: `The driver application has been ${status}.`,
      });

      fetchDriverDetail();
    } catch (error: any) {
      console.error('Error updating status:', error);
      toast({
        title: 'Error',
        description: 'Failed to update application status.',
        variant: 'destructive',
      });
    } finally {
      setUpdatingStatus(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'approved':
        return <Badge className="bg-green-500"><CheckCircle className="w-3 h-3 mr-1" /> Approved</Badge>;
      case 'pending':
        return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" /> Pending Review</Badge>;
      case 'rejected':
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" /> Rejected</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!driver) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <main className="container mx-auto px-4 py-8 pt-20 text-center">
          <p className="text-muted-foreground">Driver not found</p>
          <Button variant="outline" onClick={() => navigate('/admin/driver-documents')} className="mt-4">
            Back to Driver Documents
          </Button>
        </main>
      </div>
    );
  }

  const driverName = `${driver.first_name || ''} ${driver.last_name || ''}`.trim() || 'Unknown Driver';

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      <main className="container mx-auto px-4 py-8 pt-20">
        <div className="flex items-center gap-4 mb-8">
          <Button variant="ghost" size="icon" onClick={() => navigate('/admin/driver-documents')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-3xl font-bold text-foreground">{driverName}</h1>
            <p className="text-muted-foreground">Driver Application Details</p>
          </div>
          {getStatusBadge(driver.application_status)}
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {/* Driver Info Card */}
          <Card>
            <CardHeader>
              <CardTitle>Driver Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <Avatar className="h-20 w-20">
                  {driver.avatar_url ? (
                    <AvatarImage src={driver.avatar_url} alt={driverName} />
                  ) : (
                    <AvatarFallback>
                      <User className="h-10 w-10" />
                    </AvatarFallback>
                  )}
                </Avatar>
                <div>
                  <p className="font-bold text-lg">{driverName}</p>
                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    <Mail className="h-4 w-4" />
                    {driver.email || 'No email'}
                  </div>
                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    <Phone className="h-4 w-4" />
                    {driver.phone_number || 'No phone'}
                  </div>
                </div>
              </div>

              <div className="border-t pt-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Car className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">Vehicle:</span>
                  <span>{driver.vehicle_make} {driver.vehicle_model}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-medium ml-6">Color:</span>
                  <span>{driver.vehicle_color || 'N/A'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-medium ml-6">Plate:</span>
                  <span>{driver.license_plate || 'N/A'}</span>
                </div>
              </div>

              <div className="border-t pt-4">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    Applied: {format(new Date(driver.created_at), 'MMMM d, yyyy')}
                  </span>
                </div>
              </div>

              {driver.has_criminal_record && (
                <div className="border-t pt-4">
                  <div className="flex items-center gap-2 p-3 bg-destructive/10 rounded-lg">
                    <AlertTriangle className="h-5 w-5 text-destructive" />
                    <span className="text-destructive font-medium">Has Criminal Record</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Driver's License Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Driver's License
              </CardTitle>
              <CardDescription>
                Uploaded document for verification
              </CardDescription>
            </CardHeader>
            <CardContent>
              {licenseUrl ? (
                <div className="space-y-4">
                  <div className="border rounded-lg overflow-hidden bg-muted">
                    {driver.driver_license_url?.endsWith('.pdf') ? (
                      <div className="p-8 text-center">
                        <FileText className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
                        <p className="text-sm text-muted-foreground mb-4">PDF Document</p>
                        <Button asChild>
                          <a href={licenseUrl} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-4 w-4 mr-2" />
                            Open PDF
                          </a>
                        </Button>
                      </div>
                    ) : (
                      <img 
                        src={licenseUrl} 
                        alt="Driver's License" 
                        className="w-full h-auto max-h-[400px] object-contain"
                      />
                    )}
                  </div>
                  <Button variant="outline" className="w-full" asChild>
                    <a href={licenseUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Open Full Size
                    </a>
                  </Button>
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No driver's license uploaded</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Agreement Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5" />
                Contract Agreement
              </CardTitle>
              <CardDescription>
                Independent Contractor Agreement status
              </CardDescription>
            </CardHeader>
            <CardContent>
              {agreement ? (
                <div className="space-y-4">
                  <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
                    <div className="flex items-center gap-2 text-green-600 font-medium mb-2">
                      <CheckCircle className="h-5 w-5" />
                      Agreement Signed
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Signed on {format(new Date(agreement.signed_at), 'MMMM d, yyyy \'at\' h:mm a')}
                    </p>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <CheckCircle className={`h-4 w-4 ${agreement.is_independent_contractor ? 'text-green-500' : 'text-muted-foreground'}`} />
                      <span className="text-sm">Confirmed independent contractor status</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <CheckCircle className={`h-4 w-4 ${agreement.is_responsible_for_taxes ? 'text-green-500' : 'text-muted-foreground'}`} />
                      <span className="text-sm">Accepts tax responsibility</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <CheckCircle className={`h-4 w-4 ${agreement.agrees_to_terms ? 'text-green-500' : 'text-muted-foreground'}`} />
                      <span className="text-sm">Agrees to all terms</span>
                    </div>
                  </div>

                  {agreement.user_agent && (
                    <div className="border-t pt-4">
                      <p className="text-xs text-muted-foreground">
                        <strong>Device:</strong> {agreement.user_agent.substring(0, 100)}...
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <XCircle className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>Agreement not signed yet</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Action Buttons */}
        {driver.application_status === 'pending' && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Application Actions</CardTitle>
              <CardDescription>
                Review the documents above and approve or reject this driver application.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex gap-4">
              <Button
                size="lg"
                onClick={() => updateApplicationStatus('approved')}
                disabled={updatingStatus}
                className="flex-1"
              >
                {updatingStatus ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle className="w-4 h-4 mr-2" />
                )}
                Approve Driver
              </Button>
              <Button
                variant="destructive"
                size="lg"
                onClick={() => updateApplicationStatus('rejected')}
                disabled={updatingStatus}
                className="flex-1"
              >
                {updatingStatus ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <XCircle className="w-4 h-4 mr-2" />
                )}
                Reject Driver
              </Button>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
};

export default AdminDriverDocumentDetail;
