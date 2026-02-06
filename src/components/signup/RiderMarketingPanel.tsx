import { Shield, ShieldCheck, MessageCircle, MapPin, Users } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import riderHeroImage from '@/assets/signup-rider-hero.png';

const RiderMarketingPanel = () => {
  const { language } = useLanguage();
  const isFrench = language === 'fr';

  const content = {
    en: {
      headline: 'Your Safety',
      headlineAccent: 'Is Our Priority',
      subheadline: 'Why Riders Choose Drivveme',
      features: [
        { icon: ShieldCheck, text: 'Background Checked Drivers', accent: '' },
        { icon: MessageCircle, text: 'Personal Interviews Required', accent: '' },
        { icon: Users, text: 'Women & Teen Safety Is', accent: '#1 Priority' },
        { icon: MapPin, text: 'Live Ride Monitoring by Real People', accent: '' },
        { icon: Shield, text: 'Strict Standards & Human Oversight', accent: '' },
      ],
      notJust: 'Not just anyone',
      canDrive: 'can drive for Drivveme.',
      allDrivers: 'All drivers pass background checks and personal interviews.',
      safetyTitle: 'Safety of Women & Teens is Our',
      safetyAccent: '#1 Priority',
      safetyDesc: 'Every ride is live monitored. Our team ensures all passengers—especially women and teens—arrive safe and sound.',
      trustTitle: 'Drivveme',
      trustText: 'is built on trust:',
      saferChoice: 'a safer choice',
      forYou: ', for you and your loved ones.',
    },
    fr: {
      headline: 'Votre Sécurité',
      headlineAccent: 'Est Notre Priorité',
      subheadline: 'Pourquoi les passagers choisissent Drivveme',
      features: [
        { icon: ShieldCheck, text: 'Chauffeurs Vérifiés', accent: '' },
        { icon: MessageCircle, text: 'Entrevues Personnelles Obligatoires', accent: '' },
        { icon: Users, text: 'Sécurité des Femmes & des Ados =', accent: 'Priorité #1' },
        { icon: MapPin, text: 'Trajets Suivis en Direct par des Employés Réels', accent: '' },
        { icon: Shield, text: 'Normes Strictes & Surveillance Humaine', accent: '' },
      ],
      notJust: "Pas n'importe qui",
      canDrive: 'ne peut devenir chauffeur Drivveme.',
      allDrivers: 'Tous les chauffeurs passent des vérifications d\'antécédents et des entrevues personnelles.',
      safetyTitle: 'La Sécurité des Femmes & des Ados',
      safetyAccent: 'Est Notre Priorité #1',
      safetyDesc: 'Tous les trajets sont suivis en direct. Nos employés s\'assurent que tous les passagers—surtout les femmes et ados—arrivent sains et saufs.',
      trustTitle: 'Drivveme',
      trustText: 'est fondé sur la confiance :',
      saferChoice: 'un choix plus sûr',
      forYou: ', pour vous et vos proches.',
    },
  };

  const t = isFrench ? content.fr : content.en;

  return (
    <div 
      className="relative h-full w-full overflow-hidden rounded-2xl"
      style={{
        backgroundImage: `url(${riderHeroImage})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      {/* Gradient overlay for readability */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/40 to-black/70" />
      
      <div className="relative z-10 flex flex-col h-full p-8 text-white">
        {/* Main headline */}
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-lg bg-primary/20 backdrop-blur-sm border border-primary/30">
            <Shield className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold">
            <span className="text-primary">{t.headline}</span>{' '}
            <span className="text-white">{t.headlineAccent}</span>
          </h1>
        </div>

        {/* Subheadline */}
        <h2 className="text-xl font-semibold mb-4 text-white/90">{t.subheadline}</h2>

        {/* Feature list */}
        <div className="space-y-3 mb-6">
          {t.features.map((feature, index) => (
            <div key={index} className="flex items-center gap-3">
              <div className="p-1.5 rounded-md bg-primary/20 backdrop-blur-sm">
                <feature.icon className="h-5 w-5 text-emerald-400" />
              </div>
              <span className="text-base">
                {feature.text}
                {feature.accent && <span className="text-primary font-semibold"> {feature.accent}</span>}
              </span>
            </div>
          ))}
        </div>

        {/* Not just anyone section */}
        <div className="mb-4">
          <p className="text-lg">
            <span className="font-bold">{t.notJust}</span>{' '}
            <span>{t.canDrive}</span>
          </p>
          <p className="text-sm text-white/80 mt-1">{t.allDrivers}</p>
        </div>

        {/* Divider */}
        <div className="border-t border-white/20 my-4" />

        {/* Safety priority section */}
        <div className="mb-4">
          <h3 className="text-lg font-semibold">
            {t.safetyTitle}{' '}
            <span className="text-primary">{t.safetyAccent}</span>
          </h3>
          <p className="text-sm text-white/80 mt-1">{t.safetyDesc}</p>
        </div>

        {/* Trust statement - pushed to bottom */}
        <div className="mt-auto pt-4">
          <p className="text-lg">
            <span className="font-bold text-primary">{t.trustTitle}</span>{' '}
            <span>{t.trustText}</span>
          </p>
          <p className="text-lg">
            <span className="text-primary font-semibold">{t.saferChoice}</span>
            <span>{t.forYou}</span>
          </p>
        </div>
      </div>
    </div>
  );
};

export default RiderMarketingPanel;
