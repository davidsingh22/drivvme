import React from 'react';
import { motion } from 'framer-motion';
import { MapPin, Home, Briefcase, Building2, Plane } from 'lucide-react';
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
          <div key={i} className="flex-1 animate-pulse h-16 rounded-2xl bg-muted/30" />
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
            className="flex-1 flex items-center gap-3 px-4 py-3.5 rounded-2xl hover:scale-[1.02] transition-all group"
            style={{
              background: 'rgba(30, 30, 40, 0.7)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              border: '1px solid rgba(100, 100, 120, 0.3)',
            }}
          >
            <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
              <Icon className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 text-left min-w-0">
              <p className="font-semibold text-white truncate text-base">
                {shortName}
              </p>
              <p className="text-sm text-white/60 truncate">
                {dest.visit_count}x {language === 'fr' ? 'visite' : 'visited'}
              </p>
            </div>
          </motion.button>
        );
      })}
    </div>
  );
};

export default QuickDestinations;
