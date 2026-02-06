import { Car, ShieldCheck, DollarSign, Users, Award, Heart } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import driverHeroImage from '@/assets/signup-driver-hero.png';

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
        { icon: DollarSign, bold: 'Highest Earnings,', text: 'Lowest Rider Costs—Everyone Wins!' },
        { icon: ShieldCheck, text: 'Drivers Are Respected', bold: 'Independent Contractors' },
        { icon: Award, bold: 'Fair & Transparent', text: 'Pay Based on', accent: 'Real Value' },
        { icon: Users, bold: 'Team', text: 'Culture Where All Drivers Are', accent: 'Valued Partners' },
        { icon: Heart, bold: 'Hard Work', text: 'is Noticed & Rewarded—You Always', accent: 'Matter!' },
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
        { icon: DollarSign, bold: 'Revenus maximisés,', text: 'coûts minimisés pour les passagers' },
        { icon: ShieldCheck, bold: 'Respect et Valorisation', text: 'des Travailleurs Autonomes' },
        { icon: Award, bold: 'Rémunération Juste, Transparente,', text: 'sur la', accent: 'Valeur Réelle' },
        { icon: Users, bold: "Culture d'Équipe", text: 'où Tous les Chauffeurs sont', accent: 'Partenaires' },
        { icon: Heart, bold: 'Travail Remarqué & Récompensé', text: '—Vous Comptez', accent: 'Toujours!' },
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
    <div 
      className="relative h-full w-full overflow-hidden rounded-2xl"
      style={{
        backgroundImage: `url(${driverHeroImage})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      {/* Gradient overlay for readability */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/40 to-black/70" />
      
      <div className="relative z-10 flex flex-col h-full p-8 text-white">
        {/* Main headline */}
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-primary/20 backdrop-blur-sm border border-primary/30">
            <Car className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold">
            <span className="text-white">{t.headline}</span>{' '}
            <span className="text-primary">{t.headlineAccent}</span>
          </h1>
        </div>

        {/* Subheadline */}
        <h2 className="text-2xl font-bold mb-3 text-white">{t.subheadline}</h2>

        {/* Intro text */}
        <p className="text-sm text-white/90 mb-4">
          {t.intro} <span className="font-bold">{t.introTeam}</span> {t.introContinue}
        </p>

        {/* Feature list */}
        <div className="space-y-2.5 mb-4">
          {t.features.map((feature, index) => (
            <div key={index} className="flex items-center gap-3">
              <div className="p-1.5 rounded-md bg-primary/20 backdrop-blur-sm">
                <feature.icon className="h-5 w-5 text-emerald-400" />
              </div>
              <span className="text-sm">
                {feature.bold && <span className="font-bold">{feature.bold}</span>}{' '}
                {feature.text}
                {feature.accent && <span className="text-primary font-semibold"> {feature.accent}</span>}
              </span>
            </div>
          ))}
        </div>

        {/* Drivers first section */}
        <div className="mb-3">
          <p className="text-xl font-bold">
            {t.driversFirst}{' '}
            <span className="text-primary">{t.driversFirstAccent}</span>
          </p>
          <p className="text-sm text-white/90 mt-1">
            <span className="italic">{t.beBoss}</span>
            {t.beBossText}
          </p>
        </div>

        {/* Bottom line - pushed to bottom */}
        <div className="mt-auto pt-4 border-t border-white/20">
          <p className="text-lg text-center">
            {t.bottomLine}{' '}
            <span className="font-bold">{t.bottomBold}</span>{' '}
            <span className="text-primary">{t.bottomAccent}</span>{' '}
            {t.bottomEnd}
          </p>
        </div>
      </div>
    </div>
  );
};

export default DriverMarketingPanel;
