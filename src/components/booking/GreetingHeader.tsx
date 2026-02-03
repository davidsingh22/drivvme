import React from 'react';
import { motion } from 'framer-motion';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';

export const GreetingHeader: React.FC = () => {
  const { language } = useLanguage();
  const { profile } = useAuth();
  
  const firstName = profile?.first_name || '';
  
  // Get time-based greeting
  const getGreeting = () => {
    const hour = new Date().getHours();
    
    if (hour >= 5 && hour < 12) {
      return language === 'fr' ? 'Bon matin' : 'Good morning';
    } else if (hour >= 12 && hour < 17) {
      return language === 'fr' ? 'Bon après-midi' : 'Good afternoon';
    } else if (hour >= 17 && hour < 21) {
      return language === 'fr' ? 'Bonsoir' : 'Good evening';
    } else {
      return language === 'fr' ? 'Bonne nuit' : 'Good night';
    }
  };
  
  // Get day of week greeting
  const getDayGreeting = () => {
    const days = language === 'fr' 
      ? ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']
      : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    const today = new Date().getDay();
    const dayName = days[today];
    
    if (firstName) {
      return language === 'fr' 
        ? `Joyeux ${dayName}, ${firstName}` 
        : `Happy ${dayName}, ${firstName}`;
    }
    
    return language === 'fr' 
      ? `Joyeux ${dayName}` 
      : `Happy ${dayName}`;
  };
  
  const greeting = getDayGreeting();
  
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-4"
    >
      <h1 className="font-display text-2xl md:text-3xl font-bold bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
        {greeting}
      </h1>
      <p className="text-sm text-muted-foreground mt-1">
        {language === 'fr' ? 'Où allons-nous aujourd\'hui?' : 'Where are we headed today?'}
      </p>
    </motion.div>
  );
};

export default GreetingHeader;
