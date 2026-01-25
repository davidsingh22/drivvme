import { useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { format } from 'date-fns';

interface DriverAgreementProps {
  onComplete: (agreementData: {
    isIndependentContractor: boolean;
    isResponsibleForTaxes: boolean;
    agreesToTerms: boolean;
  }) => void;
  isLoading?: boolean;
}

const DriverAgreement = ({ onComplete, isLoading }: DriverAgreementProps) => {
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

  return (
    <div className="space-y-6">
      <div className="text-center mb-6">
        <h2 className="font-display text-2xl font-bold">DRIVVEME DRIVER INDEPENDENT CONTRACTOR AGREEMENT</h2>
        <p className="text-sm text-muted-foreground mt-2">Last Updated: {format(new Date(), 'MMMM d, yyyy')}</p>
      </div>

      <ScrollArea className="h-[400px] rounded-lg border border-border p-4">
        <div className="prose prose-sm max-w-none text-foreground">
          <p className="text-sm">
            This Driver Independent Contractor Agreement ("Agreement") is entered into between Drivveme ("Drivveme," "we," "us," or "the Company") and the individual driver ("Driver," "you," or "your") who accepts this Agreement through the Drivveme platform.
          </p>
          <p className="text-sm font-medium mt-4">
            By registering as a driver and using the Drivveme platform, you acknowledge that you have read, understood, and agreed to the terms below.
          </p>

          <h3 className="text-base font-bold mt-6">1. Independent Contractor Relationship</h3>
          <p className="text-sm">You acknowledge and agree that:</p>
          <ul className="text-sm list-disc pl-6 space-y-1">
            <li>You are an independent contractor and not an employee, partner, agent, or representative of Drivveme.</li>
            <li>Nothing in this Agreement creates an employment relationship.</li>
            <li>You are free to determine when, where, and how often you provide driving services.</li>
            <li>You are not required to accept any specific ride request.</li>
            <li>Drivveme does not control how you perform services, only the operation of the platform.</li>
          </ul>

          <h3 className="text-base font-bold mt-6">2. Taxes and Financial Responsibilities</h3>
          <p className="text-sm">You are solely responsible for:</p>
          <ul className="text-sm list-disc pl-6 space-y-1">
            <li>Reporting and paying all applicable taxes, including income tax, sales tax, GST/HST, QST, CPP, EI (if applicable), and any other government charges.</li>
            <li>Filing your own tax returns and maintaining your own accounting records.</li>
            <li>Any penalties, interest, audits, or liabilities arising from your tax obligations.</li>
            <li>Drivveme does not withhold taxes on your behalf.</li>
          </ul>

          <h3 className="text-base font-bold mt-6">3. Payments and Fees</h3>
          <ul className="text-sm list-disc pl-6 space-y-1">
            <li>Drivveme facilitates payments between riders and drivers through the platform.</li>
            <li>Drivveme may deduct platform service fees as disclosed in the app.</li>
            <li>You are responsible for reviewing your earnings and transactions.</li>
            <li>Drivveme is not responsible for driver errors, missed earnings, or financial mismanagement by the driver.</li>
          </ul>

          <h3 className="text-base font-bold mt-6">4. Expenses</h3>
          <p className="text-sm">As an independent contractor, you are responsible for all costs related to driving, including but not limited to:</p>
          <ul className="text-sm list-disc pl-6 space-y-1">
            <li>Vehicle purchase or lease</li>
            <li>Fuel, maintenance, and repairs</li>
            <li>Insurance</li>
            <li>Licensing and permits</li>
            <li>Mobile phone and data usage</li>
          </ul>
          <p className="text-sm mt-2">Drivveme does not reimburse expenses unless explicitly stated.</p>

          <h3 className="text-base font-bold mt-6">5. Compliance With Laws</h3>
          <p className="text-sm">You agree to:</p>
          <ul className="text-sm list-disc pl-6 space-y-1">
            <li>Hold a valid driver's license.</li>
            <li>Maintain legally required insurance at all times.</li>
            <li>Comply with all federal, provincial, and municipal laws.</li>
            <li>Follow traffic laws and safety regulations.</li>
          </ul>
          <p className="text-sm mt-2">You are solely responsible for ensuring you are legally eligible to provide transportation services.</p>

          <h3 className="text-base font-bold mt-6">6. Background Disclosure and Truthfulness</h3>
          <p className="text-sm">You confirm that:</p>
          <ul className="text-sm list-disc pl-6 space-y-1">
            <li>All information provided during signup is accurate and truthful.</li>
            <li>You will promptly update your information if circumstances change.</li>
            <li>Providing false or misleading information may result in suspension or termination.</li>
            <li>Disclosure of a criminal record does not automatically disqualify a driver, but failure to disclose may.</li>
          </ul>

          <h3 className="text-base font-bold mt-6">7. Use of the Platform</h3>
          <p className="text-sm">You agree to:</p>
          <ul className="text-sm list-disc pl-6 space-y-1">
            <li>Use the Drivveme platform only for lawful purposes.</li>
            <li>Treat riders respectfully and professionally.</li>
            <li>Not harass, threaten, or discriminate against riders.</li>
            <li>Not misuse rider information or contact riders outside the platform.</li>
          </ul>
          <p className="text-sm mt-2">Drivveme reserves the right to monitor platform usage for safety and compliance.</p>

          <h3 className="text-base font-bold mt-6">8. No Guarantee of Earnings</h3>
          <p className="text-sm">You understand and agree that:</p>
          <ul className="text-sm list-disc pl-6 space-y-1">
            <li>Drivveme does not guarantee any minimum number of rides or earnings.</li>
            <li>Earnings depend on demand, location, availability, and driver choices.</li>
            <li>Drivveme is not responsible for fluctuations in income.</li>
          </ul>

          <h3 className="text-base font-bold mt-6">9. Limitation of Liability</h3>
          <p className="text-sm">To the maximum extent permitted by law:</p>
          <ul className="text-sm list-disc pl-6 space-y-1">
            <li>Drivveme is not liable for accidents, injuries, losses, or damages arising from driving services.</li>
            <li>Drivveme does not assume responsibility for interactions between drivers and riders.</li>
            <li>You agree to indemnify and hold harmless Drivveme from claims arising from your actions, omissions, or violations of law.</li>
          </ul>

          <h3 className="text-base font-bold mt-6">10. Insurance and Risk</h3>
          <p className="text-sm">You acknowledge that:</p>
          <ul className="text-sm list-disc pl-6 space-y-1">
            <li>You are responsible for maintaining appropriate insurance coverage.</li>
            <li>Drivveme does not provide vehicle, health, disability, or workers' compensation insurance.</li>
          </ul>

          <h3 className="text-base font-bold mt-6">11. Suspension and Termination</h3>
          <p className="text-sm">Drivveme may suspend or terminate your access to the platform at any time if:</p>
          <ul className="text-sm list-disc pl-6 space-y-1">
            <li>You violate this Agreement</li>
            <li>You engage in unsafe or unlawful conduct</li>
            <li>Required documentation expires</li>
            <li>You misuse the platform</li>
          </ul>
          <p className="text-sm mt-2">You may stop using the platform at any time.</p>

          <h3 className="text-base font-bold mt-6">12. No Exclusivity</h3>
          <p className="text-sm">This Agreement is non-exclusive. You are free to work with other platforms or businesses at your discretion.</p>

          <h3 className="text-base font-bold mt-6">13. Governing Law</h3>
          <p className="text-sm">This Agreement shall be governed by the laws of the province or jurisdiction in which Drivveme operates, without regard to conflict of law principles.</p>

          <h3 className="text-base font-bold mt-6">14. Acceptance</h3>
          <p className="text-sm">By clicking "I Agree," registering as a driver, or using the Drivveme platform, you confirm that:</p>
          <ul className="text-sm list-disc pl-6 space-y-1">
            <li>You understand this Agreement</li>
            <li>You accept all terms</li>
            <li>You acknowledge your status as an independent contractor</li>
          </ul>
        </div>
      </ScrollArea>

      <div className="space-y-4 pt-4 border-t border-border">
        <h3 className="font-bold text-lg">Driver Acknowledgement</h3>
        
        <div className="space-y-3">
          <div className="flex items-start space-x-3">
            <Checkbox
              id="independent-contractor"
              checked={isIndependentContractor}
              onCheckedChange={(checked) => setIsIndependentContractor(checked === true)}
            />
            <label htmlFor="independent-contractor" className="text-sm cursor-pointer leading-relaxed">
              I confirm that I am an independent contractor, not an employee of Drivveme.
            </label>
          </div>

          <div className="flex items-start space-x-3">
            <Checkbox
              id="taxes"
              checked={isResponsibleForTaxes}
              onCheckedChange={(checked) => setIsResponsibleForTaxes(checked === true)}
            />
            <label htmlFor="taxes" className="text-sm cursor-pointer leading-relaxed">
              I understand that I am responsible for my own taxes and expenses.
            </label>
          </div>

          <div className="flex items-start space-x-3">
            <Checkbox
              id="terms"
              checked={agreesToTerms}
              onCheckedChange={(checked) => setAgreesToTerms(checked === true)}
            />
            <label htmlFor="terms" className="text-sm cursor-pointer leading-relaxed">
              I agree to the terms of this Agreement.
            </label>
          </div>
        </div>

        <Button
          onClick={handleFinish}
          disabled={!allChecked || isLoading}
          className="w-full gradient-primary shadow-button py-6"
        >
          {isLoading ? 'Processing...' : 'Finished'}
        </Button>
      </div>
    </div>
  );
};

export default DriverAgreement;
