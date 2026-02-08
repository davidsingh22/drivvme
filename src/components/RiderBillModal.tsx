import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { X, MapPin, Navigation, Clock, Ruler, Calendar, Receipt, Tag, Percent, Building2, Car } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { formatCurrency, formatDistance, formatDuration, calculateFare } from '@/lib/pricing';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import Map, { Marker, Source, Layer } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';

interface RideData {
  id: string;
  pickup_address: string;
  dropoff_address: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat: number;
  dropoff_lng: number;
  distance_km: number | null;
  estimated_duration_minutes: number | null;
  estimated_fare: number;
  actual_fare: number | null;
  promo_discount?: number | null;
  subtotal_before_tax?: number | null;
  gst_amount?: number | null;
  qst_amount?: number | null;
  platform_fee: number | null;
  driver_earnings: number | null;
  status: string;
  requested_at: string;
  dropoff_at: string | null;
  driver_id: string | null;
  tip_amount?: number | null;
}

interface DriverInfo {
  first_name: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_color: string | null;
  license_plate: string | null;
}

interface RiderBillModalProps {
  open: boolean;
  onClose: () => void;
  ride: RideData | null;
}

export function RiderBillModal({ open, onClose, ride }: RiderBillModalProps) {
  const { language } = useLanguage();
  const [mapboxToken, setMapboxToken] = useState<string | null>(null);
  const [routeGeoJSON, setRouteGeoJSON] = useState<GeoJSON.LineString | null>(null);
  const [driverInfo, setDriverInfo] = useState<DriverInfo | null>(null);
  const [tipAmount, setTipAmount] = useState<number | null>(null);

  useEffect(() => {
    const fetchToken = async () => {
      const { data } = await supabase.functions.invoke('get-mapbox-token');
      if (data?.token) setMapboxToken(data.token);
    };
    fetchToken();
  }, []);

  useEffect(() => {
    if (!mapboxToken || !ride) return;

    const fetchRoute = async () => {
      try {
        const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${ride.pickup_lng},${ride.pickup_lat};${ride.dropoff_lng},${ride.dropoff_lat}?geometries=geojson&access_token=${mapboxToken}`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.routes?.[0]?.geometry) {
          setRouteGeoJSON(data.routes[0].geometry);
        }
      } catch (err) {
        console.error('Failed to fetch route:', err);
      }
    };
    fetchRoute();
  }, [mapboxToken, ride]);

  useEffect(() => {
    if (!ride?.driver_id) return;

    const fetchDriver = async () => {
      const { data: driverProfile } = await supabase
        .from('driver_profiles')
        .select('vehicle_make, vehicle_model, vehicle_color, license_plate, user_id')
        .eq('user_id', ride.driver_id)
        .single();

      if (driverProfile) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('first_name')
          .eq('user_id', ride.driver_id)
          .single();

        setDriverInfo({
          first_name: profile?.first_name || null,
          vehicle_make: driverProfile.vehicle_make,
          vehicle_model: driverProfile.vehicle_model,
          vehicle_color: driverProfile.vehicle_color,
          license_plate: driverProfile.license_plate,
        });
      }
    };
    fetchDriver();
  }, [ride?.driver_id]);

  // Fetch tip amount from rides table
  useEffect(() => {
    if (!ride?.id) return;
    const tp = ride.tip_amount ?? null;
    if (tp && tp > 0) {
      setTipAmount(tp);
    } else {
      setTipAmount(null);
    }
  }, [ride]);

  if (!ride) return null;

  // Calculate fare breakdown - use stored values if available, otherwise recalculate
  const distance = ride.distance_km || 0;
  const duration = ride.estimated_duration_minutes || 0;
  const fareEstimate = calculateFare(distance, duration);
  
  // Use stored values if they exist (for historical accuracy), otherwise use calculated
  const promoDiscount = ride.promo_discount ?? fareEstimate.promoDiscount;
  const subtotalBeforeTax = ride.subtotal_before_tax ?? fareEstimate.subtotalBeforeTax;
  const gstAmount = ride.gst_amount ?? fareEstimate.gstAmount;
  const qstAmount = ride.qst_amount ?? fareEstimate.qstAmount;
  const totalTax = gstAmount + qstAmount;
  const total = ride.actual_fare || ride.estimated_fare;

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat(language === 'fr' ? 'fr-CA' : 'en-CA', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'completed':
        return language === 'fr' ? 'Terminée' : 'Completed';
      case 'cancelled':
        return language === 'fr' ? 'Annulée' : 'Cancelled';
      default:
        return status;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-success text-success-foreground';
      case 'cancelled':
        return 'bg-destructive text-destructive-foreground';
      default:
        return 'bg-primary text-primary-foreground';
    }
  };

  const centerLat = (ride.pickup_lat + ride.dropoff_lat) / 2;
  const centerLng = (ride.pickup_lng + ride.dropoff_lng) / 2;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto p-0 gap-0">
        {/* Header with Logo */}
        <div className="bg-gradient-to-r from-primary to-accent p-6 text-white rounded-t-lg">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Receipt className="h-6 w-6" />
              <span className="font-display text-xl font-bold">Drivveme</span>
            </div>
            <Badge className={getStatusColor(ride.status)}>
              {getStatusLabel(ride.status)}
            </Badge>
          </div>
          <p className="text-sm opacity-90">{formatDate(ride.requested_at)}</p>
        </div>

        {/* Map Section */}
        <div className="relative h-40 w-full">
          {mapboxToken ? (
            <Map
              mapboxAccessToken={mapboxToken}
              initialViewState={{
                latitude: centerLat,
                longitude: centerLng,
                zoom: 10,
              }}
              style={{ width: '100%', height: '100%' }}
              mapStyle="mapbox://styles/mapbox/dark-v11"
              interactive={false}
            >
              {routeGeoJSON && (
                <Source type="geojson" data={{ type: 'Feature', geometry: routeGeoJSON, properties: {} }}>
                  <Layer
                    id="route-line"
                    type="line"
                    paint={{
                      'line-color': '#a855f7',
                      'line-width': 3,
                      'line-opacity': 0.8,
                    }}
                  />
                </Source>
              )}
              <Marker latitude={ride.pickup_lat} longitude={ride.pickup_lng}>
                <div className="w-5 h-5 rounded-full bg-success border-2 border-white shadow-lg" />
              </Marker>
              <Marker latitude={ride.dropoff_lat} longitude={ride.dropoff_lng}>
                <div className="w-5 h-5 rounded-full bg-destructive border-2 border-white shadow-lg" />
              </Marker>
            </Map>
          ) : (
            <div className="w-full h-full bg-muted flex items-center justify-center">
              <span className="text-muted-foreground text-sm">
                {language === 'fr' ? 'Chargement...' : 'Loading...'}
              </span>
            </div>
          )}
        </div>

        <div className="p-5 space-y-5">
          {/* Trip Details */}
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-success/10 flex items-center justify-center flex-shrink-0">
                <MapPin className="h-4 w-4 text-success" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                  {language === 'fr' ? 'Prise en charge' : 'Pickup'}
                </p>
                <p className="text-sm font-medium truncate">{ride.pickup_address}</p>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-destructive/10 flex items-center justify-center flex-shrink-0">
                <Navigation className="h-4 w-4 text-destructive" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                  {language === 'fr' ? 'Destination' : 'Dropoff'}
                </p>
                <p className="text-sm font-medium truncate">{ride.dropoff_address}</p>
              </div>
            </div>
          </div>

          {/* Trip Stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center gap-2 p-3 bg-muted/30 rounded-lg">
              <Ruler className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">{language === 'fr' ? 'Distance' : 'Distance'}</p>
                <p className="font-semibold">{formatDistance(distance, language)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 p-3 bg-muted/30 rounded-lg">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">{language === 'fr' ? 'Durée' : 'Duration'}</p>
                <p className="font-semibold">{formatDuration(duration, language)}</p>
              </div>
            </div>
          </div>

          {/* Driver Info (if completed) */}
          {driverInfo && ride.status === 'completed' && (
            <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
              <Car className="h-5 w-5 text-muted-foreground" />
              <div className="flex-1">
                <p className="text-sm font-medium">
                  {driverInfo.first_name || (language === 'fr' ? 'Votre chauffeur' : 'Your driver')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {[driverInfo.vehicle_color, driverInfo.vehicle_make, driverInfo.vehicle_model].filter(Boolean).join(' ')}
                  {driverInfo.license_plate && ` • ${driverInfo.license_plate}`}
                </p>
              </div>
            </div>
          )}

          <Separator />

          {/* Fare Breakdown */}
          <div className="space-y-3">
            <h3 className="font-semibold flex items-center gap-2">
              <Receipt className="h-4 w-4" />
              {language === 'fr' ? 'Détail de la facture' : 'Fare Breakdown'}
            </h3>

            {/* Base fare */}
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{language === 'fr' ? 'Tarif de base' : 'Base fare'}</span>
              <span>{formatCurrency(fareEstimate.baseFare + fareEstimate.bookingFee, language)}</span>
            </div>

            {/* Distance */}
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">
                {language === 'fr' ? 'Distance' : 'Distance'} ({formatDistance(distance, language)})
              </span>
              <span>{formatCurrency(fareEstimate.distanceFare, language)}</span>
            </div>

            {/* Time */}
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">
                {language === 'fr' ? 'Temps' : 'Time'} ({formatDuration(duration, language)})
              </span>
              <span>{formatCurrency(fareEstimate.timeFare, language)}</span>
            </div>

            {/* Promotional Discount */}
            <div className="flex justify-between text-sm text-success">
              <span className="flex items-center gap-1">
                <Tag className="h-3 w-3" />
                {language === 'fr' ? 'Promo Drivveme (7.5%)' : 'Drivveme Promo (7.5%)'}
              </span>
              <span>-{formatCurrency(promoDiscount, language)}</span>
            </div>

            <Separator className="my-2" />

            {/* Subtotal before tax */}
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">
                {language === 'fr' ? 'Sous-total' : 'Subtotal'}
              </span>
              <span>{formatCurrency(subtotalBeforeTax, language)}</span>
            </div>

            {/* GST */}
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">
                {language === 'fr' ? 'TPS (5%)' : 'GST (5%)'}
              </span>
              <span>{formatCurrency(gstAmount, language)}</span>
            </div>

            {/* QST */}
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">
                {language === 'fr' ? 'TVQ (9.975%)' : 'QST (9.975%)'}
              </span>
              <span>{formatCurrency(qstAmount, language)}</span>
            </div>

            <Separator className="my-2" />

            {/* Total */}
            <div className="flex justify-between items-center">
              <span className="font-bold text-lg">
                {language === 'fr' ? 'Total' : 'Total'}
              </span>
              <span className="font-bold text-xl text-primary">
                {formatCurrency(total, language)}
              </span>
            </div>

            {/* Tip */}
            {tipAmount != null && tipAmount > 0 && (
              <>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    {language === 'fr' ? 'Pourboire' : 'Tip'}
                  </span>
                  <span>{formatCurrency(tipAmount, language)}</span>
                </div>

                <Separator className="my-2" />

                <div className="flex justify-between items-center">
                  <span className="font-bold text-lg">
                    {language === 'fr' ? 'Total avec pourboire' : 'Total with tip'}
                  </span>
                  <span className="font-bold text-xl text-primary">
                    {formatCurrency(total + tipAmount, language)}
                  </span>
                </div>
              </>
            )}

            {/* Uber vs Drivveme Comparison */}
            <div className="mt-4 p-4 bg-muted/30 rounded-lg border border-border">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm text-muted-foreground">
                  {language === 'fr' ? 'Prix Uber' : 'Uber Price'}
                </span>
                <span className="text-lg line-through text-muted-foreground">
                  {formatCurrency(fareEstimate.uberTotal, language)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-primary">
                  {language === 'fr' ? 'Vous payez' : 'You pay'}
                </span>
                <span className="text-lg font-bold text-primary">
                  {formatCurrency(total, language)}
                </span>
              </div>
            </div>

            {/* Savings badge */}
            {fareEstimate.savings > 0 && (
              <motion.div 
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="flex items-center justify-center gap-2 p-4 bg-accent/10 rounded-lg border border-accent/20"
              >
                <Percent className="h-5 w-5 text-accent" />
                <div className="text-center">
                  <span className="text-lg font-bold text-accent">
                    {language === 'fr' 
                      ? `Économie: ${formatCurrency(fareEstimate.savings, language)}`
                      : `You saved: ${formatCurrency(fareEstimate.savings, language)}`}
                  </span>
                  <p className="text-xs text-accent/80">
                    {language === 'fr' 
                      ? `${fareEstimate.savingsPercent}% moins cher qu'Uber!`
                      : `${fareEstimate.savingsPercent}% cheaper than Uber!`}
                  </p>
                </div>
              </motion.div>
            )}
          </div>

          {/* Close Button */}
          <Button variant="outline" className="w-full" onClick={onClose}>
            {language === 'fr' ? 'Fermer' : 'Close'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
