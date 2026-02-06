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
        { icon: DollarSign, bold: 'Highest Earnings,', text: 'Lowest Rider Costs—Everyone Wins!', accent: '', iconColor: 'text-emerald-400' },
        { icon: ShieldCheck, text: 'Drivers Are Respected', bold: 'Independent Contractors', accent: '', iconColor: 'text-emerald-400' },
        { icon: Award, bold: 'Fair & Transparent', text: 'Pay Based on', accent: 'Real Value', iconColor: 'text-emerald-400' },
        { icon: Users, bold: 'Team', text: 'Culture Where All Drivers Are', accent: 'Valued Partners', iconColor: 'text-emerald-400' },
        { icon: Heart, bold: 'Hard Work', text: 'is Noticed & Rewarded—You Always', accent: 'Matter!', iconColor: 'text-emerald-400' },
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
        { icon: DollarSign, bold: 'Revenus maximisés,', text: 'coûts minimisés pour les passagers', accent: '', iconColor: 'text-emerald-400' },
        { icon: ShieldCheck, bold: 'Respect et Valorisation', text: 'des Travailleurs Autonomes', accent: '', iconColor: 'text-emerald-400' },
        { icon: Award, bold: 'Rémunération Juste, Transparente,', text: 'sur la', accent: 'Valeur Réelle', iconColor: 'text-emerald-400' },
        { icon: Users, bold: "Culture d'Équipe", text: 'où Tous les Chauffeurs sont', accent: 'Partenaires', iconColor: 'text-emerald-400' },
        { icon: Heart, bold: 'Travail Remarqué & Récompensé', text: '—Vous Comptez', accent: 'Toujours!', iconColor: 'text-emerald-400' },
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
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-primary/20 border border-primary/40 shadow-lg shadow-primary/20">
            <Car className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-xl xl:text-2xl font-bold tracking-tight">
            <span className="text-white">{t.headline}</span>{' '}
            <span className="text-primary italic">{t.headlineAccent}</span>
          </h1>
        </div>

        {/* Subheadline */}
        <h2 className="text-xl xl:text-2xl font-bold mb-3">{t.subheadline}</h2>

        {/* Intro text */}
        <p className="text-sm text-white/80 mb-4 leading-relaxed">
          {t.intro} <span className="font-bold">{t.introTeam}</span> {t.introContinue}
        </p>

        {/* Feature list */}
        <div className="space-y-2 mb-4">
          {t.features.map((feature, index) => (
            <div key={index} className="flex items-center gap-3">
              <div className="p-1.5 rounded-md bg-primary/15 border border-primary/25">
                <feature.icon className={`h-5 w-5 ${feature.iconColor}`} />
              </div>
              <span className="text-sm font-medium">
                {feature.bold && <span className="font-bold">{feature.bold}</span>}{' '}
                {feature.text}
                {feature.accent && <span className="text-primary font-bold"> {feature.accent}</span>}
              </span>
            </div>
          ))}
        </div>

        {/* Drivers first section */}
        <div className="mb-3">
          <p className="text-lg xl:text-xl font-bold">
            {t.driversFirst}{' '}
            <span className="text-primary">{t.driversFirstAccent}</span>
          </p>
          <p className="text-sm text-white/70 mt-1">
            <span className="italic">{t.beBoss}</span>
            {t.beBossText}
          </p>
        </div>

        {/* Bottom line */}
        <div className="mt-auto pt-4 border-t border-white/15">
          <p className="text-base xl:text-lg text-center font-medium">
            {t.bottomLine}{' '}
            <span className="font-bold">{t.bottomBold}</span>{' '}
            <span className="text-primary italic">{t.bottomAccent}</span>{' '}
            {t.bottomEnd}
          </p>
        </div>
      </div>
    </div>
  );
};

export default DriverMarketingPanel;
