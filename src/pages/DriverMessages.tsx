import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { MessageSquare, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import RideChat from '@/components/RideChat';
import Navbar from '@/components/Navbar';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';

interface ActiveRide {
  id: string;
  rider_id: string;
  status: string;
  pickup_address: string;
  dropoff_address: string;
}

export default function DriverMessages() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, session, authLoading } = useAuth();
  const { language } = useLanguage();
  const [activeRide, setActiveRide] = useState<ActiveRide | null>(null);
  const [riderName, setRiderName] = useState<string>('Rider');
  const [isLoading, setIsLoading] = useState(true);

  const rideIdParam = searchParams.get('rideId');

  // Fetch active ride for the driver
  useEffect(() => {
    if (authLoading) return;
    if (!session?.user?.id) {
      navigate('/login', { replace: true });
      return;
    }

    const fetchActiveRide = async () => {
      setIsLoading(true);

      // If rideId is provided, fetch that specific ride
      if (rideIdParam) {
        const { data, error } = await supabase
          .from('rides')
          .select('id, rider_id, status, pickup_address, dropoff_address')
          .eq('id', rideIdParam)
          .eq('driver_id', session.user.id)
          .maybeSingle();

        if (!error && data) {
          setActiveRide(data);
          
          // Fetch rider name
          const { data: profile } = await supabase
            .from('profiles')
            .select('first_name, last_name')
            .eq('user_id', data.rider_id)
            .single();
          
          if (profile) {
            setRiderName(`${profile.first_name || ''} ${profile.last_name?.[0] || ''}.`.trim() || 'Rider');
          }
        }
      } else {
        // No rideId param - find any active ride for this driver
        const { data, error } = await supabase
          .from('rides')
          .select('id, rider_id, status, pickup_address, dropoff_address')
          .eq('driver_id', session.user.id)
          .in('status', ['driver_assigned', 'driver_en_route', 'arrived', 'in_progress'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!error && data) {
          setActiveRide(data);
          
          // Fetch rider name
          const { data: profile } = await supabase
            .from('profiles')
            .select('first_name, last_name')
            .eq('user_id', data.rider_id)
            .single();
          
          if (profile) {
            setRiderName(`${profile.first_name || ''} ${profile.last_name?.[0] || ''}.`.trim() || 'Rider');
          }
        }
      }

      setIsLoading(false);
    };

    fetchActiveRide();
  }, [session?.user?.id, authLoading, rideIdParam, navigate]);

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="pt-20 px-4 flex items-center justify-center">
          <div className="animate-pulse text-muted-foreground">
            {language === 'fr' ? 'Chargement...' : 'Loading...'}
          </div>
        </div>
      </div>
    );
  }

  // No active ride
  if (!activeRide) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="pt-20 px-4 pb-8">
          <div className="max-w-lg mx-auto">
            <Button
              variant="ghost"
              className="mb-4 gap-2"
              onClick={() => navigate('/driver')}
            >
              <ArrowLeft className="h-4 w-4" />
              {language === 'fr' ? 'Retour' : 'Back'}
            </Button>

            <Card className="p-8 text-center">
              <MessageSquare className="h-16 w-16 mx-auto mb-4 text-muted-foreground/30" />
              <h2 className="text-xl font-semibold mb-2">
                {language === 'fr' ? 'Aucune course active' : 'No Active Ride'}
              </h2>
              <p className="text-muted-foreground">
                {language === 'fr'
                  ? 'Les messages sont disponibles uniquement pendant une course.'
                  : 'Messages are available only during a trip.'}
              </p>
              <Button
                className="mt-6"
                onClick={() => navigate('/driver')}
              >
                {language === 'fr' ? 'Retourner au tableau de bord' : 'Return to Dashboard'}
              </Button>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      <RideChat
        rideId={activeRide.id}
        rideStatus={activeRide.status}
        role="driver"
        otherPartyName={riderName}
        onClose={() => navigate('/driver')}
      />
    </div>
  );
}
