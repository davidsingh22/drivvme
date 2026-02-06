import { Car, ShieldCheck, DollarSign, Users, Award, Heart } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

const DriverMarketingPanel = () => {
  const { language } = useLanguage();
  const isFrench = language === 'fr';

  const content = {
    en: {
      headline: 'Drivers Are',
      headlineAccent: 'Independent Contractors',
      subheadline: 'Earn More with Drivveme!',
      intro: "You're a vital part of our",
      introTeam: 'team',
      introContinue: "—and we'll fight for you to earn the most money without charging riders more!",
      features: [
        { icon: DollarSign, bold: 'Highest Earnings,', text: 'Lowest Rider Costs—Everyone Wins!', accent: '', iconColor: 'text-success' },
        { icon: ShieldCheck, text: 'Drivers Are Respected', bold: 'Independent Contractors', accent: '', iconColor: 'text-success' },
        { icon: Award, bold: 'Fair & Transparent', text: 'Pay Based on', accent: 'Real Value', iconColor: 'text-success' },
        { icon: Users, bold: 'Team', text: 'Culture Where All Drivers Are', accent: 'Valued Partners', iconColor: 'text-success' },
        { icon: Heart, bold: 'Hard Work', text: 'is Noticed & Rewarded—You Always', accent: 'Matter!', iconColor: 'text-success' },
      ],
      driversFirst: 'At Drivveme,',
      driversFirstAccent: 'Drivers Come First.',
      beBoss: 'Be Your Own Boss',
      beBossText: "—Drive with a Team That's Got Your Back!",
      bottomLine: "We're Building",
      bottomBold: 'The Best',
      bottomAccent: 'Ride-Sharing',
      bottomEnd: 'Platform, Together.',
    },
    fr: {
      headline: 'Les Chauffeurs Sont des',
      headlineAccent: 'Travailleurs Autonomes',
      subheadline: 'Gagnez plus avec Drivveme!',
      intro: 'Vous êtes une partie vitale de notre équipe—et',
      introTeam: 'nous',
      introContinue: 'nous battons pour maximiser vos revenus sans faire payer plus cher nos clients!',
      features: [
        { icon: DollarSign, bold: 'Revenus maximisés,', text: 'coûts minimisés pour les passagers', accent: '', iconColor: 'text-success' },
        { icon: ShieldCheck, bold: 'Respect et Valorisation', text: 'des Travailleurs Autonomes', accent: '', iconColor: 'text-success' },
        { icon: Award, bold: 'Rémunération Juste, Transparente,', text: 'sur la', accent: 'Valeur Réelle', iconColor: 'text-success' },
        { icon: Users, bold: "Culture d'Équipe", text: 'où Tous les Chauffeurs sont', accent: 'Partenaires', iconColor: 'text-success' },
        { icon: Heart, bold: 'Travail Remarqué & Récompensé', text: '—Vous Comptez', accent: 'Toujours!', iconColor: 'text-success' },
      ],
      driversFirst: 'Chez Drivveme,',
      driversFirstAccent: 'Les Chauffeurs Passent en Premier.',
      beBoss: 'Soyez votre propre patron.',
      beBossText: 'Travaillez avec une équipe qui reconnaît vos efforts.',
      bottomLine: 'Drivveme. Le',
      bottomBold: 'respect.',
      bottomAccent: 'La transparence.',
      bottomEnd: "L'unité.",
    },
  };

  const t = isFrench ? content.fr : content.en;

  return (
    <section className="relative h-full w-full overflow-hidden rounded-2xl signup-panel-bg">
      <div className="absolute inset-0 opacity-20 signup-panel-sparkles" />
      <div className="absolute inset-0 bg-gradient-to-b from-background/10 via-transparent to-background/30" />

      <div className="relative z-10 flex flex-col h-full p-6 sm:p-7 text-foreground">
        {/* Main headline */}
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-primary/15 border border-primary/25 shadow-lg shadow-primary/10">
            <Car className="h-7 w-7 text-primary" />
          </div>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight">
            <span className="text-foreground">{t.headline} </span>
            <span className="text-primary italic font-extrabold">{t.headlineAccent}</span>
          </h2>
        </div>

        {/* Subheadline */}
        <p className="text-2xl font-bold mb-3">{t.subheadline}</p>

        {/* Intro text */}
        <p className="text-sm text-foreground/80 mb-5 leading-relaxed">
          {t.intro} <span className="font-bold">{t.introTeam}</span> {t.introContinue}
        </p>

        {/* Feature list */}
        <div className="space-y-3 mb-5">
          {t.features.map((feature, index) => (
            <div key={index} className="flex items-start gap-3">
              <div className="mt-0.5 p-1.5 rounded-md bg-background/10 border border-foreground/10">
                <feature.icon className={`h-5 w-5 ${feature.iconColor}`} />
              </div>
              <p className="text-base font-medium text-foreground/95">
                {feature.bold && <span className="font-bold">{feature.bold}</span>}{' '}
                {feature.text}
                {feature.accent && <span className="text-primary font-bold"> {feature.accent}</span>}
              </p>
            </div>
          ))}
        </div>

        {/* Drivers first section */}
        <div className="mb-4">
          <p className="text-xl font-bold">
            {t.driversFirst} <span className="text-primary">{t.driversFirstAccent}</span>
          </p>
          <p className="text-sm text-foreground/70 mt-2">
            <span className="italic">{t.beBoss}</span> {t.beBossText}
          </p>
        </div>

        {/* Bottom line */}
        <div className="mt-auto pt-5 border-t border-foreground/15">
          <p className="text-base text-center font-medium">
            {t.bottomLine} <span className="font-bold">{t.bottomBold}</span>{' '}
            <span className="text-primary italic font-semibold">{t.bottomAccent}</span> {t.bottomEnd}
          </p>
        </div>
      </div>
    </section>
  );
};

export default DriverMarketingPanel;
