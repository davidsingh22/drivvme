import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Car, User, ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import Logo from '@/components/Logo';
import LanguageToggle from '@/components/LanguageToggle';
import PasswordInput from '@/components/signup/PasswordInput';
import DriverLicenseUpload from '@/components/signup/DriverLicenseUpload';
import ProfilePictureUpload from '@/components/signup/ProfilePictureUpload';
import CriminalRecordQuestion from '@/components/signup/CriminalRecordQuestion';
import DriverAgreement from '@/components/signup/DriverAgreement';
import ApplicationReviewPage from '@/components/signup/ApplicationReviewPage';
import RiderDisclosure from '@/components/signup/RiderDisclosure';
import RiderMarketingPanel from '@/components/signup/RiderMarketingPanel';
import DriverMarketingPanel from '@/components/signup/DriverMarketingPanel';
import { useToast } from '@/hooks/use-toast';

type DriverSignupStep = 'info' | 'agreement' | 'review';

const Signup = () => {
  const { t } = useLanguage();
  const { signUp, isLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  
  const [role, setRole] = useState<'rider' | 'driver'>(
    (searchParams.get('role') as 'rider' | 'driver') || 'rider'
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  
  // Driver-specific fields
  const [vehicleMake, setVehicleMake] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehicleColor, setVehicleColor] = useState('');
  const [licensePlate, setLicensePlate] = useState('');
  
  // New driver signup fields
  const [profilePicture, setProfilePicture] = useState<File | null>(null);
  const [driverLicense, setDriverLicense] = useState<File | null>(null);
  const [hasCriminalRecord, setHasCriminalRecord] = useState<boolean | null>(null);
  const [driverStep, setDriverStep] = useState<DriverSignupStep>('info');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Rider agreement
  const [riderAgreementChecked, setRiderAgreementChecked] = useState(false);
  
  // Store created user ID for later steps
  const [createdUserId, setCreatedUserId] = useState<string | null>(null);

  // Password validation
  const isPasswordValid = (pwd: string) => {
    return pwd.length >= 7 && /\d/.test(pwd);
  };

  // Validate rider form
  const validateRiderForm = () => {
    if (!firstName.trim()) {
      setError('First name is required');
      return false;
    }
    if (!lastName.trim()) {
      setError('Last name is required');
      return false;
    }
    if (!email.trim()) {
      setError('Email is required');
      return false;
    }
    if (!phone.trim()) {
      setError('Phone number is required');
      return false;
    }
    if (!isPasswordValid(password)) {
      setError('Password must be at least 7 characters with at least 1 number');
      return false;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return false;
    }
    if (!riderAgreementChecked) {
      setError('You must agree to the Rider Terms of Use and acknowledge the Disclosure');
      return false;
    }
    return true;
  };

  // Validate driver form
  const validateDriverForm = () => {
    if (!firstName.trim()) {
      setError('First name is required');
      return false;
    }
    if (!lastName.trim()) {
      setError('Last name is required');
      return false;
    }
    if (!email.trim()) {
      setError('Email is required');
      return false;
    }
    if (!phone.trim()) {
      setError('Phone number is required');
      return false;
    }
    if (!isPasswordValid(password)) {
      setError('Password must be at least 7 characters with at least 1 number');
      return false;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return false;
    }
    if (!vehicleMake.trim() || !vehicleModel.trim() || !vehicleColor.trim() || !licensePlate.trim()) {
      setError('Please fill in all vehicle information');
      return false;
    }
    if (!profilePicture) {
      setError('Profile picture is required');
      return false;
    }
    if (!driverLicense) {
      setError('Driver\'s license is required');
      return false;
    }
    if (hasCriminalRecord === null) {
      setError('Please answer the criminal record question');
      return false;
    }
    return true;
  };

  const handleRiderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!validateRiderForm()) return;

    setIsSubmitting(true);

    try {
      // Sign up the rider
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: window.location.origin,
        },
      });

      if (authError) throw authError;
      if (!authData.user) throw new Error('Failed to create account');

      const userId = authData.user.id;

      // Update profile
      await supabase
        .from('profiles')
        .update({
          first_name: firstName,
          last_name: lastName,
          phone_number: phone,
        })
        .eq('user_id', userId);

      // Add rider role
      await supabase
        .from('user_roles')
        .insert({ user_id: userId, role: 'rider' });

      // Store the rider agreement
      await supabase
        .from('rider_agreements')
        .insert({
          rider_id: userId,
          agrees_to_terms: true,
          agrees_to_disclosure: true,
          user_agent: navigator.userAgent,
        });

      toast({
        title: 'Account Created!',
        description: 'Welcome to Drivveme.',
      });

      navigate('/ride', { replace: true });
    } catch (err: any) {
      console.error('Signup error:', err);
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDriverInfoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!validateDriverForm()) return;

    setIsSubmitting(true);

    try {
      // Create the user account first
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: window.location.origin,
        },
      });

      if (authError) throw authError;
      if (!authData.user) throw new Error('Failed to create account');

      const userId = authData.user.id;
      setCreatedUserId(userId);

      // Update profile
      await supabase
        .from('profiles')
        .update({
          first_name: firstName,
          last_name: lastName,
          phone_number: phone,
        })
        .eq('user_id', userId);

      // Add driver role
      await supabase
        .from('user_roles')
        .insert({ user_id: userId, role: 'driver' });

      // Upload profile picture to avatars bucket
      const profilePicExt = profilePicture!.name.split('.').pop();
      const profilePicPath = `${userId}/avatar.${profilePicExt}`;
      
      const { error: profilePicError } = await supabase.storage
        .from('avatars')
        .upload(profilePicPath, profilePicture!, { upsert: true });

      if (profilePicError) {
        console.error('Profile picture upload error:', profilePicError);
      }

      const { data: profilePicUrl } = supabase.storage
        .from('avatars')
        .getPublicUrl(profilePicPath);

      // Upload driver license
      const licenseExt = driverLicense!.name.split('.').pop();
      const licensePath = `${userId}/license.${licenseExt}`;
      
      const { error: licenseError } = await supabase.storage
        .from('driver-licenses')
        .upload(licensePath, driverLicense!, { upsert: true });

      if (licenseError) {
        console.error('License upload error:', licenseError);
        throw new Error('Failed to upload driver license');
      }

      // Get signed URL for admin access (private bucket)
      const { data: licenseUrl } = await supabase.storage
        .from('driver-licenses')
        .createSignedUrl(licensePath, 60 * 60 * 24 * 365); // 1 year

      // Create driver profile with all info
      await supabase
        .from('driver_profiles')
        .insert({ 
          user_id: userId,
          vehicle_make: vehicleMake,
          vehicle_model: vehicleModel,
          vehicle_color: vehicleColor,
          license_plate: licensePlate,
          profile_picture_url: profilePicUrl?.publicUrl || null,
          driver_license_url: licensePath,
          has_criminal_record: hasCriminalRecord,
          application_status: 'pending',
        });

      // Update profiles with avatar url
      await supabase
        .from('profiles')
        .update({ avatar_url: profilePicUrl?.publicUrl })
        .eq('user_id', userId);

      // Move to agreement step
      setDriverStep('agreement');
    } catch (err: any) {
      console.error('Signup error:', err);
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAgreementComplete = async (agreementData: {
    isIndependentContractor: boolean;
    isResponsibleForTaxes: boolean;
    agreesToTerms: boolean;
  }) => {
    if (!createdUserId) {
      setError('Session error. Please try again.');
      return;
    }

    setIsSubmitting(true);

    try {
      // Store the agreement
      await supabase
        .from('driver_agreements')
        .insert({
          driver_id: createdUserId,
          is_independent_contractor: agreementData.isIndependentContractor,
          is_responsible_for_taxes: agreementData.isResponsibleForTaxes,
          agrees_to_terms: agreementData.agreesToTerms,
          user_agent: navigator.userAgent,
        });

      // Update driver profile to mark agreement accepted
      await supabase
        .from('driver_profiles')
        .update({
          agreement_accepted: true,
          agreement_accepted_at: new Date().toISOString(),
        })
        .eq('user_id', createdUserId);

      toast({
        title: 'Application Submitted!',
        description: 'Your driver application has been submitted for review.',
      });

      // Move to review page
      setDriverStep('review');
    } catch (err: any) {
      console.error('Agreement error:', err);
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Reset driver step when switching roles
  useEffect(() => {
    setDriverStep('info');
    setError('');
  }, [role]);

  // Render driver agreement step
  if (role === 'driver' && driverStep === 'agreement') {
    return (
      <div className="min-h-screen gradient-hero flex flex-col">
        <div className="flex items-center justify-between p-4">
          <button 
            onClick={() => setDriverStep('info')}
            className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-5 w-5" />
            Back
          </button>
          <LanguageToggle />
        </div>

        <div className="flex-1 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-2xl"
          >
            <div className="bg-card rounded-2xl p-8 shadow-card border border-border">
              <DriverAgreement 
                onComplete={handleAgreementComplete}
                isLoading={isSubmitting}
              />
            </div>
          </motion.div>
        </div>
      </div>
    );
  }

  // Render application review page
  if (role === 'driver' && driverStep === 'review') {
    return (
      <div className="min-h-screen gradient-hero flex flex-col">
        <div className="flex items-center justify-between p-4">
          <Link to="/">
            <Logo />
          </Link>
          <LanguageToggle />
        </div>

        <div className="flex-1 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-md"
          >
            <div className="bg-card rounded-2xl p-8 shadow-card border border-border">
              <ApplicationReviewPage />
            </div>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen gradient-hero flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4">
        <Link to="/">
          <Logo />
        </Link>
        <LanguageToggle />
      </div>

      {/* Main Content - Responsive Layout */}
      <div className="flex-1 flex flex-col lg:flex-row items-center lg:items-stretch justify-center p-4 gap-4 lg:gap-6 xl:gap-8">
        {/* Marketing Panel - Shown on ALL screens */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md lg:max-w-none lg:w-[480px] xl:w-[520px] flex-shrink-0"
        >
          {role === 'rider' ? <RiderMarketingPanel /> : <DriverMarketingPanel />}
        </motion.div>

        {/* Form */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md flex-shrink-0"
        >
          <div className="bg-card rounded-2xl p-8 shadow-card border border-border">
            <h1 className="font-display text-3xl font-bold text-center mb-2">
              {t('auth.signupTitle')}
            </h1>
            <p className="text-muted-foreground text-center mb-8">
              {t('auth.signupAs')}
            </p>

            {/* Role Toggle */}
            <div className="flex gap-2 mb-8 p-1 bg-muted rounded-xl">
              <button
                type="button"
                onClick={() => setRole('rider')}
                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg transition-all ${
                  role === 'rider'
                    ? 'bg-primary text-primary-foreground shadow-button'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <User className="h-5 w-5" />
                {t('auth.rider')}
              </button>
              <button
                type="button"
                onClick={() => setRole('driver')}
                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg transition-all ${
                  role === 'driver'
                    ? 'bg-primary text-primary-foreground shadow-button'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Car className="h-5 w-5" />
                {t('auth.driver')}
              </button>
            </div>

            <form onSubmit={role === 'rider' ? handleRiderSubmit : handleDriverInfoSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName">{t('auth.firstName')} *</Label>
                  <Input
                    id="firstName"
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required
                    className="bg-background"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">{t('auth.lastName')} *</Label>
                  <Input
                    id="lastName"
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    required
                    className="bg-background"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">{t('auth.email')} *</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="bg-background"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">{t('auth.phone')} *</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                  className="bg-background"
                />
              </div>

              {/* Driver-specific fields */}
              {role === 'driver' && (
                <>
                  <div className="pt-4 border-t border-border">
                    <p className="text-sm font-medium text-muted-foreground mb-3">Vehicle Information</p>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="vehicleMake">Vehicle Make *</Label>
                      <Input
                        id="vehicleMake"
                        type="text"
                        placeholder="e.g., Toyota"
                        value={vehicleMake}
                        onChange={(e) => setVehicleMake(e.target.value)}
                        required
                        className="bg-background"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="vehicleModel">Vehicle Model *</Label>
                      <Input
                        id="vehicleModel"
                        type="text"
                        placeholder="e.g., Camry"
                        value={vehicleModel}
                        onChange={(e) => setVehicleModel(e.target.value)}
                        required
                        className="bg-background"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="vehicleColor">Vehicle Color *</Label>
                      <Input
                        id="vehicleColor"
                        type="text"
                        placeholder="e.g., Silver"
                        value={vehicleColor}
                        onChange={(e) => setVehicleColor(e.target.value)}
                        required
                        className="bg-background"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="licensePlate">License Plate *</Label>
                      <Input
                        id="licensePlate"
                        type="text"
                        placeholder="e.g., ABC 123"
                        value={licensePlate}
                        onChange={(e) => setLicensePlate(e.target.value.toUpperCase())}
                        required
                        className="bg-background"
                      />
                    </div>
                  </div>

                  <div className="pt-4 border-t border-border">
                    <p className="text-sm font-medium text-muted-foreground mb-3">Documents & Verification</p>
                  </div>

                  <ProfilePictureUpload
                    onFileSelect={setProfilePicture}
                    selectedFile={profilePicture}
                    required
                  />

                  <DriverLicenseUpload
                    onFileSelect={setDriverLicense}
                    selectedFile={driverLicense}
                    label="Driver's License"
                    required
                  />

                  <CriminalRecordQuestion
                    value={hasCriminalRecord}
                    onChange={setHasCriminalRecord}
                  />
                </>
              )}

              <PasswordInput
                id="password"
                label={`${t('auth.password')} *`}
                value={password}
                onChange={setPassword}
                showValidation
              />

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">{t('auth.confirmPassword')} *</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className="bg-background"
                />
              </div>

              {/* Rider Disclosure - only show for riders */}
              {role === 'rider' && (
                <RiderDisclosure
                  checked={riderAgreementChecked}
                  onCheckedChange={setRiderAgreementChecked}
                />
              )}

              {error && (
                <p className="text-destructive text-sm text-center">{error}</p>
              )}

              <Button
                type="submit"
                className="w-full gradient-primary shadow-button py-6"
                disabled={isLoading || isSubmitting}
              >
                {(isLoading || isSubmitting) ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {role === 'driver' ? 'Creating Account...' : t('common.loading')}
                  </>
                ) : (
                  role === 'driver' ? 'Continue to Agreement' : t('auth.signupBtn')
                )}
              </Button>
            </form>

            <p className="mt-6 text-center text-muted-foreground">
              {t('auth.hasAccount')}{' '}
              <Link to="/login" className="text-primary hover:underline">
                {t('nav.login')}
              </Link>
            </p>
          </div>
        </motion.div>
      </div>

      {/* Driver tagline footer - only on desktop when driver selected */}
      {role === 'driver' && (
        <div className="hidden lg:block text-center pb-6">
          <p className="text-lg text-muted-foreground">
            {t('auth.driversAreIndependent') || 'Drivers Are'}{' '}
            <span className="text-primary font-semibold">{t('auth.independentContractors') || 'Independent'}</span>{' '}
            {t('auth.contractorsNotEmployees') || 'Contractors, Not Employees.'}
          </p>
          <p className="text-xl font-bold mt-2">
            {t('auth.driveWithConfidence') || 'Drive With'}{' '}
            <span className="text-primary">{t('auth.confidence') || 'Confidence.'}</span>
          </p>
          <p className="text-xl font-bold">
            {t('auth.driveWithRespect') || 'Drive With'}{' '}
            <span className="text-primary">{t('auth.respect') || 'Respect.'}</span>
          </p>
        </div>
      )}
    </div>
  );
};

export default Signup;
