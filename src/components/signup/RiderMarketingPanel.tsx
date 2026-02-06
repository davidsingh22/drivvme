import { Shield, ShieldCheck, MessageCircle, MapPin, Users } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

const RiderMarketingPanel = () => {
  const { language } = useLanguage();
  const isFrench = language === 'fr';

  const content = {
    en: {
      headline: 'Your Safety',
      headlineAccent: 'Is Our Priority',
      subheadlinePrefix: 'Why Riders',
      subheadlineSuffix: 'Choose Drivveme',
      features: [
        { icon: ShieldCheck, text: 'Background Checked Drivers', accent: '', iconColor: 'text-emerald-400' },
        { icon: MessageCircle, text: 'Personal Interviews Required', accent: '', iconColor: 'text-blue-400' },
        { icon: Users, text: 'Women & Teen Safety Is', accent: '#1 Priority', iconColor: 'text-rose-400' },
        { icon: MapPin, text: 'Live Ride Monitoring', suffix: 'by Real People', accent: '', iconColor: 'text-fuchsia-400' },
        { icon: Shield, text: 'Strict Standards & Human Oversight', accent: '', iconColor: 'text-primary' },
      ],
      notJustLine1: 'Not just',
      notJustBold: 'anyone',
      notJustLine2: 'can drive for',
      drivveme: 'Drivveme.',
      allDrivers: 'All drivers pass background checks and personal interviews.',
      safetyTitle: 'Safety of Women & Teens is Our',
      safetyAccent: '#1 Priority',
      safetyDesc: 'Every ride is live monitored. Our team ensures all passengers—especially women and teens—arrive safe and sound.',
      trustLine1Part1: 'Drivveme',
      trustLine1Part2: 'is built on',
      trustLine1Part3: 'trust:',
      trustLine2Part1: 'a',
      trustLine2Part2: 'safer choice',
      trustLine2Part3: ', for you and',
      trustLine3: 'your loved ones.',
    },
    fr: {
      headline: 'Votre Sécurité',
      headlineAccent: 'Est Notre Priorité',
      subheadlinePrefix: 'Pourquoi',
      subheadlineSuffix: 'les passagers choisissent Drivveme',
      features: [
        { icon: ShieldCheck, text: 'Chauffeurs Vérifiés', accent: '', iconColor: 'text-emerald-400' },
        { icon: MessageCircle, text: 'Entrevues Personnelles Obligatoires', accent: '', iconColor: 'text-blue-400' },
        { icon: Users, text: 'Sécurité des Femmes & des Ados =', accent: 'Priorité #1', iconColor: 'text-rose-400' },
        { icon: MapPin, text: 'Trajets Suivis en Direct par des', suffix: 'Employés Réels', accent: '', iconColor: 'text-fuchsia-400' },
        { icon: Shield, text: 'Normes Strictes & Surveillance Humaine', accent: '', iconColor: 'text-primary' },
      ],
      notJustLine1: "Pas",
      notJustBold: "n'importe qui",
      notJustLine2: 'ne peut devenir chauffeur',
      drivveme: 'Drivveme.',
      allDrivers: "Tous les chauffeurs passent des vérifications d'antécédents et des entrevues personnelles.",
      safetyTitle: 'La Sécurité des Femmes & des Ados',
      safetyAccent: 'Est Notre Priorité #1',
      safetyDesc: "Tous les trajets sont suivis en direct. Nos employés s'assurent que tous les passagers—surtout les femmes et ados—arrivent sains et saufs.",
      trustLine1Part1: 'Drivveme',
      trustLine1Part2: 'est fondé sur la',
      trustLine1Part3: 'confiance :',
      trustLine2Part1: '',
      trustLine2Part2: 'un choix plus sûr',
      trustLine2Part3: ',',
      trustLine3: 'pour vous et vos proches.',
    },
  };

  const t = isFrench ? content.fr : content.en;

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl bg-gradient-to-b from-[hsl(270,50%,12%)] via-[hsl(280,45%,22%)] to-[hsl(290,40%,35%)]">
      {/* Sparkle/star effect overlay */}
      <div 
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage: `
            radial-gradient(1px 1px at 10% 20%, rgba(255,255,255,0.8), transparent),
            radial-gradient(1px 1px at 30% 40%, rgba(255,255,255,0.6), transparent),
            radial-gradient(2px 2px at 50% 10%, rgba(255,255,255,0.4), transparent),
            radial-gradient(1px 1px at 70% 60%, rgba(255,255,255,0.7), transparent),
            radial-gradient(1px 1px at 90% 30%, rgba(255,255,255,0.5), transparent),
            radial-gradient(2px 2px at 15% 80%, rgba(255,255,255,0.3), transparent),
            radial-gradient(1px 1px at 85% 85%, rgba(255,255,255,0.6), transparent)
          `,
        }}
      />
      
      <div className="relative z-10 flex flex-col h-full p-6 xl:p-8 text-white">
        {/* Main headline */}
        <div className="flex items-center gap-3 mb-5">
          <div className="p-2 rounded-lg bg-primary/20 border border-primary/40 shadow-lg shadow-primary/20">
            <Shield className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-2xl xl:text-3xl font-bold tracking-tight">
            <span className="text-primary italic font-serif">{t.headline}</span>{' '}
            <span className="text-white font-normal">{t.headlineAccent}</span>
          </h1>
        </div>

        {/* Subheadline */}
        <h2 className="text-lg xl:text-xl font-semibold mb-4">
          <span className="font-bold">{t.subheadlinePrefix}</span>{' '}
          <span className="text-white/90">{t.subheadlineSuffix}</span>
        </h2>

        {/* Feature list */}
        <div className="space-y-2.5 mb-5">
          {t.features.map((feature, index) => (
            <div key={index} className="flex items-center gap-3">
              <div className="p-1.5 rounded-md bg-primary/15 border border-primary/25">
                <feature.icon className={`h-5 w-5 ${feature.iconColor}`} />
              </div>
              <span className="text-sm xl:text-base font-medium">
                {feature.text}
                {feature.suffix && <span className="text-white/80"> {feature.suffix}</span>}
                {feature.accent && <span className="text-primary font-bold"> {feature.accent}</span>}
              </span>
            </div>
          ))}
        </div>

        {/* Not just anyone section */}
        <div className="mb-4">
          <p className="text-lg xl:text-xl font-bold">
            {t.notJustLine1} <span className="font-extrabold">{t.notJustBold}</span>{' '}
            <span className="font-normal">{t.notJustLine2}</span>{' '}
            <span className="text-primary">{t.drivveme}</span>
          </p>
          <p className="text-xs xl:text-sm text-white/60 mt-1">{t.allDrivers}</p>
        </div>

        {/* Divider */}
        <div className="border-t border-white/15 my-3" />

        {/* Safety priority section */}
        <div className="mb-4">
          <h3 className="text-base xl:text-lg font-bold">
            {t.safetyTitle}{' '}
            <span className="text-primary">{t.safetyAccent}</span>
          </h3>
          <p className="text-xs xl:text-sm text-white/60 mt-1 leading-relaxed">{t.safetyDesc}</p>
        </div>

        {/* Trust statement at bottom */}
        <div className="mt-auto pt-4">
          <p className="text-base xl:text-lg leading-relaxed">
            <span className="font-bold text-primary">{t.trustLine1Part1}</span>{' '}
            <span>{t.trustLine1Part2}</span>{' '}
            <span className="font-bold">{t.trustLine1Part3}</span>
          </p>
          <p className="text-base xl:text-lg leading-relaxed">
            {t.trustLine2Part1}
            <span className="text-primary italic font-semibold">{t.trustLine2Part2}</span>
            {t.trustLine2Part3}
          </p>
          <p className="text-base xl:text-lg">{t.trustLine3}</p>
        </div>
      </div>
    </div>
  );
};

export default RiderMarketingPanel;
