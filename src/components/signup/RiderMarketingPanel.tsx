import { Shield, ShieldCheck, Mic, Users, Eye, AlertTriangle, Lock } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import drivemeGirls from '@/assets/driveme-girls.png';

const RiderMarketingPanel = () => {
  const { language } = useLanguage();
  const isFrench = language === 'fr';

  const content = {
    en: {
      headline: '🛡️ Your Safety Is Our Priority',
      subheadline: 'Why Riders Choose Drivveme',
      features: [
        { icon: ShieldCheck, text: 'Background Checked Drivers', iconColor: 'text-emerald-400' },
        { icon: Mic, text: 'Personal Interviews Required', iconColor: 'text-blue-400' },
        { icon: Users, text: 'Women & Teen Safety Is Our', accent: '#1 Priority', iconColor: 'text-rose-400' },
        { icon: Eye, text: 'Live Ride Monitoring by Real People', iconColor: 'text-fuchsia-400' },
        { icon: Shield, text: 'Strict Standards & Human Oversight', iconColor: 'text-primary' },
      ],
      warningEmoji: '🚨',
      warningText: 'Not just anyone can drive for Drivveme.',
      warningDesc: 'All drivers must pass background checks and personal interviews before being approved.',
      safetyEmoji: '💜',
      safetyTitle: 'Safety of Women & Teens is Our',
      safetyAccent: '#1 Priority',
      safetyDesc: 'Every ride is tracked and monitored in real time.',
      safetyDesc2: 'Our team actively ensures all passengers — especially women and teens — arrive safe and sound.',
      lockEmoji: '🔒',
      trustLine1: 'Drivveme',
      trustLine2: 'is built on',
      trustLine3: 'trust',
      trustLine4: '— a',
      trustLine5: 'safer choice',
      trustLine6: ', for you and your loved ones.',
    },
    fr: {
      headline: '🛡️ Votre Sécurité Est Notre Priorité',
      subheadline: 'Pourquoi les passagers choisissent Drivveme',
      features: [
        { icon: ShieldCheck, text: 'Chauffeurs Vérifiés', iconColor: 'text-emerald-400' },
        { icon: Mic, text: 'Entrevues Personnelles Obligatoires', iconColor: 'text-blue-400' },
        { icon: Users, text: 'Sécurité des Femmes & des Ados =', accent: 'Priorité #1', iconColor: 'text-rose-400' },
        { icon: Eye, text: 'Trajets Suivis en Direct par des Employés Réels', iconColor: 'text-fuchsia-400' },
        { icon: Shield, text: 'Normes Strictes & Surveillance Humaine', iconColor: 'text-primary' },
      ],
      warningEmoji: '🚨',
      warningText: "Pas n'importe qui ne peut devenir chauffeur Drivveme.",
      warningDesc: "Tous les chauffeurs doivent passer des vérifications d'antécédents et des entrevues personnelles avant d'être approuvés.",
      safetyEmoji: '💜',
      safetyTitle: 'La Sécurité des Femmes & des Ados Est Notre',
      safetyAccent: 'Priorité #1',
      safetyDesc: 'Tous les trajets sont suivis et surveillés en temps réel.',
      safetyDesc2: "Notre équipe s'assure activement que tous les passagers — surtout les femmes et les ados — arrivent sains et saufs.",
      lockEmoji: '🔒',
      trustLine1: 'Drivveme',
      trustLine2: 'est fondé sur la',
      trustLine3: 'confiance',
      trustLine4: '—',
      trustLine5: 'un choix plus sûr',
      trustLine6: ', pour vous et vos proches.',
    },
  };

  const t = isFrench ? content.fr : content.en;

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl bg-gradient-to-b from-[hsl(270,50%,12%)] via-[hsl(280,45%,22%)] to-[hsl(290,40%,35%)]">
      {/* Sparkle/star effect overlay */}
      <div 
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage: `
            radial-gradient(1px 1px at 10% 20%, rgba(255,255,255,0.8), transparent),
            radial-gradient(1px 1px at 30% 40%, rgba(255,255,255,0.6), transparent),
            radial-gradient(2px 2px at 50% 10%, rgba(255,255,255,0.5), transparent),
            radial-gradient(1px 1px at 70% 60%, rgba(255,255,255,0.7), transparent),
            radial-gradient(1px 1px at 90% 30%, rgba(255,255,255,0.5), transparent),
            radial-gradient(2px 2px at 15% 80%, rgba(255,255,255,0.4), transparent),
            radial-gradient(1px 1px at 85% 85%, rgba(255,255,255,0.6), transparent),
            radial-gradient(1px 1px at 45% 55%, rgba(255,255,255,0.5), transparent),
            radial-gradient(1px 1px at 65% 25%, rgba(255,255,255,0.6), transparent)
          `,
        }}
      />
      
      <div className="relative z-10 flex flex-col h-full p-5 xl:p-6 text-white">
        {/* Main headline */}
        <h1 className="text-xl xl:text-2xl font-bold tracking-tight text-center mb-3">
          <span className="text-primary">{t.headline}</span>
        </h1>

        {/* Subheadline */}
        <h2 className="text-base xl:text-lg font-semibold text-center mb-4 text-white/90">
          {t.subheadline}
        </h2>

        {/* Feature list */}
        <div className="space-y-2 mb-4">
          {t.features.map((feature, index) => (
            <div key={index} className="flex items-center gap-2.5">
              <span className="text-lg">✅</span>
              <span className="text-sm xl:text-base font-medium">
                {feature.text}
                {feature.accent && <span className="text-primary font-bold"> {feature.accent}</span>}
              </span>
            </div>
          ))}
        </div>

        {/* Warning section */}
        <div className="mb-3">
          <p className="text-sm xl:text-base font-bold">
            <span className="text-lg">{t.warningEmoji}</span> {t.warningText}
          </p>
          <p className="text-xs xl:text-sm text-white/70 mt-1 leading-relaxed">{t.warningDesc}</p>
        </div>

        {/* Divider */}
        <div className="border-t border-white/15 my-3" />

        {/* Safety priority section */}
        <div className="mb-3">
          <h3 className="text-sm xl:text-base font-bold">
            <span className="text-lg">{t.safetyEmoji}</span> {t.safetyTitle}{' '}
            <span className="text-primary">{t.safetyAccent}</span>
          </h3>
          <p className="text-xs xl:text-sm text-white/70 mt-1 leading-relaxed">{t.safetyDesc}</p>
          <p className="text-xs xl:text-sm text-white/70 leading-relaxed">{t.safetyDesc2}</p>
        </div>

        {/* Image of happy teens */}
        <div className="flex-1 flex items-center justify-center my-3 relative">
          <img 
            src={drivemeGirls} 
            alt="Happy teens and young people using Drivveme safely"
            className="w-full max-w-[280px] h-auto rounded-xl object-cover shadow-xl shadow-black/30"
          />
        </div>

        {/* Trust statement at bottom */}
        <div className="pt-3 text-center">
          <p className="text-sm xl:text-base leading-relaxed">
            <span className="text-lg">{t.lockEmoji}</span>{' '}
            <span className="font-bold text-primary">{t.trustLine1}</span>{' '}
            <span>{t.trustLine2}</span>{' '}
            <span className="font-bold">{t.trustLine3}</span>
            <span>{t.trustLine4}</span>
            <span className="text-primary italic font-semibold"> {t.trustLine5}</span>
            <span>{t.trustLine6}</span>
          </p>
        </div>
      </div>
    </div>
  );
};

export default RiderMarketingPanel;
