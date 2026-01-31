import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Calendar, MapPin, Navigation, Clock, DollarSign, Star, CheckCircle, PlayCircle, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { formatCurrency, formatDistance, formatDuration } from '@/lib/pricing';
import Navbar from '@/components/Navbar';
import { useToast } from '@/hooks/use-toast';
import { RideDetailModal } from '@/components/RideDetailModal';

interface Ride {
  id: string;
  pickup_address: string;
  dropoff_address: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat: number;
  dropoff_lng: number;
  distance_km: number;
  estimated_duration_minutes: number;
  estimated_fare: number;
  actual_fare: number | null;
  driver_earnings: number | null;
  platform_fee: number;
  status: string;
  requested_at: string;
  dropoff_at: string | null;
  accepted_at: string | null;
  rider_id: string;
  driver_id: string | null;
}

interface Rating {
  rating: number;
  comment: string | null;
}

const PLATFORM_FEE = 5.00;

const RideHistory = () => {
  const { t, language } = useLanguage();
  const { user, session, isRider, isDriver, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  // Use session user id as fallback (more reliable on iOS resume)
  const currentUserId = session?.user?.id ?? user?.id;

  const [rides, setRides] = useState<Ride[]>([]);
  const [ratings, setRatings] = useState<Record<string, Rating>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'completed' | 'cancelled'>('all');
  const [updatingRideId, setUpdatingRideId] = useState<string | null>(null);
  const [selectedRide, setSelectedRide] = useState<Ride | null>(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);

  // Start Ride action (transition from arrived -> in_progress)
  const startRide = async (ride: Ride, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentUserId || ride.driver_id !== currentUserId) return;

    setUpdatingRideId(ride.id);
    try {
      const { error } = await supabase
        .from('rides')
        .update({
          status: 'in_progress',
          pickup_at: new Date().toISOString(),
        })
        .eq('id', ride.id)
        .eq('driver_id', currentUserId);

      if (error) {
        console.error('Error starting ride:', error);
        toast({ title: 'Error', description: error.message, variant: 'destructive' });
        return;
      }

      toast({
        title: language === 'fr' ? 'Course démarrée!' : 'Ride started!',
        description: language === 'fr' ? 'En route vers la destination.' : 'Heading to destination.',
      });

      // Update local state
      setRides((prev) =>
        prev.map((r) => (r.id === ride.id ? { ...r, status: 'in_progress' } : r))
      );
    } finally {
      setUpdatingRideId(null);
    }
  };

  // End Ride action (transition to completed)
  const endRide = async (ride: Ride, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentUserId || ride.driver_id !== currentUserId) return;

    setUpdatingRideId(ride.id);
    try {
      const driverEarnings = ride.estimated_fare - PLATFORM_FEE;

      const { error } = await supabase
        .from('rides')
        .update({
          status: 'completed',
          dropoff_at: new Date().toISOString(),
          actual_fare: ride.estimated_fare,
          driver_earnings: driverEarnings,
        })
        .eq('id', ride.id)
        .eq('driver_id', currentUserId);

      if (error) {
        console.error('Error ending ride:', error);
        toast({ title: 'Error', description: error.message, variant: 'destructive' });
        return;
      }

      toast({
        title: language === 'fr' ? 'Course terminée!' : 'Ride completed!',
        description: language === 'fr' 
          ? `Vous avez gagné ${formatCurrency(driverEarnings, language)}`
          : `You earned ${formatCurrency(driverEarnings, language)}`,
      });

      // Update local state - move to completed
      setRides((prev) =>
        prev.map((r) => (r.id === ride.id ? { ...r, status: 'completed', driver_earnings: driverEarnings } : r))
      );

      // Switch to completed tab
      setFilter('completed');
    } finally {
      setUpdatingRideId(null);
    }
  };

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/login');
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (!user) return;

    const fetchRides = async () => {
      setIsLoading(true);
      
      let query = supabase
        .from('rides')
        .select('*')
        .order('requested_at', { ascending: false });

      // Filter by user role
      if (isRider && !isDriver) {
        query = query.eq('rider_id', user.id);
      } else if (isDriver && !isRider) {
        query = query.eq('driver_id', user.id);
      } else {
        // Both roles - show all rides where user is involved
        query = query.or(`rider_id.eq.${user.id},driver_id.eq.${user.id}`);
      }

      // Apply status filter
      if (filter === 'completed') {
        query = query.eq('status', 'completed');
      } else if (filter === 'cancelled') {
        query = query.eq('status', 'cancelled');
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching rides:', error);
      } else {
        setRides(data || []);

        // Fetch ratings for completed rides
        if (data && data.length > 0) {
          const completedRideIds = data
            .filter((r) => r.status === 'completed')
            .map((r) => r.id);

          if (completedRideIds.length > 0) {
            const { data: ratingsData } = await supabase
              .from('ratings')
              .select('ride_id, rating, comment')
              .in('ride_id', completedRideIds);

            if (ratingsData) {
              const ratingsMap: Record<string, Rating> = {};
              ratingsData.forEach((r) => {
                ratingsMap[r.ride_id] = { rating: r.rating, comment: r.comment };
              });
              setRatings(ratingsMap);
            }
          }
        }
      }

      setIsLoading(false);
    };

    fetchRides();
  }, [user, isRider, isDriver, filter]);

  // Debug why the driver completion button might not show on some devices.
  // This will help confirm the ride status + ownership conditions.
  useEffect(() => {
    if (!user) return;
    const active = rides.filter((r) => ['arrived', 'in_progress'].includes(r.status));
    if (active.length === 0) return;
    console.debug('[RideHistory] user.id', user.id);
    console.debug(
      '[RideHistory] active rides (arrived/in_progress)',
      active.map((r) => ({ id: r.id, status: r.status, driver_id: r.driver_id, rider_id: r.rider_id }))
    );
  }, [rides, user]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'text-success bg-success/10';
      case 'cancelled':
        return 'text-destructive bg-destructive/10';
      case 'in_progress':
      case 'driver_en_route':
      case 'driver_assigned':
      case 'arrived':
      case 'searching':
        return 'text-primary bg-primary/10';
      default:
        return 'text-muted-foreground bg-muted';
    }
  };

  // Check if a ride is currently active (clickable to view on map)
  const isActiveRide = (status: string) => {
    return ['searching', 'driver_assigned', 'driver_en_route', 'arrived', 'in_progress'].includes(status);
  };

  // Only allow completing when the ride is actually underway.
  const isCompletableRide = (status: string) => {
    return ['arrived', 'in_progress'].includes(status);
  };

  const handleRideClick = (ride: Ride) => {
    if (isActiveRide(ride.status)) {
      // Navigate to the correct live map based on who is viewing.
      // Drivers should never be sent to the rider booking UI.
      if (ride.driver_id && user?.id && ride.driver_id === user.id) {
        navigate('/driver');
      } else {
        // Rider flow - RideBooking will auto-restore the active ride
        navigate('/ride');
      }
    } else {
      // For completed/cancelled rides, open detail modal
      setSelectedRide(ride);
      setDetailModalOpen(true);
    }
  };

  const handleViewDetails = (ride: Ride, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedRide(ride);
    setDetailModalOpen(true);
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'completed':
        return t('booking.completed');
      case 'cancelled':
        return t('booking.cancelled');
      case 'in_progress':
        return t('booking.inProgress');
      case 'searching':
        return t('booking.searching');
      case 'driver_assigned':
      case 'driver_en_route':
        return t('booking.arriving');
      case 'arrived':
        return t('booking.arrived');
      default:
        return status;
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat(language === 'fr' ? 'fr-CA' : 'en-CA', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">{t('common.loading')}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      <div className="pt-24 pb-12 container mx-auto px-4 max-w-3xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <h1 className="font-display text-3xl font-bold mb-8">{t('nav.history')}</h1>

          {/* Filter Tabs */}
          <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)} className="mb-6">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="completed">Completed</TabsTrigger>
              <TabsTrigger value="cancelled">Cancelled</TabsTrigger>
            </TabsList>
          </Tabs>

          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <Card key={i} className="p-6 animate-pulse">
                  <div className="h-4 bg-muted rounded w-1/4 mb-4" />
                  <div className="h-4 bg-muted rounded w-3/4 mb-2" />
                  <div className="h-4 bg-muted rounded w-1/2" />
                </Card>
              ))}
            </div>
          ) : rides.length === 0 ? (
            <Card className="p-12 text-center">
              <Calendar className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="font-display text-xl font-semibold mb-2">No rides yet</h3>
              <p className="text-muted-foreground mb-6">
                {isRider ? 'Book your first ride to see it here' : 'Complete your first ride to see it here'}
              </p>
              <Button onClick={() => navigate(isDriver ? '/driver' : '/ride')} className="gradient-primary">
                {isDriver ? 'Start Driving' : 'Book a Ride'}
              </Button>
            </Card>
          ) : (
            <div className="space-y-4">
              {rides.map((ride, index) => {
                const isActive = isActiveRide(ride.status);
                return (
                  <motion.div
                    key={ride.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                  >
                    <Card 
                      className={`p-6 ${isActive ? 'cursor-pointer border-primary/50 hover:border-primary hover:shadow-lg transition-all ring-2 ring-primary/20' : ''}`}
                      onClick={() => handleRideClick(ride)}
                    >
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Calendar className="h-4 w-4" />
                          {formatDate(ride.requested_at)}
                        </div>
                        <div className="flex items-center gap-2">
                          {isActive && (
                            <motion.div
                              animate={{ scale: [1, 1.2, 1] }}
                              transition={{ duration: 1.5, repeat: Infinity }}
                              className="w-2 h-2 rounded-full bg-primary"
                            />
                          )}
                          <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(ride.status)}`}>
                            {getStatusLabel(ride.status)}
                          </span>
                        </div>
                      </div>

                      {/* Tap to view prompt for active rides */}
                      {isActive && (
                        <div className="mb-4 p-3 bg-primary/10 rounded-lg border border-primary/30">
                          <p className="text-sm text-primary font-medium text-center">
                            {language === 'fr' ? '👆 Appuyez pour voir sur la carte' : '👆 Tap to view on map'}
                          </p>
                        </div>
                      )}

                      {/* ========== DRIVER ACTION BUTTONS ========== */}
                      {/* Show Start Ride / End Ride for the assigned driver */}
                      {ride.driver_id && currentUserId && ride.driver_id === currentUserId && (
                        <div className="mb-4 space-y-2">
                          {/* Start Ride button - show when status is 'arrived' */}
                          {ride.status === 'arrived' && (
                            <Button
                              className="w-full gradient-primary py-5 text-lg font-bold shadow-lg"
                              onClick={(e) => startRide(ride, e)}
                              disabled={updatingRideId === ride.id}
                            >
                              <PlayCircle className="h-6 w-6 mr-2" />
                              {updatingRideId === ride.id
                                ? (language === 'fr' ? 'Démarrage...' : 'Starting...')
                                : (language === 'fr' ? 'Démarrer la course' : 'Start Ride')}
                            </Button>
                          )}

                          {/* End Ride button - show when status is 'in_progress' (or 'arrived' for quick end) */}
                          {['arrived', 'in_progress'].includes(ride.status) && (
                            <Button
                              className="w-full bg-success hover:bg-success/90 py-5 text-lg font-bold shadow-lg"
                              onClick={(e) => endRide(ride, e)}
                              disabled={updatingRideId === ride.id}
                            >
                              <CheckCircle className="h-6 w-6 mr-2" />
                              {updatingRideId === ride.id
                                ? (language === 'fr' ? 'Finalisation...' : 'Completing...')
                                : (language === 'fr' ? 'Terminer la course' : 'End Ride')}
                            </Button>
                          )}

                          {/* Debug info (dev only) */}
                          {import.meta.env.DEV && (
                            <p className="text-xs text-muted-foreground font-mono text-center">
                              status={ride.status}, ride.driver_id={ride.driver_id?.slice(0, 8)}…, me={currentUserId?.slice(0, 8)}…
                            </p>
                          )}
                        </div>
                      )}

                      <div className="space-y-3 mb-4">
                        <div className="flex items-start gap-3">
                          <MapPin className="h-4 w-4 text-primary mt-1" />
                          <p className="text-sm">{ride.pickup_address}</p>
                        </div>
                        <div className="flex items-start gap-3">
                          <Navigation className="h-4 w-4 text-accent mt-1" />
                          <p className="text-sm">{ride.dropoff_address}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
                        <span className="flex items-center gap-1">
                          <Navigation className="h-4 w-4" />
                          {formatDistance(Number(ride.distance_km), language)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-4 w-4" />
                          {formatDuration(ride.estimated_duration_minutes, language)}
                        </span>
                      </div>

                      <div className="flex items-center justify-between pt-4 border-t border-border">
                        <div className="flex items-center gap-2">
                          <DollarSign className="h-5 w-5 text-accent" />
                          <span className="font-bold text-lg">
                            {formatCurrency(Number(ride.actual_fare || ride.estimated_fare), language)}
                          </span>
                          {isDriver && ride.driver_id === user?.id && ride.status === 'completed' && (
                            <span className="text-sm text-muted-foreground">
                              (earned {formatCurrency(Number(ride.driver_earnings), language)})
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-3">
                          {ratings[ride.id] && (
                            <div className="flex items-center gap-1 text-warning">
                              <Star className="h-4 w-4 fill-current" />
                              <span className="font-medium">{ratings[ride.id].rating}</span>
                            </div>
                          )}
                          
                          {/* View Details Button for completed/cancelled rides */}
                          {!isActiveRide(ride.status) && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(e) => handleViewDetails(ride, e)}
                              className="gap-1"
                            >
                              <Eye className="h-4 w-4" />
                              {language === 'fr' ? 'Détails' : 'Details'}
                            </Button>
                          )}
                        </div>
                      </div>
                    </Card>
                  </motion.div>
                );
              })}
            </div>
          )}
        </motion.div>
      </div>

      {/* Ride Detail Modal */}
      <RideDetailModal
        open={detailModalOpen}
        onClose={() => {
          setDetailModalOpen(false);
          setSelectedRide(null);
        }}
        ride={selectedRide}
        rating={selectedRide ? ratings[selectedRide.id] : null}
      />
    </div>
  );
};

export default RideHistory;