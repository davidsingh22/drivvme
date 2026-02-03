import React from 'react';
import { motion } from 'framer-motion';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';

export const GreetingHeader: React.FC = () => {
  const { language } = useLanguage();
  const { profile } = useAuth();
  
  const firstName = profile?.first_name || '';
  
  // Simple greeting based on time of day
  const getGreeting = () => {
    const hour = new Date().getHours();
    
    if (hour >= 5 && hour < 18) {
      return language === 'fr' ? 'Bonjour' : 'Hello';
    } else {
      return language === 'fr' ? 'Bonsoir' : 'Good evening';
    }
  };
  
  const greeting = firstName ? `${getGreeting()}, ${firstName}` : getGreeting();
  
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-2"
    >
      <h1 className="text-2xl md:text-3xl font-bold text-foreground">
        {greeting}
      </h1>
      <p className="text-base text-muted-foreground mt-1">
        {language === 'fr' ? "Où allons-nous aujourd'hui ?" : 'Where are we headed today?'}
      </p>
    </motion.div>
  );
};

export default GreetingHeader;
