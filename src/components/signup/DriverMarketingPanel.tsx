import { Car, ShieldCheck, DollarSign, Users, Award, Heart } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import driverHero from '@/assets/driveme-driver-hero.png';

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
        { icon: ShieldCheck, bold: 'Highest Earnings,', text: 'Lowest Rider Costs—Everyone Wins!', accent: '' },
        { icon: ShieldCheck, text: 'Drivers Are Respected', bold: 'Independent Contractors', accent: '' },
        { icon: ShieldCheck, bold: 'Fair & Transparent', text: 'Pay Based on', accent: 'Real Value' },
        { icon: ShieldCheck, bold: 'Team', text: 'Culture Where All Drivers Are', accent: 'Valued Partners' },
        { icon: ShieldCheck, bold: 'Hard Work', text: 'is Noticed & Rewarded—You Always', accent: 'Matter!' },
      ],
      driversFirst: 'At Drivveme,',
      driversFirstAccent: 'Drivers Come First.',
      beBoss: 'Be Your Own Boss',
      beBossText: "—Drive with a Team That's Got Your Back!",
    },
    fr: {
      headline: 'Les Chauffeurs Sont des',
      headlineAccent: 'Travailleurs Autonomes',
      subheadline: 'Gagnez plus avec Drivveme!',
      intro: 'Vous êtes une partie vitale de notre équipe—et',
      introTeam: 'nous',
      introContinue: 'nous battons pour maximiser vos revenus sans faire payer plus cher nos clients!',
      features: [
        { icon: ShieldCheck, bold: 'Revenus maximisés,', text: 'coûts minimisés pour les passagers', accent: '' },
        { icon: ShieldCheck, bold: 'Respect et Valorisation', text: 'des Travailleurs Autonomes', accent: '' },
        { icon: ShieldCheck, bold: 'Rémunération Juste, Transparente,', text: 'sur la', accent: 'Valeur Réelle' },
        { icon: ShieldCheck, bold: "Culture d'Équipe", text: 'où Tous les Chauffeurs sont', accent: 'Partenaires' },
        { icon: ShieldCheck, bold: 'Travail Remarqué & Récompensé', text: '—Vous Comptez', accent: 'Toujours!' },
      ],
      driversFirst: 'Chez Drivveme,',
      driversFirstAccent: 'Les Chauffeurs Passent en Premier.',
      beBoss: 'Soyez votre propre patron.',
      beBossText: 'Travaillez avec une équipe qui reconnaît vos efforts.',
    },
  };

  const t = isFrench ? content.fr : content.en;

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl">
      {/* Purple gradient background */}
      <div 
        className="absolute inset-0"
        style={{
          background: `
            linear-gradient(
              to bottom,
              hsl(280, 60%, 8%) 0%,
              hsl(275, 55%, 18%) 25%,
              hsl(270, 50%, 30%) 50%,
              hsl(285, 45%, 40%) 75%,
              hsl(300, 40%, 50%) 100%
            )
          `,
        }}
      />
      
      {/* Sparkle/bokeh effect overlay - intense purple particles */}
      <div 
        className="absolute inset-0"
        style={{
          backgroundImage: `
            radial-gradient(circle at 5% 10%, rgba(200, 150, 255, 0.4) 0%, transparent 2%),
            radial-gradient(circle at 15% 25%, rgba(255, 200, 255, 0.3) 0%, transparent 1.5%),
            radial-gradient(circle at 25% 5%, rgba(180, 130, 255, 0.5) 0%, transparent 1%),
            radial-gradient(circle at 35% 35%, rgba(220, 180, 255, 0.25) 0%, transparent 2.5%),
            radial-gradient(circle at 45% 15%, rgba(255, 220, 255, 0.35) 0%, transparent 1%),
            radial-gradient(circle at 55% 40%, rgba(200, 160, 255, 0.3) 0%, transparent 1.8%),
            radial-gradient(circle at 65% 8%, rgba(240, 200, 255, 0.4) 0%, transparent 1.2%),
            radial-gradient(circle at 75% 30%, rgba(180, 140, 255, 0.35) 0%, transparent 2%),
            radial-gradient(circle at 85% 20%, rgba(255, 180, 255, 0.3) 0%, transparent 1.5%),
            radial-gradient(circle at 95% 45%, rgba(210, 170, 255, 0.25) 0%, transparent 2.2%),
            radial-gradient(circle at 10% 50%, rgba(255, 210, 255, 0.3) 0%, transparent 1.8%),
            radial-gradient(circle at 30% 60%, rgba(190, 150, 255, 0.35) 0%, transparent 1%),
            radial-gradient(circle at 50% 55%, rgba(230, 190, 255, 0.4) 0%, transparent 2%),
            radial-gradient(circle at 70% 65%, rgba(200, 170, 255, 0.3) 0%, transparent 1.5%),
            radial-gradient(circle at 90% 58%, rgba(255, 200, 255, 0.25) 0%, transparent 1.2%),
            radial-gradient(circle at 20% 75%, rgba(180, 140, 255, 0.4) 0%, transparent 2.5%),
            radial-gradient(circle at 40% 80%, rgba(220, 180, 255, 0.35) 0%, transparent 1.8%),
            radial-gradient(circle at 60% 70%, rgba(255, 220, 255, 0.3) 0%, transparent 1%),
            radial-gradient(circle at 80% 85%, rgba(200, 160, 255, 0.4) 0%, transparent 2%),
            radial-gradient(circle at 100% 75%, rgba(240, 200, 255, 0.3) 0%, transparent 1.5%)
          `,
        }}
      />

      {/* Additional glow orbs for depth */}
      <div 
        className="absolute inset-0"
        style={{
          backgroundImage: `
            radial-gradient(ellipse 150px 100px at 20% 90%, rgba(255, 180, 220, 0.25), transparent),
            radial-gradient(ellipse 200px 120px at 50% 95%, rgba(255, 200, 150, 0.2), transparent),
            radial-gradient(ellipse 180px 100px at 80% 88%, rgba(255, 150, 200, 0.25), transparent)
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
        <p className="text-sm text-white/80 mb-4 leading-relaxed italic">
          {t.intro} <span className="font-bold">{t.introTeam}</span> {t.introContinue}
        </p>

        {/* Feature list with shield checkmarks like the reference */}
        <div className="space-y-2.5 mb-4">
          {t.features.map((feature, index) => (
            <div key={index} className="flex items-center gap-3">
              <div className="flex-shrink-0 p-1 rounded-md bg-emerald-500/20 border border-emerald-400/40">
                <ShieldCheck className="h-5 w-5 text-emerald-400" />
              </div>
              <span className="text-sm font-medium leading-tight">
                {feature.bold && <span className="font-bold">{feature.bold}</span>}{' '}
                {feature.text}
                {feature.accent && <span className="text-primary font-bold"> {feature.accent}</span>}
              </span>
            </div>
          ))}
        </div>

        {/* Drivers first section */}
        <div className="mb-3">
          <p className="text-xl xl:text-2xl font-bold">
            {t.driversFirst}{' '}
            <span className="text-primary">{t.driversFirstAccent}</span>
          </p>
          <p className="text-sm text-white/80 mt-1">
            <span className="italic">{t.beBoss}</span>
            {t.beBossText}
          </p>
        </div>

        {/* Driver hero image */}
        <div className="mt-auto relative">
          <img 
            src={driverHero} 
            alt="Drivveme Driver"
            className="w-full h-auto max-h-[280px] object-contain object-bottom rounded-lg"
          />
          {/* Gradient fade at top of image to blend with background */}
          <div 
            className="absolute inset-x-0 top-0 h-16 pointer-events-none"
            style={{
              background: 'linear-gradient(to bottom, hsl(285, 45%, 40%), transparent)'
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default DriverMarketingPanel;
