import { motion } from 'framer-motion';
import { Shield, Phone, Share2, AlertTriangle, MapPin, X, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { 
  Sheet, 
  SheetContent, 
  SheetHeader, 
  SheetTitle, 
  SheetDescription 
} from '@/components/ui/sheet';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { useState } from 'react';

interface SafetySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rideId: string;
  driverName: string;
  vehicleInfo: string;
  licensePlate: string;
  onShareLocation: () => void;
}

const SafetySheet = ({
  open,
  onOpenChange,
  rideId,
  driverName,
  vehicleInfo,
  licensePlate,
  onShareLocation,
}: SafetySheetProps) => {
  const { language } = useLanguage();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const handleCopyRideId = async () => {
    try {
      await navigator.clipboard.writeText(rideId);
      setCopied(true);
      toast({
        title: language === 'fr' ? 'Copié!' : 'Copied!',
        description: language === 'fr' ? 'ID du trajet copié' : 'Ride ID copied to clipboard',
      });
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Copy failed:', err);
    }
  };

  const handleEmergencyCall = () => {
    window.location.href = 'tel:911';
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-3xl">
        <SheetHeader className="text-left pb-4">
          <SheetTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            {language === 'fr' ? 'Centre de sécurité' : 'Safety Center'}
          </SheetTitle>
          <SheetDescription>
            {language === 'fr' 
              ? 'Outils de sécurité disponibles pendant votre trajet' 
              : 'Safety tools available during your trip'}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 pb-6">
          {/* Emergency button */}
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={handleEmergencyCall}
            className="w-full p-4 bg-destructive/10 border-2 border-destructive rounded-2xl flex items-center gap-4"
          >
            <div className="p-3 bg-destructive rounded-full">
              <AlertTriangle className="h-6 w-6 text-white" />
            </div>
            <div className="text-left flex-1">
              <p className="font-bold text-destructive">
                {language === 'fr' ? 'Appel d\'urgence 911' : 'Emergency Call 911'}
              </p>
              <p className="text-sm text-muted-foreground">
                {language === 'fr' 
                  ? 'Appelez les services d\'urgence' 
                  : 'Call emergency services'}
              </p>
            </div>
            <Phone className="h-5 w-5 text-destructive" />
          </motion.button>

          {/* Share location */}
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={() => {
              onShareLocation();
              onOpenChange(false);
            }}
            className="w-full p-4 bg-primary/10 border border-primary/30 rounded-2xl flex items-center gap-4"
          >
            <div className="p-3 bg-primary/20 rounded-full">
              <Share2 className="h-5 w-5 text-primary" />
            </div>
            <div className="text-left flex-1">
              <p className="font-semibold">
                {language === 'fr' ? 'Partager ma position' : 'Share my location'}
              </p>
              <p className="text-sm text-muted-foreground">
                {language === 'fr' 
                  ? 'Envoyer ma position en temps réel' 
                  : 'Send live location to a contact'}
              </p>
            </div>
            <MapPin className="h-5 w-5 text-primary" />
          </motion.button>

          {/* Trip info card */}
          <div className="p-4 bg-muted/50 rounded-2xl space-y-3">
            <h4 className="font-medium text-sm text-muted-foreground">
              {language === 'fr' ? 'Informations du trajet' : 'Trip Information'}
            </h4>
            
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {language === 'fr' ? 'Chauffeur' : 'Driver'}
                </span>
                <span className="font-medium">{driverName}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {language === 'fr' ? 'Véhicule' : 'Vehicle'}
                </span>
                <span className="font-medium">{vehicleInfo}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {language === 'fr' ? 'Plaque' : 'Plate'}
                </span>
                <span className="font-mono font-bold">{licensePlate}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {language === 'fr' ? 'ID du trajet' : 'Ride ID'}
                </span>
                <button 
                  onClick={handleCopyRideId}
                  className="flex items-center gap-1 font-mono text-sm hover:text-primary transition-colors"
                >
                  {rideId.slice(0, 8).toUpperCase()}
                  {copied ? (
                    <Check className="h-3 w-3 text-success" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Safety tips */}
          <div className="text-center text-xs text-muted-foreground pt-2">
            <p>
              {language === 'fr' 
                ? 'Votre sécurité est notre priorité. N\'hésitez pas à appeler le 911 en cas d\'urgence.'
                : 'Your safety is our priority. Don\'t hesitate to call 911 in an emergency.'}
            </p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default SafetySheet;
