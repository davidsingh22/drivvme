import React, { createContext, useContext, useState, useEffect } from 'react';

type Language = 'en' | 'fr';

interface Translations {
  [key: string]: {
    en: string;
    fr: string;
  };
}

const translations: Translations = {
  // Navigation
  'nav.home': { en: 'Home', fr: 'Accueil' },
  'nav.ride': { en: 'Book a Ride', fr: 'Réserver' },
  'nav.drive': { en: 'Drive with Us', fr: 'Conduire' },
  'nav.availableRides': { en: 'Available Rides', fr: 'Trajets disponibles' },
  'nav.history': { en: 'My Rides', fr: 'Mes trajets' },
  'nav.earnings': { en: 'Earnings', fr: 'Revenus' },
  'nav.profile': { en: 'Profile', fr: 'Profil' },
  'nav.login': { en: 'Log In', fr: 'Connexion' },
  'nav.signup': { en: 'Sign Up', fr: 'Inscription' },
  'nav.logout': { en: 'Log Out', fr: 'Déconnexion' },

  // Hero Section
  'hero.title': { en: 'Pay less.', fr: 'Payez moins.' },
  'hero.title2': { en: 'Ride smart.', fr: 'Roulez malin.' },
  'hero.subtitle': { en: 'Fair for riders. Fair for drivers.', fr: 'Juste pour les passagers. Juste pour les conducteurs.' },
  'hero.cta.rider': { en: 'Book a Ride', fr: 'Réserver un trajet' },
  'hero.cta.driver': { en: 'Become a Driver', fr: 'Devenir conducteur' },

  // Features
  'features.savings.title': { en: 'Save 15%', fr: 'Économisez 15%' },
  'features.savings.desc': { en: 'Every ride is 15% cheaper than competitors', fr: 'Chaque trajet est 15% moins cher' },
  'features.fast.title': { en: 'Fast Pickups', fr: 'Ramassage rapide' },
  'features.fast.desc': { en: 'Average pickup time under 5 minutes', fr: 'Temps de ramassage moyen sous 5 minutes' },
  'features.safe.title': { en: 'Safe & Secure', fr: 'Sûr et sécurisé' },
  'features.safe.desc': { en: 'All drivers are verified and rated', fr: 'Tous les conducteurs sont vérifiés' },
  'features.support.title': { en: '24/7 Support', fr: 'Support 24/7' },
  'features.support.desc': { en: 'Help when you need it', fr: 'De l\'aide quand vous en avez besoin' },

  // Booking
  'booking.pickup': { en: 'Pickup location', fr: 'Lieu de ramassage' },
  'booking.dropoff': { en: 'Destination', fr: 'Destination' },
  'booking.estimate': { en: 'Get Estimate', fr: 'Obtenir un devis' },
  'booking.confirm': { en: 'Confirm Ride', fr: 'Confirmer le trajet' },
  'booking.searching': { en: 'Finding your driver...', fr: 'Recherche de conducteur...' },
  'booking.found': { en: 'Driver found!', fr: 'Conducteur trouvé!' },
  'booking.arriving': { en: 'Driver is on the way', fr: 'Le conducteur arrive' },
  'booking.arrived': { en: 'Driver has arrived', fr: 'Le conducteur est arrivé' },
  'booking.inProgress': { en: 'Ride in progress', fr: 'Trajet en cours' },
  'booking.completed': { en: 'Ride completed', fr: 'Trajet terminé' },
  'booking.cancelled': { en: 'Ride cancelled', fr: 'Trajet annulé' },

  // Pricing
  'pricing.estimated': { en: 'Estimated fare', fr: 'Tarif estimé' },
  'pricing.distance': { en: 'Distance', fr: 'Distance' },
  'pricing.duration': { en: 'Duration', fr: 'Durée' },
  'pricing.savings': { en: 'Your savings', fr: 'Vos économies' },

  // Driver
  'driver.goOnline': { en: 'Go Online', fr: 'Se connecter' },
  'driver.goOffline': { en: 'Go Offline', fr: 'Se déconnecter' },
  'driver.accept': { en: 'Accept Ride', fr: 'Accepter' },
  'driver.decline': { en: 'Decline', fr: 'Refuser' },
  'driver.arrived': { en: 'I\'ve Arrived', fr: 'Je suis arrivé' },
  'driver.startRide': { en: 'Start Ride', fr: 'Commencer le trajet' },
  'driver.completeRide': { en: 'Complete Ride', fr: 'Terminer le trajet' },
  'driver.earnings': { en: 'Today\'s Earnings', fr: 'Revenus du jour' },
  'driver.platformFee': { en: 'Platform Fee', fr: 'Frais de plateforme' },
  'driver.yourEarnings': { en: 'Your Earnings', fr: 'Vos revenus' },
  'driver.totalRides': { en: 'Total Rides', fr: 'Total trajets' },

  // Rating
  'rating.title': { en: 'Rate your ride', fr: 'Évaluez votre trajet' },
  'rating.placeholder': { en: 'Leave a comment (optional)', fr: 'Laissez un commentaire (optionnel)' },
  'rating.submit': { en: 'Submit Rating', fr: 'Soumettre' },

  // Auth
  'auth.email': { en: 'Email', fr: 'Courriel' },
  'auth.password': { en: 'Password', fr: 'Mot de passe' },
  'auth.confirmPassword': { en: 'Confirm Password', fr: 'Confirmer le mot de passe' },
  'auth.firstName': { en: 'First Name', fr: 'Prénom' },
  'auth.lastName': { en: 'Last Name', fr: 'Nom' },
  'auth.phone': { en: 'Phone Number', fr: 'Numéro de téléphone' },
  'auth.loginTitle': { en: 'Welcome Back', fr: 'Bon retour' },
  'auth.signupTitle': { en: 'Create Account', fr: 'Créer un compte' },
  'auth.loginBtn': { en: 'Log In', fr: 'Se connecter' },
  'auth.signupBtn': { en: 'Sign Up', fr: 'S\'inscrire' },
  'auth.noAccount': { en: 'Don\'t have an account?', fr: 'Pas de compte?' },
  'auth.hasAccount': { en: 'Already have an account?', fr: 'Déjà un compte?' },
  'auth.signupAs': { en: 'Sign up as', fr: 'S\'inscrire comme' },
  'auth.rider': { en: 'Rider', fr: 'Passager' },
  'auth.driver': { en: 'Driver', fr: 'Conducteur' },

  // Profile
  'profile.title': { en: 'Your Profile', fr: 'Votre profil' },
  'profile.save': { en: 'Save Changes', fr: 'Enregistrer' },
  'profile.language': { en: 'Language', fr: 'Langue' },

  // Common
  'common.loading': { en: 'Loading...', fr: 'Chargement...' },
  'common.error': { en: 'An error occurred', fr: 'Une erreur est survenue' },
  'common.cancel': { en: 'Cancel', fr: 'Annuler' },
  'common.confirm': { en: 'Confirm', fr: 'Confirmer' },
  'common.back': { en: 'Back', fr: 'Retour' },
  'common.next': { en: 'Next', fr: 'Suivant' },
  'common.km': { en: 'km', fr: 'km' },
  'common.min': { en: 'min', fr: 'min' },
};

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguage] = useState<Language>(() => {
    const saved = localStorage.getItem('drivveme-language');
    return (saved as Language) || 'en';
  });

  useEffect(() => {
    localStorage.setItem('drivveme-language', language);
    document.documentElement.lang = language;
  }, [language]);

  const t = (key: string): string => {
    const translation = translations[key];
    if (!translation) {
      console.warn(`Translation missing for key: ${key}`);
      return key;
    }
    return translation[language];
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};