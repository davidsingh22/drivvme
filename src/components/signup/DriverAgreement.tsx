import { useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { format } from 'date-fns';
import { useLanguage } from '@/contexts/LanguageContext';

interface DriverAgreementProps {
  onComplete: (agreementData: {
    isIndependentContractor: boolean;
    isResponsibleForTaxes: boolean;
    agreesToTerms: boolean;
  }) => void;
  isLoading?: boolean;
}

const DriverAgreement = ({ onComplete, isLoading }: DriverAgreementProps) => {
  const { language } = useLanguage();
  const [isIndependentContractor, setIsIndependentContractor] = useState(false);
  const [isResponsibleForTaxes, setIsResponsibleForTaxes] = useState(false);
  const [agreesToTerms, setAgreesToTerms] = useState(false);

  const allChecked = isIndependentContractor && isResponsibleForTaxes && agreesToTerms;

  const handleFinish = () => {
    if (allChecked) {
      onComplete({
        isIndependentContractor,
        isResponsibleForTaxes,
        agreesToTerms,
      });
    }
  };

  const t = {
    title: language === 'fr' 
      ? "ACCORD D'ENTREPRENEUR INDÉPENDANT DRIVVEME" 
      : "DRIVVEME DRIVER INDEPENDENT CONTRACTOR AGREEMENT",
    lastUpdated: language === 'fr' ? 'Dernière mise à jour' : 'Last Updated',
    intro: language === 'fr'
      ? 'Cet accord d\'entrepreneur indépendant pour chauffeur (« Accord ») est conclu entre Drivveme (« Drivveme », « nous », « notre » ou « la Société ») et le chauffeur individuel (« Chauffeur », « vous » ou « votre ») qui accepte cet Accord via la plateforme Drivveme.'
      : 'This Driver Independent Contractor Agreement ("Agreement") is entered into between Drivveme ("Drivveme," "we," "us," or "the Company") and the individual driver ("Driver," "you," or "your") who accepts this Agreement through the Drivveme platform.',
    introNote: language === 'fr'
      ? 'En vous inscrivant en tant que chauffeur et en utilisant la plateforme Drivveme, vous reconnaissez avoir lu, compris et accepté les conditions ci-dessous.'
      : 'By registering as a driver and using the Drivveme platform, you acknowledge that you have read, understood, and agreed to the terms below.',
    section1Title: language === 'fr' ? '1. Relation d\'entrepreneur indépendant' : '1. Independent Contractor Relationship',
    section1Intro: language === 'fr' ? 'Vous reconnaissez et acceptez que :' : 'You acknowledge and agree that:',
    section1Items: language === 'fr' ? [
      'Vous êtes un entrepreneur indépendant et non un employé, partenaire, agent ou représentant de Drivveme.',
      'Rien dans cet Accord ne crée de relation d\'emploi.',
      'Vous êtes libre de déterminer quand, où et à quelle fréquence vous fournissez des services de conduite.',
      'Vous n\'êtes pas obligé d\'accepter une demande de course spécifique.',
      'Drivveme ne contrôle pas la façon dont vous effectuez les services, seulement le fonctionnement de la plateforme.',
    ] : [
      'You are an independent contractor and not an employee, partner, agent, or representative of Drivveme.',
      'Nothing in this Agreement creates an employment relationship.',
      'You are free to determine when, where, and how often you provide driving services.',
      'You are not required to accept any specific ride request.',
      'Drivveme does not control how you perform services, only the operation of the platform.',
    ],
    section2Title: language === 'fr' ? '2. Taxes et responsabilités financières' : '2. Taxes and Financial Responsibilities',
    section2Intro: language === 'fr' ? 'Vous êtes seul responsable de :' : 'You are solely responsible for:',
    section2Items: language === 'fr' ? [
      'Déclarer et payer toutes les taxes applicables, y compris l\'impôt sur le revenu, la taxe de vente, la TPS/TVH, la TVQ, le RPC, l\'AE (le cas échéant) et toutes autres charges gouvernementales.',
      'Produire vos propres déclarations fiscales et tenir vos propres registres comptables.',
      'Toutes pénalités, intérêts, vérifications ou responsabilités découlant de vos obligations fiscales.',
      'Drivveme ne retient pas d\'impôts en votre nom.',
    ] : [
      'Reporting and paying all applicable taxes, including income tax, sales tax, GST/HST, QST, CPP, EI (if applicable), and any other government charges.',
      'Filing your own tax returns and maintaining your own accounting records.',
      'Any penalties, interest, audits, or liabilities arising from your tax obligations.',
      'Drivveme does not withhold taxes on your behalf.',
    ],
    section3Title: language === 'fr' ? '3. Paiements et frais' : '3. Payments and Fees',
    section3Items: language === 'fr' ? [
      'Drivveme facilite les paiements entre passagers et chauffeurs via la plateforme.',
      'Drivveme peut déduire des frais de service de plateforme comme indiqué dans l\'application.',
      'Vous êtes responsable de vérifier vos revenus et transactions.',
      'Drivveme n\'est pas responsable des erreurs du chauffeur, des revenus manqués ou de la mauvaise gestion financière par le chauffeur.',
    ] : [
      'Drivveme facilitates payments between riders and drivers through the platform.',
      'Drivveme may deduct platform service fees as disclosed in the app.',
      'You are responsible for reviewing your earnings and transactions.',
      'Drivveme is not responsible for driver errors, missed earnings, or financial mismanagement by the driver.',
    ],
    section4Title: language === 'fr' ? '4. Dépenses' : '4. Expenses',
    section4Intro: language === 'fr' 
      ? 'En tant qu\'entrepreneur indépendant, vous êtes responsable de tous les coûts liés à la conduite, y compris mais sans s\'y limiter :'
      : 'As an independent contractor, you are responsible for all costs related to driving, including but not limited to:',
    section4Items: language === 'fr' ? [
      'Achat ou location de véhicule',
      'Carburant, entretien et réparations',
      'Assurance',
      'Permis et licences',
      'Téléphone mobile et utilisation des données',
    ] : [
      'Vehicle purchase or lease',
      'Fuel, maintenance, and repairs',
      'Insurance',
      'Licensing and permits',
      'Mobile phone and data usage',
    ],
    section4Note: language === 'fr' 
      ? 'Drivveme ne rembourse pas les dépenses sauf indication explicite contraire.'
      : 'Drivveme does not reimburse expenses unless explicitly stated.',
    section5Title: language === 'fr' ? '5. Conformité aux lois' : '5. Compliance With Laws',
    section5Intro: language === 'fr' ? 'Vous acceptez de :' : 'You agree to:',
    section5Items: language === 'fr' ? [
      'Détenir un permis de conduire valide.',
      'Maintenir l\'assurance légalement requise en tout temps.',
      'Respecter toutes les lois fédérales, provinciales et municipales.',
      'Suivre le code de la route et les règlements de sécurité.',
    ] : [
      'Hold a valid driver\'s license.',
      'Maintain legally required insurance at all times.',
      'Comply with all federal, provincial, and municipal laws.',
      'Follow traffic laws and safety regulations.',
    ],
    section5Note: language === 'fr'
      ? 'Vous êtes seul responsable de vous assurer que vous êtes légalement admissible à fournir des services de transport.'
      : 'You are solely responsible for ensuring you are legally eligible to provide transportation services.',
    section6Title: language === 'fr' ? '6. Divulgation des antécédents et véracité' : '6. Background Disclosure and Truthfulness',
    section6Intro: language === 'fr' ? 'Vous confirmez que :' : 'You confirm that:',
    section6Items: language === 'fr' ? [
      'Toutes les informations fournies lors de l\'inscription sont exactes et véridiques.',
      'Vous mettrez rapidement à jour vos informations si les circonstances changent.',
      'Fournir des informations fausses ou trompeuses peut entraîner une suspension ou une résiliation.',
      'La divulgation d\'un casier judiciaire ne disqualifie pas automatiquement un chauffeur, mais le défaut de divulgation peut le faire.',
    ] : [
      'All information provided during signup is accurate and truthful.',
      'You will promptly update your information if circumstances change.',
      'Providing false or misleading information may result in suspension or termination.',
      'Disclosure of a criminal record does not automatically disqualify a driver, but failure to disclose may.',
    ],
    section7Title: language === 'fr' ? '7. Utilisation de la plateforme' : '7. Use of the Platform',
    section7Intro: language === 'fr' ? 'Vous acceptez de :' : 'You agree to:',
    section7Items: language === 'fr' ? [
      'Utiliser la plateforme Drivveme uniquement à des fins légales.',
      'Traiter les passagers avec respect et professionnalisme.',
      'Ne pas harceler, menacer ou discriminer les passagers.',
      'Ne pas utiliser abusivement les informations des passagers ni les contacter en dehors de la plateforme.',
    ] : [
      'Use the Drivveme platform only for lawful purposes.',
      'Treat riders respectfully and professionally.',
      'Not harass, threaten, or discriminate against riders.',
      'Not misuse rider information or contact riders outside the platform.',
    ],
    section7Note: language === 'fr'
      ? 'Drivveme se réserve le droit de surveiller l\'utilisation de la plateforme pour la sécurité et la conformité.'
      : 'Drivveme reserves the right to monitor platform usage for safety and compliance.',
    section8Title: language === 'fr' ? '8. Aucune garantie de revenus' : '8. No Guarantee of Earnings',
    section8Intro: language === 'fr' ? 'Vous comprenez et acceptez que :' : 'You understand and agree that:',
    section8Items: language === 'fr' ? [
      'Drivveme ne garantit aucun nombre minimum de courses ou de revenus.',
      'Les revenus dépendent de la demande, de l\'emplacement, de la disponibilité et des choix du chauffeur.',
      'Drivveme n\'est pas responsable des fluctuations de revenus.',
    ] : [
      'Drivveme does not guarantee any minimum number of rides or earnings.',
      'Earnings depend on demand, location, availability, and driver choices.',
      'Drivveme is not responsible for fluctuations in income.',
    ],
    section9Title: language === 'fr' ? '9. Limitation de responsabilité' : '9. Limitation of Liability',
    section9Intro: language === 'fr' ? 'Dans toute la mesure permise par la loi :' : 'To the maximum extent permitted by law:',
    section9Items: language === 'fr' ? [
      'Drivveme n\'est pas responsable des accidents, blessures, pertes ou dommages découlant des services de conduite.',
      'Drivveme n\'assume aucune responsabilité pour les interactions entre chauffeurs et passagers.',
      'Vous acceptez d\'indemniser et de dégager de toute responsabilité Drivveme des réclamations découlant de vos actions, omissions ou violations de la loi.',
    ] : [
      'Drivveme is not liable for accidents, injuries, losses, or damages arising from driving services.',
      'Drivveme does not assume responsibility for interactions between drivers and riders.',
      'You agree to indemnify and hold harmless Drivveme from claims arising from your actions, omissions, or violations of law.',
    ],
    section10Title: language === 'fr' ? '10. Assurance et risques' : '10. Insurance and Risk',
    section10Intro: language === 'fr' ? 'Vous reconnaissez que :' : 'You acknowledge that:',
    section10Items: language === 'fr' ? [
      'Vous êtes responsable de maintenir une couverture d\'assurance appropriée.',
      'Drivveme ne fournit pas d\'assurance véhicule, santé, invalidité ou indemnisation des accidents du travail.',
    ] : [
      'You are responsible for maintaining appropriate insurance coverage.',
      'Drivveme does not provide vehicle, health, disability, or workers\' compensation insurance.',
    ],
    section11Title: language === 'fr' ? '11. Suspension et résiliation' : '11. Suspension and Termination',
    section11Intro: language === 'fr' 
      ? 'Drivveme peut suspendre ou résilier votre accès à la plateforme à tout moment si :'
      : 'Drivveme may suspend or terminate your access to the platform at any time if:',
    section11Items: language === 'fr' ? [
      'Vous violez cet Accord',
      'Vous adoptez une conduite dangereuse ou illégale',
      'La documentation requise expire',
      'Vous utilisez abusivement la plateforme',
    ] : [
      'You violate this Agreement',
      'You engage in unsafe or unlawful conduct',
      'Required documentation expires',
      'You misuse the platform',
    ],
    section11Note: language === 'fr'
      ? 'Vous pouvez cesser d\'utiliser la plateforme à tout moment.'
      : 'You may stop using the platform at any time.',
    section12Title: language === 'fr' ? '12. Non-exclusivité' : '12. No Exclusivity',
    section12Text: language === 'fr'
      ? 'Cet Accord est non exclusif. Vous êtes libre de travailler avec d\'autres plateformes ou entreprises à votre discrétion.'
      : 'This Agreement is non-exclusive. You are free to work with other platforms or businesses at your discretion.',
    section13Title: language === 'fr' ? '13. Droit applicable' : '13. Governing Law',
    section13Text: language === 'fr'
      ? 'Cet Accord sera régi par les lois de la province ou de la juridiction dans laquelle Drivveme opère, sans égard aux principes de conflit de lois.'
      : 'This Agreement shall be governed by the laws of the province or jurisdiction in which Drivveme operates, without regard to conflict of law principles.',
    section14Title: language === 'fr' ? '14. Acceptation' : '14. Acceptance',
    section14Intro: language === 'fr'
      ? 'En cliquant sur « J\'accepte », en vous inscrivant en tant que chauffeur ou en utilisant la plateforme Drivveme, vous confirmez que :'
      : 'By clicking "I Agree," registering as a driver, or using the Drivveme platform, you confirm that:',
    section14Items: language === 'fr' ? [
      'Vous comprenez cet Accord',
      'Vous acceptez toutes les conditions',
      'Vous reconnaissez votre statut d\'entrepreneur indépendant',
    ] : [
      'You understand this Agreement',
      'You accept all terms',
      'You acknowledge your status as an independent contractor',
    ],
    acknowledgementTitle: language === 'fr' ? 'Reconnaissance du chauffeur' : 'Driver Acknowledgement',
    checkIndependent: language === 'fr'
      ? 'Je confirme que je suis un entrepreneur indépendant, et non un employé de Drivveme.'
      : 'I confirm that I am an independent contractor, not an employee of Drivveme.',
    checkTaxes: language === 'fr'
      ? 'Je comprends que je suis responsable de mes propres impôts et dépenses.'
      : 'I understand that I am responsible for my own taxes and expenses.',
    checkTerms: language === 'fr'
      ? 'J\'accepte les termes de cet Accord.'
      : 'I agree to the terms of this Agreement.',
    processing: language === 'fr' ? 'Traitement...' : 'Processing...',
    finished: language === 'fr' ? 'Terminé' : 'Finished',
  };

  return (
    <div className="space-y-6">
      <div className="text-center mb-6">
        <h2 className="font-display text-2xl font-bold">{t.title}</h2>
        <p className="text-sm text-muted-foreground mt-2">{t.lastUpdated}: {format(new Date(), 'MMMM d, yyyy')}</p>
      </div>

      <ScrollArea className="h-[400px] rounded-lg border border-border p-4">
        <div className="prose prose-sm max-w-none text-foreground">
          <p className="text-sm">{t.intro}</p>
          <p className="text-sm font-medium mt-4">{t.introNote}</p>

          <h3 className="text-base font-bold mt-6">{t.section1Title}</h3>
          <p className="text-sm">{t.section1Intro}</p>
          <ul className="text-sm list-disc pl-6 space-y-1">
            {t.section1Items.map((item, i) => <li key={i}>{item}</li>)}
          </ul>

          <h3 className="text-base font-bold mt-6">{t.section2Title}</h3>
          <p className="text-sm">{t.section2Intro}</p>
          <ul className="text-sm list-disc pl-6 space-y-1">
            {t.section2Items.map((item, i) => <li key={i}>{item}</li>)}
          </ul>

          <h3 className="text-base font-bold mt-6">{t.section3Title}</h3>
          <ul className="text-sm list-disc pl-6 space-y-1">
            {t.section3Items.map((item, i) => <li key={i}>{item}</li>)}
          </ul>

          <h3 className="text-base font-bold mt-6">{t.section4Title}</h3>
          <p className="text-sm">{t.section4Intro}</p>
          <ul className="text-sm list-disc pl-6 space-y-1">
            {t.section4Items.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
          <p className="text-sm mt-2">{t.section4Note}</p>

          <h3 className="text-base font-bold mt-6">{t.section5Title}</h3>
          <p className="text-sm">{t.section5Intro}</p>
          <ul className="text-sm list-disc pl-6 space-y-1">
            {t.section5Items.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
          <p className="text-sm mt-2">{t.section5Note}</p>

          <h3 className="text-base font-bold mt-6">{t.section6Title}</h3>
          <p className="text-sm">{t.section6Intro}</p>
          <ul className="text-sm list-disc pl-6 space-y-1">
            {t.section6Items.map((item, i) => <li key={i}>{item}</li>)}
          </ul>

          <h3 className="text-base font-bold mt-6">{t.section7Title}</h3>
          <p className="text-sm">{t.section7Intro}</p>
          <ul className="text-sm list-disc pl-6 space-y-1">
            {t.section7Items.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
          <p className="text-sm mt-2">{t.section7Note}</p>

          <h3 className="text-base font-bold mt-6">{t.section8Title}</h3>
          <p className="text-sm">{t.section8Intro}</p>
          <ul className="text-sm list-disc pl-6 space-y-1">
            {t.section8Items.map((item, i) => <li key={i}>{item}</li>)}
          </ul>

          <h3 className="text-base font-bold mt-6">{t.section9Title}</h3>
          <p className="text-sm">{t.section9Intro}</p>
          <ul className="text-sm list-disc pl-6 space-y-1">
            {t.section9Items.map((item, i) => <li key={i}>{item}</li>)}
          </ul>

          <h3 className="text-base font-bold mt-6">{t.section10Title}</h3>
          <p className="text-sm">{t.section10Intro}</p>
          <ul className="text-sm list-disc pl-6 space-y-1">
            {t.section10Items.map((item, i) => <li key={i}>{item}</li>)}
          </ul>

          <h3 className="text-base font-bold mt-6">{t.section11Title}</h3>
          <p className="text-sm">{t.section11Intro}</p>
          <ul className="text-sm list-disc pl-6 space-y-1">
            {t.section11Items.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
          <p className="text-sm mt-2">{t.section11Note}</p>

          <h3 className="text-base font-bold mt-6">{t.section12Title}</h3>
          <p className="text-sm">{t.section12Text}</p>

          <h3 className="text-base font-bold mt-6">{t.section13Title}</h3>
          <p className="text-sm">{t.section13Text}</p>

          <h3 className="text-base font-bold mt-6">{t.section14Title}</h3>
          <p className="text-sm">{t.section14Intro}</p>
          <ul className="text-sm list-disc pl-6 space-y-1">
            {t.section14Items.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        </div>
      </ScrollArea>

      <div className="space-y-4 pt-4 border-t border-border">
        <h3 className="font-bold text-lg">{t.acknowledgementTitle}</h3>
        
        <div className="space-y-3">
          <div className="flex items-start space-x-3">
            <Checkbox
              id="independent-contractor"
              checked={isIndependentContractor}
              onCheckedChange={(checked) => setIsIndependentContractor(checked === true)}
            />
            <label htmlFor="independent-contractor" className="text-sm cursor-pointer leading-relaxed">
              {t.checkIndependent}
            </label>
          </div>

          <div className="flex items-start space-x-3">
            <Checkbox
              id="taxes"
              checked={isResponsibleForTaxes}
              onCheckedChange={(checked) => setIsResponsibleForTaxes(checked === true)}
            />
            <label htmlFor="taxes" className="text-sm cursor-pointer leading-relaxed">
              {t.checkTaxes}
            </label>
          </div>

          <div className="flex items-start space-x-3">
            <Checkbox
              id="terms"
              checked={agreesToTerms}
              onCheckedChange={(checked) => setAgreesToTerms(checked === true)}
            />
            <label htmlFor="terms" className="text-sm cursor-pointer leading-relaxed">
              {t.checkTerms}
            </label>
          </div>
        </div>

        <Button
          onClick={handleFinish}
          disabled={!allChecked || isLoading}
          className="w-full gradient-primary shadow-button py-6"
        >
          {isLoading ? t.processing : t.finished}
        </Button>
      </div>
    </div>
  );
};

export default DriverAgreement;
