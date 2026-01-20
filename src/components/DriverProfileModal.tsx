import { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Camera, Loader2, User } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface DriverProfileModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DriverProfileModal = ({ open, onOpenChange }: DriverProfileModalProps) => {
  const { user, profile, driverProfile, refreshProfile, refreshDriverProfile } = useAuth();
  const { toast } = useToast();
  
  const [firstName, setFirstName] = useState(profile?.first_name || '');
  const [lastName, setLastName] = useState(profile?.last_name || '');
  const [phone, setPhone] = useState(profile?.phone_number || '');
  const [vehicleMake, setVehicleMake] = useState(driverProfile?.vehicle_make || '');
  const [vehicleModel, setVehicleModel] = useState(driverProfile?.vehicle_model || '');
  const [vehicleColor, setVehicleColor] = useState(driverProfile?.vehicle_color || '');
  const [licensePlate, setLicensePlate] = useState(driverProfile?.license_plate || '');
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url || '');
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync state when modal opens with fresh data
  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen) {
      setFirstName(profile?.first_name || '');
      setLastName(profile?.last_name || '');
      setPhone(profile?.phone_number || '');
      setVehicleMake(driverProfile?.vehicle_make || '');
      setVehicleModel(driverProfile?.vehicle_model || '');
      setVehicleColor(driverProfile?.vehicle_color || '');
      setLicensePlate(driverProfile?.license_plate || '');
      setAvatarUrl(profile?.avatar_url || '');
    }
    onOpenChange(newOpen);
  };

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast({
        title: 'Invalid file type',
        description: 'Please select an image file',
        variant: 'destructive',
      });
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: 'File too large',
        description: 'Please select an image under 5MB',
        variant: 'destructive',
      });
      return;
    }

    setIsUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const filePath = `${user.id}/avatar.${fileExt}`;

      // Upload to storage
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);

      // Add cache buster
      const urlWithCacheBuster = `${publicUrl}?t=${Date.now()}`;
      setAvatarUrl(urlWithCacheBuster);

      toast({
        title: 'Photo uploaded',
        description: 'Your profile photo has been updated',
      });
    } catch (error: any) {
      toast({
        title: 'Upload failed',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleSave = async () => {
    if (!user) return;

    setIsSaving(true);
    try {
      // Update profile
      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          first_name: firstName.trim() || null,
          last_name: lastName.trim() || null,
          phone_number: phone.trim() || null,
          avatar_url: avatarUrl || null,
        })
        .eq('user_id', user.id);

      if (profileError) throw profileError;

      // Update driver profile
      const { error: driverError } = await supabase
        .from('driver_profiles')
        .update({
          vehicle_make: vehicleMake.trim() || null,
          vehicle_model: vehicleModel.trim() || null,
          vehicle_color: vehicleColor.trim() || null,
          license_plate: licensePlate.trim() || null,
        })
        .eq('user_id', user.id);

      if (driverError) throw driverError;

      await Promise.all([refreshProfile(), refreshDriverProfile()]);

      toast({
        title: 'Profile updated',
        description: 'Your profile has been saved successfully',
      });

      onOpenChange(false);
    } catch (error: any) {
      toast({
        title: 'Save failed',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const initials = `${firstName?.[0] || ''}${lastName?.[0] || ''}`.toUpperCase() || 'D';

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Profile</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Avatar Upload */}
          <div className="flex justify-center">
            <div className="relative">
              <Avatar className="h-24 w-24 cursor-pointer" onClick={handleAvatarClick}>
                <AvatarImage src={avatarUrl} alt="Profile photo" />
                <AvatarFallback className="text-2xl bg-primary text-primary-foreground">
                  {initials || <User className="h-10 w-10" />}
                </AvatarFallback>
              </Avatar>
              <button
                type="button"
                onClick={handleAvatarClick}
                disabled={isUploading}
                className="absolute bottom-0 right-0 p-2 bg-primary text-primary-foreground rounded-full shadow-lg hover:bg-primary/90 transition-colors"
              >
                {isUploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Camera className="h-4 w-4" />
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>
          </div>

          {/* Personal Info */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-muted-foreground">Personal Information</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name</Label>
                <Input
                  id="firstName"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="John"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Doe"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number</Label>
              <Input
                id="phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 (555) 000-0000"
              />
            </div>
          </div>

          {/* Vehicle Info */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-muted-foreground">Vehicle Information</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="vehicleMake">Make</Label>
                <Input
                  id="vehicleMake"
                  value={vehicleMake}
                  onChange={(e) => setVehicleMake(e.target.value)}
                  placeholder="Toyota"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vehicleModel">Model</Label>
                <Input
                  id="vehicleModel"
                  value={vehicleModel}
                  onChange={(e) => setVehicleModel(e.target.value)}
                  placeholder="Camry"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="vehicleColor">Color</Label>
                <Input
                  id="vehicleColor"
                  value={vehicleColor}
                  onChange={(e) => setVehicleColor(e.target.value)}
                  placeholder="Black"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="licensePlate">License Plate</Label>
                <Input
                  id="licensePlate"
                  value={licensePlate}
                  onChange={(e) => setLicensePlate(e.target.value)}
                  placeholder="ABC-1234"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            className="flex-1 gradient-primary"
            onClick={handleSave}
            disabled={isSaving || isUploading}
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              'Save Changes'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default DriverProfileModal;
