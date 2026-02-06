import { Shield } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import drivemeGirlsHero from '@/assets/driveme-girls-hero.png';

const RiderMarketingPanel = () => {
  const { language } = useLanguage();
  const isFrench = language === 'fr';

  const content = {
    en: {
      headline: 'Your Safety',
      headlineAccent: 'Is Our Priority',
      subheadline: 'Why Riders Choose Drivveme',
      features: [
        { emoji: '✅', text: 'Background Checked Drivers' },
        { emoji: '🎤', text: 'Personal Interviews Required' },
        { emoji: '👩', text: 'Women & Teen Safety Is', accent: '#1 Priority' },
        { emoji: '📍', text: 'Live Ride Monitoring by Real People' },
        { emoji: '✅', text: 'Strict Standards & Human Oversight' },
      ],
      warningTitle: 'Not just anyone can drive for',
      warningBrand: 'Drivveme.',
      warningDesc: 'All drivers pass background checks and personal interviews.',
      safetyTitle: 'Safety of Women & Teens is Our',
      safetyAccent: '#1 Priority',
      safetyDesc: 'Every ride is live monitored. Our team ensures all passengers—especially women and teens—arrive safe and sound.',
      trustBrand: 'Drivveme',
      trustLine1: 'is built on',
      trustBold: 'trust:',
      trustLine2: 'a',
      trustAccent: 'safer choice',
      trustLine3: ', for you and your loved ones.',
    },
    fr: {
      headline: 'Votre Sécurité',
      headlineAccent: 'Est Notre Priorité',
      subheadline: 'Pourquoi les passagers choisissent Drivveme',
      features: [
        { emoji: '✅', text: 'Chauffeurs Vérifiés' },
        { emoji: '🎤', text: 'Entrevues Personnelles Obligatoires' },
        { emoji: '👩', text: 'Sécurité des Femmes & des Ados =', accent: 'Priorité #1' },
        { emoji: '📍', text: 'Trajets Suivis en Direct par des Employés Réels' },
        { emoji: '✅', text: 'Normes Strictes & Surveillance Humaine' },
      ],
      warningTitle: "Pas n'importe qui ne peut devenir chauffeur",
      warningBrand: 'Drivveme.',
      warningDesc: "Tous les chauffeurs passent des vérifications d'antécédents et des entrevues.",
      safetyTitle: 'La Sécurité des Femmes & des Ados Est Notre',
      safetyAccent: 'Priorité #1',
      safetyDesc: "Tous les trajets sont suivis en direct. Notre équipe s'assure que tous les passagers — surtout les femmes et les ados — arrivent sains et saufs.",
      trustBrand: 'Drivveme',
      trustLine1: 'est fondé sur la',
      trustBold: 'confiance:',
      trustLine2: '',
      trustAccent: 'un choix plus sûr',
      trustLine3: ', pour vous et vos proches.',
    },
  };

  const t = isFrench ? content.fr : content.en;

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl">
      {/* Purple gradient background matching reference */}
      <div 
        className="absolute inset-0"
        style={{
          background: `linear-gradient(to bottom, 
            hsl(270, 60%, 8%) 0%, 
            hsl(275, 55%, 15%) 20%, 
            hsl(280, 50%, 25%) 50%, 
            hsl(285, 45%, 35%) 80%, 
            hsl(290, 40%, 40%) 100%
          )`,
        }}
      />
      
      {/* Sparkle/star effect overlay */}
      <div 
        className="absolute inset-0"
        style={{
          backgroundImage: `
            radial-gradient(1.5px 1.5px at 8% 15%, rgba(255,255,255,0.9), transparent),
            radial-gradient(1px 1px at 25% 35%, rgba(255,255,255,0.7), transparent),
            radial-gradient(2px 2px at 45% 8%, rgba(255,255,255,0.6), transparent),
            radial-gradient(1.5px 1.5px at 65% 55%, rgba(255,255,255,0.8), transparent),
            radial-gradient(1px 1px at 85% 25%, rgba(255,255,255,0.6), transparent),
            radial-gradient(2px 2px at 12% 75%, rgba(255,255,255,0.5), transparent),
            radial-gradient(1.5px 1.5px at 78% 82%, rgba(255,255,255,0.7), transparent),
            radial-gradient(1px 1px at 40% 48%, rgba(255,255,255,0.6), transparent),
            radial-gradient(1.5px 1.5px at 58% 22%, rgba(255,255,255,0.7), transparent),
            radial-gradient(1px 1px at 92% 65%, rgba(255,255,255,0.5), transparent),
            radial-gradient(2px 2px at 5% 45%, rgba(255,255,255,0.4), transparent),
            radial-gradient(1px 1px at 72% 38%, rgba(255,255,255,0.6), transparent)
          `,
        }}
      />
      
      <div className="relative z-10 flex flex-col h-full p-6 xl:p-8 text-white">
        {/* Shield icon + Main headline */}
        <div className="flex items-center justify-center gap-3 mb-2">
          <div className="p-2 rounded-lg bg-primary/20 border border-primary/30">
            <Shield className="w-6 h-6 xl:w-7 xl:h-7 text-primary" />
          </div>
          <h1 className="text-2xl xl:text-3xl font-bold tracking-tight">
            <span className="text-white">{t.headline}</span>{' '}
            <span className="text-primary">{t.headlineAccent}</span>
          </h1>
        </div>

        {/* Subheadline */}
        <h2 className="text-lg xl:text-xl font-semibold text-center mb-5 text-white/90">
          {t.subheadline}
        </h2>

        {/* Feature list with matching icons */}
        <div className="space-y-2.5 mb-5">
          {t.features.map((feature, index) => (
            <div key={index} className="flex items-center gap-3">
              <span className="text-xl flex-shrink-0">{feature.emoji}</span>
              <span className="text-base xl:text-lg font-medium">
                {feature.text}
                {feature.accent && <span className="text-primary font-bold"> {feature.accent}</span>}
              </span>
            </div>
          ))}
        </div>

        {/* Warning section */}
        <div className="mb-4">
          <p className="text-base xl:text-lg font-bold">
            {t.warningTitle} <span className="text-primary">{t.warningBrand}</span>
          </p>
          <p className="text-sm xl:text-base text-white/75 mt-1">{t.warningDesc}</p>
        </div>

        {/* Divider */}
        <div className="border-t border-white/20 my-4" />

        {/* Safety priority section */}
        <div className="mb-4">
          <h3 className="text-base xl:text-lg font-bold">
            {t.safetyTitle}{' '}
            <span className="text-primary">{t.safetyAccent}</span>
          </h3>
          <p className="text-sm xl:text-base text-white/75 mt-1 leading-relaxed">{t.safetyDesc}</p>
        </div>

        {/* Image of happy teens */}
        <div className="flex-1 flex items-end relative mt-2">
          <div className="flex items-end gap-4 w-full">
            <img 
              src={drivemeGirlsHero} 
              alt="Happy teens and young people using Drivveme safely"
              className="w-[45%] max-w-[200px] h-auto rounded-xl object-cover shadow-xl shadow-black/40"
            />
            {/* Trust statement next to image */}
            <div className="flex-1 pb-4">
              <p className="text-base xl:text-lg leading-relaxed">
                <span className="font-bold text-primary">{t.trustBrand}</span>{' '}
                <span>{t.trustLine1}</span>{' '}
                <span className="font-bold">{t.trustBold}</span>
                <br />
                <span>{t.trustLine2}</span>
                <span className="text-primary italic font-semibold"> {t.trustAccent}</span>
                <span>{t.trustLine3}</span>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RiderMarketingPanel;
