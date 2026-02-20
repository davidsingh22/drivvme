import React from 'react';
import { motion } from 'framer-motion';
import { MapPin, Clock, Navigation } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';

interface RecentDestination {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  visit_count: number;
  last_visited_at: string;
}

interface RecentDestinationsProps {
  onSelectDestination: (destination: { address: string; lat: number; lng: number }) => void;
}

export const RecentDestinations: React.FC<RecentDestinationsProps> = ({ onSelectDestination }) => {
  const { language } = useLanguage();
  const { user } = useAuth();

  const { data: destinations = [], isLoading } = useQuery({
    queryKey: ['recent-destinations', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      
      const { data, error } = await supabase
        .from('rider_destinations')
        .select('*')
        .eq('user_id', user.id)
        .order('last_visited_at', { ascending: false })
        .limit(3);
      
      if (error) {
        console.error('Error fetching recent destinations:', error);
        return [];
      }
      
      return data as RecentDestination[];
    },
    enabled: !!user?.id,
    staleTime: 60000, // 1 minute
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="animate-pulse flex items-center gap-3 p-3 rounded-lg bg-muted/50">
            <div className="h-10 w-10 rounded-full bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-24 bg-muted rounded" />
              <div className="h-3 w-32 bg-muted rounded" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (destinations.length === 0) {
    return null;
  }

  // Get icon based on destination name
  const getDestinationIcon = (name: string) => {
    const lowerName = name.toLowerCase();
    if (lowerName.includes('airport') || lowerName.includes('aéroport')) {
      return '✈️';
    }
    if (lowerName.includes('work') || lowerName.includes('travail') || lowerName.includes('bureau')) {
      return '💼';
    }
    if (lowerName.includes('home') || lowerName.includes('maison') || lowerName.includes('domicile')) {
      return '🏠';
    }
    if (lowerName.includes('gym') || lowerName.includes('sport') || lowerName.includes('fitness')) {
      return '🏋️';
    }
    if (lowerName.includes('restaurant') || lowerName.includes('café') || lowerName.includes('bar')) {
      return '🍽️';
    }
    if (lowerName.includes('hotel') || lowerName.includes('hôtel')) {
      return '🏨';
    }
    return null;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-2"
    >
      <div className="flex items-center gap-2 mb-3">
        <Clock className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium text-muted-foreground">
          {language === 'fr' ? 'Destinations récentes' : 'Recent destinations'}
        </span>
      </div>

      <div className="space-y-1">
        {destinations.map((dest, index) => {
          const icon = getDestinationIcon(dest.name);
          
          return (
            <motion.button
              key={dest.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.1 }}
              onClick={() => onSelectDestination({ 
                address: dest.address, 
                lat: dest.lat, 
                lng: dest.lng 
              })}
              className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-muted/80 transition-colors text-left group"
            >
              <div className="flex-shrink-0 h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                {icon ? (
                  <span className="text-lg">{icon}</span>
                ) : (
                  <MapPin className="h-5 w-5 text-primary" />
                )}
              </div>
              
              <div className="flex-1 min-w-0">
                <p className="font-medium text-foreground truncate">
                  {dest.name}
                </p>
                <p className="text-sm text-muted-foreground truncate">
                  {dest.address}
                </p>
              </div>

              {dest.visit_count > 1 && (
                <div className="flex-shrink-0 px-2 py-1 rounded-full bg-muted text-xs text-muted-foreground">
                  {dest.visit_count}x
                </div>
              )}
              
              <Navigation className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </motion.button>
          );
        })}
      </div>
    </motion.div>
  );
};

export default RecentDestinations;
