import { Shield, ShieldCheck, MessageCircle, MapPin, Users } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import familyImage from '@/assets/driveme-girls.png';

const RiderMarketingPanel = () => {
  const { language } = useLanguage();
  const isFrench = language === 'fr';

  const content = {
    en: {
      headline: 'Your Safety is Our',
      headlineAccent: 'Priority',
      subheadline: 'Why Riders Choose Drivveme',
      features: [
        { icon: ShieldCheck, text: 'Background Checked Drivers', accent: '', iconColor: 'text-success' },
        { icon: MessageCircle, text: 'Personal Interviews Required', accent: '', iconColor: 'text-accent' },
        { icon: Users, text: 'Women & Teen Safety is', accent: '#1 Priority', iconColor: 'text-primary' },
        { icon: MapPin, text: 'Live Ride Monitoring', suffix: 'by Real People', accent: '', iconColor: 'text-primary' },
        { icon: Shield, text: 'Strict Standards & Human Oversight', accent: '', iconColor: 'text-primary' },
      ],
      notJust: 'Not just anyone can drive for',
      drivveme: 'Drivveme.',
      allDrivers: 'All drivers pass background checks and personal interviews.',
      safetyTitle: 'Safety of Women & Teens is Our',
      safetyAccent: '#1 Priority',
      safetyDesc:
        'Every ride is live monitored. Our team ensures all passengers—especially women and teens—arrive safe and sound.',
      trustTitleLeft: 'Drivveme is built on',
      trustTitleRight: 'trust:',
      trustLine1: 'a safer choice, for you and',
      trustLine2: 'your loved ones.',
    },
    fr: {
      headline: 'Votre sécurité est notre',
      headlineAccent: 'priorité',
      subheadline: 'Pourquoi les passagers choisissent Drivveme',
      features: [
        { icon: ShieldCheck, text: 'Chauffeurs vérifiés', accent: '', iconColor: 'text-success' },
        { icon: MessageCircle, text: 'Entrevues personnelles obligatoires', accent: '', iconColor: 'text-accent' },
        { icon: Users, text: 'Sécurité femmes & ados =', accent: 'Priorité #1', iconColor: 'text-primary' },
        { icon: MapPin, text: 'Trajets suivis en direct par des', suffix: 'employés réels', accent: '', iconColor: 'text-primary' },
        { icon: Shield, text: 'Normes strictes & surveillance humaine', accent: '', iconColor: 'text-primary' },
      ],
      notJust: "Pas n'importe qui peut conduire pour",
      drivveme: 'Drivveme.',
      allDrivers: "Tous les chauffeurs passent des vérifications d'antécédents et des entrevues personnelles.",
      safetyTitle: 'La sécurité des femmes & des ados est notre',
      safetyAccent: 'priorité #1',
      safetyDesc:
        "Tous les trajets sont suivis en direct. Nos employés s'assurent que tous les passagers—surtout les femmes et ados—arrivent sains et saufs.",
      trustTitleLeft: 'Drivveme est fondé sur la',
      trustTitleRight: 'confiance :',
      trustLine1: 'un choix plus sûr, pour vous et',
      trustLine2: 'vos proches.',
    },
  };

  const t = isFrench ? content.fr : content.en;

  return (
    <section className="relative h-full w-full overflow-hidden rounded-2xl signup-panel-bg">
      <div className="absolute inset-0 opacity-20 signup-panel-sparkles" />
      <div className="absolute inset-0 bg-gradient-to-b from-background/10 via-transparent to-background/30" />

      {/* family photo */}
      <div className="pointer-events-none absolute bottom-0 left-0 w-[56%] max-w-[320px]">
        <div className="absolute inset-0 bg-gradient-to-r from-background/0 via-background/10 to-background/70" />
        <img
          src={familyImage}
          alt={isFrench ? 'Famille souriante' : 'Smiling family'}
          loading="lazy"
          className="block w-full h-auto opacity-90"
        />
      </div>

      <div className="relative z-10 flex h-full flex-col p-6 sm:p-7">
        {/* headline */}
        <header className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/15 border border-primary/25 shadow-lg shadow-primary/10">
            <Shield className="h-7 w-7 text-primary" />
          </div>
          <div>
            <h2 className="text-2xl sm:text-[28px] font-bold leading-tight tracking-tight">
              <span className="text-foreground">{t.headline} </span>
              <span className="text-primary font-extrabold">{t.headlineAccent}</span>
            </h2>
            <p className="mt-2 text-lg font-semibold text-foreground/90">{t.subheadline}</p>
          </div>
        </header>

        {/* features */}
        <div className="mt-6 space-y-3">
          {t.features.map((f, idx) => (
            <div key={idx} className="flex items-start gap-3">
              <div className="mt-0.5 p-1.5 rounded-md bg-background/10 border border-foreground/10">
                <f.icon className={`h-5 w-5 ${f.iconColor}`} />
              </div>
              <p className="text-base font-medium text-foreground/95">
                {f.text}
                {f.suffix && <span className="text-foreground/80"> {f.suffix}</span>}
                {f.accent && <span className="text-primary font-bold"> {f.accent}</span>}
              </p>
            </div>
          ))}
        </div>

        {/* copy */}
        <div className="mt-6">
          <p className="text-xl font-bold text-foreground">
            {t.notJust} <span className="text-primary">{t.drivveme}</span>
          </p>
          <p className="mt-1 text-sm text-foreground/65">{t.allDrivers}</p>
        </div>

        <div className="mt-6 border-t border-foreground/15" />

        <div className="mt-5">
          <p className="text-lg font-bold text-foreground">
            {t.safetyTitle} <span className="text-primary">{t.safetyAccent}</span>
          </p>
          <p className="mt-2 text-sm text-foreground/65 leading-relaxed">{t.safetyDesc}</p>
        </div>

        <footer className="mt-auto pt-8">
          <p className="text-center text-xl font-semibold text-foreground">
            <span className="font-bold text-foreground">{t.trustTitleLeft} </span>
            <span className="text-primary font-bold">{t.trustTitleRight}</span>
          </p>
          <p className="text-center text-lg text-foreground/85">
            {t.trustLine1} <span className="text-primary font-semibold">{t.trustLine2}</span>
          </p>
        </footer>
      </div>
    </section>
  );
};

export default RiderMarketingPanel;
