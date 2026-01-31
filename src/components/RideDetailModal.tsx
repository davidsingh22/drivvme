import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, MapPin, Navigation, Clock, DollarSign, Ruler, Calendar, Star, TrendingUp, Building } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatCurrency, formatDistance, formatDuration } from '@/lib/pricing';
import { calculatePlatformFee, calculateDriverEarnings } from '@/lib/platformFees';
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
  driver_earnings: number | null;
  platform_fee: number | null;
  status: string;
  requested_at: string;
  dropoff_at: string | null;
  accepted_at: string | null;
}

interface RideDetailModalProps {
  open: boolean;
  onClose: () => void;
  ride: RideData | null;
  rating?: { rating: number; comment: string | null } | null;
}

export function RideDetailModal({ open, onClose, ride, rating }: RideDetailModalProps) {
  const { language } = useLanguage();
  const [mapboxToken, setMapboxToken] = useState<string | null>(null);
  const [routeGeoJSON, setRouteGeoJSON] = useState<GeoJSON.LineString | null>(null);

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

  if (!ride) return null;

  const fare = ride.actual_fare || ride.estimated_fare;
  const platformFee = ride.platform_fee || calculatePlatformFee(fare);
  const driverEarnings = ride.driver_earnings || calculateDriverEarnings(fare);
  const distance = ride.distance_km || 0;
  const duration = ride.estimated_duration_minutes || 0;

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat(language === 'fr' ? 'fr-CA' : 'en-CA', {
      weekday: 'long',
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
      case 'in_progress':
        return language === 'fr' ? 'En cours' : 'In Progress';
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

  // Calculate center and bounds for the map
  const centerLat = (ride.pickup_lat + ride.dropoff_lat) / 2;
  const centerLng = (ride.pickup_lng + ride.dropoff_lng) / 2;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0 gap-0">
        {/* Map Section */}
        <div className="relative h-48 sm:h-64 w-full rounded-t-lg overflow-hidden">
          {mapboxToken ? (
            <Map
              mapboxAccessToken={mapboxToken}
              initialViewState={{
                latitude: centerLat,
                longitude: centerLng,
                zoom: 11,
              }}
              style={{ width: '100%', height: '100%' }}
              mapStyle="mapbox://styles/mapbox/dark-v11"
              interactive={false}
            >
              {/* Route Line */}
              {routeGeoJSON && (
                <Source type="geojson" data={{ type: 'Feature', geometry: routeGeoJSON, properties: {} }}>
                  <Layer
                    id="route-line"
                    type="line"
                    paint={{
                      'line-color': '#a855f7',
                      'line-width': 4,
                      'line-opacity': 0.8,
                    }}
                  />
                </Source>
              )}
              
              {/* Pickup Marker */}
              <Marker latitude={ride.pickup_lat} longitude={ride.pickup_lng}>
                <div className="w-6 h-6 rounded-full bg-success border-2 border-white shadow-lg flex items-center justify-center">
                  <div className="w-2 h-2 rounded-full bg-white" />
                </div>
              </Marker>
              
              {/* Dropoff Marker */}
              <Marker latitude={ride.dropoff_lat} longitude={ride.dropoff_lng}>
                <div className="w-6 h-6 rounded-full bg-destructive border-2 border-white shadow-lg flex items-center justify-center">
                  <div className="w-2 h-2 rounded-full bg-white" />
                </div>
              </Marker>
            </Map>
          ) : (
            <div className="w-full h-full bg-muted flex items-center justify-center">
              <span className="text-muted-foreground">{language === 'fr' ? 'Chargement de la carte...' : 'Loading map...'}</span>
            </div>
          )}
          
          {/* Status Badge Overlay */}
          <div className="absolute top-3 left-3">
            <Badge className={getStatusColor(ride.status)}>
              {getStatusLabel(ride.status)}
            </Badge>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Date & Time */}
          <div className="flex items-center gap-2 text-muted-foreground">
            <Calendar className="h-4 w-4" />
            <span className="text-sm">{formatDate(ride.requested_at)}</span>
          </div>

          {/* Locations */}
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-success/10 flex items-center justify-center flex-shrink-0">
                <MapPin className="h-5 w-5 text-success" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">{language === 'fr' ? 'Prise en charge' : 'Pickup'}</p>
                <p className="font-medium">{ride.pickup_address}</p>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center flex-shrink-0">
                <Navigation className="h-5 w-5 text-destructive" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">{language === 'fr' ? 'Destination' : 'Dropoff'}</p>
                <p className="font-medium">{ride.dropoff_address}</p>
              </div>
            </div>
          </div>

          {/* Trip Stats */}
          <div className="grid grid-cols-2 gap-4">
            <Card className="p-4 bg-muted/30">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Ruler className="h-4 w-4" />
                <span className="text-xs uppercase tracking-wide">{language === 'fr' ? 'Distance' : 'Distance'}</span>
              </div>
              <p className="text-2xl font-bold">{formatDistance(distance, language)}</p>
            </Card>
            
            <Card className="p-4 bg-muted/30">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Clock className="h-4 w-4" />
                <span className="text-xs uppercase tracking-wide">{language === 'fr' ? 'Durée' : 'Duration'}</span>
              </div>
              <p className="text-2xl font-bold">{formatDuration(duration, language)}</p>
            </Card>
          </div>

          {/* Earnings Breakdown */}
          <Card className="p-5 bg-gradient-to-br from-success/10 to-success/5 border-success/20">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-success" />
              {language === 'fr' ? 'Résumé des gains' : 'Earnings Breakdown'}
            </h3>
            
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">{language === 'fr' ? 'Tarif total' : 'Total Fare'}</span>
                <span className="font-semibold text-lg">{formatCurrency(fare, language)}</span>
              </div>
              
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Building className="h-4 w-4" />
                  {language === 'fr' ? 'Frais Drivveme' : 'Drivveme Fee'}
                </span>
                <span className="text-destructive">-{formatCurrency(platformFee, language)}</span>
              </div>
              
              <div className="border-t border-border pt-3 flex justify-between items-center">
                <span className="font-semibold text-lg">{language === 'fr' ? 'Vos gains' : 'Your Earnings'}</span>
                <span className="font-bold text-2xl text-success">{formatCurrency(driverEarnings, language)}</span>
              </div>
            </div>
          </Card>

          {/* Rating (if completed and rated) */}
          {ride.status === 'completed' && rating && (
            <Card className="p-4 bg-muted/30">
              <div className="flex items-center gap-2 mb-2">
                <Star className="h-5 w-5 text-accent fill-accent" />
                <span className="font-semibold">{language === 'fr' ? 'Évaluation du passager' : 'Rider Rating'}</span>
              </div>
              <div className="flex items-center gap-1 mb-2">
                {[1, 2, 3, 4, 5].map((star) => (
                  <Star
                    key={star}
                    className={`h-5 w-5 ${star <= rating.rating ? 'text-accent fill-accent' : 'text-muted'}`}
                  />
                ))}
                <span className="ml-2 font-semibold">{rating.rating}/5</span>
              </div>
              {rating.comment && (
                <p className="text-sm text-muted-foreground italic">"{rating.comment}"</p>
              )}
            </Card>
          )}

          {/* Close Button */}
          <Button variant="outline" className="w-full" onClick={onClose}>
            {language === 'fr' ? 'Fermer' : 'Close'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
