import React from 'react';
import { motion } from 'framer-motion';
import { MapPin, Home, Briefcase, Building2, Plane, ArrowRight } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';

interface QuickDestination {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  visit_count: number;
}

interface QuickDestinationsProps {
  onSelectDestination: (destination: { address: string; lat: number; lng: number }) => void;
}

export const QuickDestinations: React.FC<QuickDestinationsProps> = ({ onSelectDestination }) => {
  const { language } = useLanguage();
  const { user } = useAuth();

  const { data: destinations = [], isLoading } = useQuery({
    queryKey: ['quick-destinations', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      
      const { data, error } = await supabase
        .from('rider_destinations')
        .select('*')
        .eq('user_id', user.id)
        .order('visit_count', { ascending: false })
        .limit(2);
      
      if (error) {
        console.error('Error fetching quick destinations:', error);
        return [];
      }
      
      return data as QuickDestination[];
    },
    enabled: !!user?.id,
    staleTime: 60000,
  });

  // Get icon based on destination name
  const getDestinationIcon = (name: string) => {
    const lowerName = name.toLowerCase();
    if (lowerName.includes('airport') || lowerName.includes('aéroport') || lowerName.includes('yul') || lowerName.includes('trudeau')) {
      return Plane;
    }
    if (lowerName.includes('work') || lowerName.includes('travail') || lowerName.includes('bureau') || lowerName.includes('office')) {
      return Briefcase;
    }
    if (lowerName.includes('home') || lowerName.includes('maison') || lowerName.includes('domicile')) {
      return Home;
    }
    if (lowerName.includes('casino') || lowerName.includes('hotel') || lowerName.includes('hôtel')) {
      return Building2;
    }
    return MapPin;
  };

  // Get short display name
  const getShortName = (name: string): string => {
    const lowerName = name.toLowerCase();
    if (lowerName.includes('airport') || lowerName.includes('aéroport') || lowerName.includes('yul') || lowerName.includes('trudeau')) {
      return language === 'fr' ? 'Aéroport' : 'Airport';
    }
    if (lowerName.includes('work') || lowerName.includes('travail') || lowerName.includes('bureau') || lowerName.includes('office')) {
      return language === 'fr' ? 'Travail' : 'Work';
    }
    if (lowerName.includes('home') || lowerName.includes('maison') || lowerName.includes('domicile')) {
      return language === 'fr' ? 'Maison' : 'Home';
    }
    if (lowerName.includes('casino')) {
      return 'Casino';
    }
    // Return first word or truncated name
    const parts = name.split(/[\s,]/);
    return parts[0]?.substring(0, 12) || name.substring(0, 12);
  };

  if (isLoading) {
    return (
      <div className="flex gap-3">
        {[1, 2].map((i) => (
          <div key={i} className="flex-1 animate-pulse h-14 rounded-xl bg-muted/50" />
        ))}
      </div>
    );
  }

  if (destinations.length === 0) {
    return null;
  }

  return (
    <div className="flex gap-3">
      {destinations.map((dest, index) => {
        const Icon = getDestinationIcon(dest.name);
        const shortName = getShortName(dest.name);
        
        return (
          <motion.button
            key={dest.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            onClick={() => onSelectDestination({ 
              address: dest.address, 
              lat: dest.lat, 
              lng: dest.lng 
            })}
            className="flex-1 flex items-center gap-3 px-4 py-3 rounded-xl bg-card/95 backdrop-blur-md border border-border/50 shadow-lg hover:bg-card hover:shadow-xl transition-all group"
          >
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
              <Icon className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 text-left min-w-0">
              <p className="font-semibold text-foreground truncate">
                {shortName}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {dest.visit_count}x {language === 'fr' ? 'visité' : 'visited'}
              </p>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          </motion.button>
        );
      })}
    </div>
  );
};

export default QuickDestinations;
