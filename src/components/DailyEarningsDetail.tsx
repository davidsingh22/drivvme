import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronUp, MapPin, Navigation, DollarSign, Clock, ArrowDown } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { formatCurrency } from '@/lib/pricing';
import { calculatePlatformFee } from '@/lib/platformFees';
import { useLanguage } from '@/contexts/LanguageContext';
import { format } from 'date-fns';

interface Ride {
  id: string;
  pickup_address: string;
  dropoff_address: string;
  subtotal_before_tax: number | null;
  driver_earnings: number | null;
  platform_fee: number | null;
  gst_amount: number | null;
  qst_amount: number | null;
  actual_fare: number | null;
  dropoff_at: string;
  distance_km: number | null;
  estimated_duration_minutes: number | null;
}

interface DailyEarningsDetailProps {
  date: string;
  earnings: number;
  rides: number;
  fares: number;
  driverId: string;
}

export function DailyEarningsDetail({ 
  date, 
  earnings, 
  rides: rideCount, 
  fares, 
  driverId 
}: DailyEarningsDetailProps) {
  const { language } = useLanguage();
  const [isExpanded, setIsExpanded] = useState(false);
  const [rideDetails, setRideDetails] = useState<Ride[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isExpanded && rideDetails.length === 0) {
      fetchRideDetails();
    }
  }, [isExpanded]);

  const fetchRideDetails = async () => {
    setIsLoading(true);
    
    // Parse date and create range
    const [year, month, day] = date.split('-').length === 3 
      ? date.split('-').map(Number) 
      : [0, 0, 0];
    
    // Handle different date formats
    let startDate: Date;
    let endDate: Date;
    
    if (year && month && day) {
      startDate = new Date(year, month - 1, day, 0, 0, 0);
      endDate = new Date(year, month - 1, day, 23, 59, 59);
    } else {
      // Try parsing as locale date string
      const parsed = new Date(date);
      if (!isNaN(parsed.getTime())) {
        startDate = new Date(parsed.setHours(0, 0, 0, 0));
        endDate = new Date(parsed.setHours(23, 59, 59, 999));
      } else {
        setIsLoading(false);
        return;
      }
    }

    const { data, error } = await supabase
      .from('rides')
      .select('id, pickup_address, dropoff_address, subtotal_before_tax, driver_earnings, platform_fee, gst_amount, qst_amount, actual_fare, dropoff_at, distance_km, estimated_duration_minutes')
      .eq('driver_id', driverId)
      .eq('status', 'completed')
      .gte('dropoff_at', startDate.toISOString())
      .lte('dropoff_at', endDate.toISOString())
      .order('dropoff_at', { ascending: false });

    if (!error && data) {
      setRideDetails(data);
    }
    setIsLoading(false);
  };

  

  return (
    <Card 
      className={`overflow-hidden transition-all cursor-pointer ${isExpanded ? 'border-primary/30' : ''}`}
      onClick={() => setIsExpanded(!isExpanded)}
    >
      <div className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <DollarSign className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="font-medium">{date}</p>
              <p className="text-sm text-muted-foreground">{rideCount} {language === 'fr' ? 'courses' : 'rides'}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <p className="font-bold text-lg text-accent">
              {formatCurrency(earnings, language)}
            </p>
            {isExpanded ? (
              <ChevronUp className="h-5 w-5 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-t border-border bg-muted/30 p-4 space-y-4">
              {/* Daily Summary - Only show Fares and Earnings */}
              <div className="grid grid-cols-2 gap-3 text-center">
                <div className="bg-background rounded-lg p-3">
                  <p className="text-xs text-muted-foreground">{language === 'fr' ? 'Tarifs totaux' : 'Total Fares'}</p>
                  <p className="font-bold text-foreground">{formatCurrency(fares, language)}</p>
                </div>
                <div className="bg-background rounded-lg p-3">
                  <p className="text-xs text-muted-foreground">{language === 'fr' ? 'Vos gains' : 'Your Earnings'}</p>
                  <p className="font-bold text-accent">{formatCurrency(earnings, language)}</p>
                </div>
              </div>

              {/* Ride Details */}
              {isLoading ? (
                <div className="text-center py-4 text-muted-foreground">
                  {language === 'fr' ? 'Chargement...' : 'Loading...'}
                </div>
              ) : rideDetails.length > 0 ? (
                <div className="space-y-3">
                  <h4 className="font-medium text-sm text-muted-foreground">
                    {language === 'fr' ? 'Détails des courses' : 'Ride Details'}
                  </h4>
                  {rideDetails.map((ride, index) => {
                    // Show subtotal before tax (fare without Quebec taxes) to drivers
                    const fareBeforeTax = Number(ride.subtotal_before_tax) || 0;
                    const platformFee = Number(ride.platform_fee) || calculatePlatformFee(fareBeforeTax);
                    const gstAmount = Number(ride.gst_amount) || 0;
                    const qstAmount = Number(ride.qst_amount) || 0;
                    const tripTotal = Number(ride.actual_fare) || (fareBeforeTax + gstAmount + qstAmount);
                    // Always recalculate driver earnings from fare - platform fee to ensure accuracy
                    const driverEarnings = fareBeforeTax - platformFee;
                    
                    return (
                      <motion.div
                        key={ride.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.05 }}
                        className="bg-background rounded-lg p-3 space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <Badge variant="secondary" className="text-xs">
                            <Clock className="h-3 w-3 mr-1" />
                            {format(new Date(ride.dropoff_at), 'HH:mm')}
                          </Badge>
                          <span className="font-bold text-accent">{formatCurrency(driverEarnings, language)}</span>
                        </div>
                        
                        <div className="space-y-1 text-sm">
                          <div className="flex items-start gap-2">
                            <MapPin className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                            <span className="line-clamp-1">{ride.pickup_address}</span>
                          </div>
                          <div className="flex items-start gap-2">
                            <Navigation className="h-4 w-4 text-accent flex-shrink-0 mt-0.5" />
                            <span className="line-clamp-1">{ride.dropoff_address}</span>
                          </div>
                        </div>

                        {/* Full breakdown with Quebec taxes */}
                        <div className="pt-2 border-t border-border/50 space-y-1">
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">{language === 'fr' ? 'Sous-total' : 'Subtotal'}</span>
                            <span>{formatCurrency(fareBeforeTax, language)}</span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">{language === 'fr' ? 'TPS (5%)' : 'GST (5%)'}</span>
                            <span>{formatCurrency(gstAmount, language)}</span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">{language === 'fr' ? 'TVQ (9.975%)' : 'QST (9.975%)'}</span>
                            <span>{formatCurrency(qstAmount, language)}</span>
                          </div>
                          <div className="flex justify-between text-xs font-medium pt-1 border-t border-border/30">
                            <span>{language === 'fr' ? 'Total course' : 'Trip Total'}</span>
                            <span>{formatCurrency(tripTotal, language)}</span>
                          </div>
                          <div className="flex justify-between text-xs pt-1">
                            <span className="text-destructive">{language === 'fr' ? 'Frais Drivveme' : 'Drivveme Fee'}</span>
                            <span className="text-destructive">-{formatCurrency(platformFee, language)}</span>
                          </div>
                          <div className="flex justify-between text-sm font-bold pt-1 border-t border-border/30">
                            <span className="text-accent">{language === 'fr' ? 'Vos gains' : 'Your Earnings'}</span>
                            <span className="text-accent">{formatCurrency(driverEarnings, language)}</span>
                          </div>
                        </div>

                        {ride.distance_km && (
                          <div className="text-xs text-muted-foreground">
                            {ride.distance_km.toFixed(1)} km • {ride.estimated_duration_minutes || '--'} min
                          </div>
                        )}
                      </motion.div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-4 text-muted-foreground text-sm">
                  {language === 'fr' ? 'Aucune course trouvée' : 'No rides found'}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}
