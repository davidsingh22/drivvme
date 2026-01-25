import { useState } from 'react';
import { Loader2, Mail, Phone, AlertCircle, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';
import { formatCurrency } from '@/lib/pricing';

interface WithdrawDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availableBalance: number;
  driverId: string;
  onSuccess?: () => void;
}

export function WithdrawDialog({
  open,
  onOpenChange,
  availableBalance,
  driverId,
  onSuccess,
}: WithdrawDialogProps) {
  const { language } = useLanguage();
  const { toast } = useToast();

  const [step, setStep] = useState<'amount' | 'contact' | 'success'>('amount');
  const [amount, setAmount] = useState('');
  const [contactMethod, setContactMethod] = useState<'email' | 'phone'>('email');
  const [contactValue, setContactValue] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const handleClose = () => {
    setStep('amount');
    setAmount('');
    setContactValue('');
    onOpenChange(false);
  };

  const handleAmountNext = () => {
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      toast({
        title: language === 'fr' ? 'Montant invalide' : 'Invalid Amount',
        description: language === 'fr' ? 'Veuillez entrer un montant valide' : 'Please enter a valid amount',
        variant: 'destructive',
      });
      return;
    }
    if (numAmount > availableBalance) {
      toast({
        title: language === 'fr' ? 'Solde insuffisant' : 'Insufficient Balance',
        description: language === 'fr' 
          ? `Vous ne pouvez retirer que ${formatCurrency(availableBalance, language)}`
          : `You can only withdraw up to ${formatCurrency(availableBalance, language)}`,
        variant: 'destructive',
      });
      return;
    }
    setStep('contact');
  };

  const handleSubmit = async () => {
    if (!contactValue.trim()) {
      toast({
        title: language === 'fr' ? 'Contact requis' : 'Contact Required',
        description: contactMethod === 'email'
          ? (language === 'fr' ? 'Veuillez entrer votre email' : 'Please enter your email')
          : (language === 'fr' ? 'Veuillez entrer votre numéro de téléphone' : 'Please enter your phone number'),
        variant: 'destructive',
      });
      return;
    }

    // Basic validation
    if (contactMethod === 'email' && !contactValue.includes('@')) {
      toast({
        title: language === 'fr' ? 'Email invalide' : 'Invalid Email',
        description: language === 'fr' ? 'Veuillez entrer un email valide' : 'Please enter a valid email',
        variant: 'destructive',
      });
      return;
    }

    setIsProcessing(true);
    try {
      // Insert withdraw request
      const { error } = await supabase
        .from('withdraw_requests')
        .insert({
          driver_id: driverId,
          amount: parseFloat(amount),
          contact_method: contactMethod,
          contact_value: contactValue.trim(),
          status: 'pending',
        });

      if (error) throw error;

      // Create notification for admins (they'll see it via realtime)
      // We also create an in-app notification
      const { data: admins } = await supabase
        .from('user_roles')
        .select('user_id')
        .eq('role', 'admin');

      if (admins && admins.length > 0) {
        const notifications = admins.map((admin) => ({
          user_id: admin.user_id,
          type: 'withdraw_request',
          title: '💰 New Withdraw Request',
          message: `Driver requested ${formatCurrency(parseFloat(amount), 'en')} via ${contactMethod}: ${contactValue}`,
        }));

        await supabase.from('notifications').insert(notifications);
      }

      setStep('success');
      toast({
        title: language === 'fr' ? 'Demande envoyée! 🎉' : 'Request Sent! 🎉',
        description: language === 'fr'
          ? 'Vous recevrez votre e-transfert dans 1 heure'
          : 'You will receive your e-transfer within 1 hour',
      });

      onSuccess?.();
    } catch (error: any) {
      console.error('Withdraw error:', error);
      toast({
        title: language === 'fr' ? 'Erreur' : 'Error',
        description: error.message || (language === 'fr' ? 'Échec de la demande' : 'Failed to submit request'),
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        {step === 'amount' && (
          <>
            <DialogHeader>
              <DialogTitle>
                {language === 'fr' ? 'Retirer vos gains' : 'Withdraw Earnings'}
              </DialogTitle>
              <DialogDescription>
                {language === 'fr'
                  ? `Solde disponible: ${formatCurrency(availableBalance, language)}`
                  : `Available balance: ${formatCurrency(availableBalance, language)}`}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div>
                <Label>{language === 'fr' ? 'Montant à retirer' : 'Amount to withdraw'}</Label>
                <div className="relative mt-2">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                  <Input
                    type="number"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="pl-8"
                    min="0"
                    max={availableBalance}
                    step="0.01"
                  />
                </div>
                <div className="flex gap-2 mt-3">
                  {[25, 50, 75, 100].map((pct) => (
                    <Button
                      key={pct}
                      variant="outline"
                      size="sm"
                      onClick={() => setAmount((availableBalance * pct / 100).toFixed(2))}
                    >
                      {pct}%
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>
                {language === 'fr' ? 'Annuler' : 'Cancel'}
              </Button>
              <Button onClick={handleAmountNext}>
                {language === 'fr' ? 'Suivant' : 'Next'}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'contact' && (
          <>
            <DialogHeader>
              <DialogTitle>
                {language === 'fr' ? 'Où envoyer le e-transfert?' : 'Where to send e-transfer?'}
              </DialogTitle>
              <DialogDescription>
                {language === 'fr'
                  ? 'Vous recevrez votre paiement dans 1 heure'
                  : 'You will receive your payment within 1 hour'}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <RadioGroup
                value={contactMethod}
                onValueChange={(v) => setContactMethod(v as 'email' | 'phone')}
                className="grid grid-cols-2 gap-4"
              >
                <Label
                  htmlFor="email"
                  className={`flex items-center gap-2 p-4 rounded-lg border-2 cursor-pointer transition-colors ${
                    contactMethod === 'email' ? 'border-primary bg-primary/5' : 'border-border'
                  }`}
                >
                  <RadioGroupItem value="email" id="email" />
                  <Mail className="h-4 w-4" />
                  Email
                </Label>
                <Label
                  htmlFor="phone"
                  className={`flex items-center gap-2 p-4 rounded-lg border-2 cursor-pointer transition-colors ${
                    contactMethod === 'phone' ? 'border-primary bg-primary/5' : 'border-border'
                  }`}
                >
                  <RadioGroupItem value="phone" id="phone" />
                  <Phone className="h-4 w-4" />
                  {language === 'fr' ? 'Téléphone' : 'Phone'}
                </Label>
              </RadioGroup>

              <div>
                <Label>
                  {contactMethod === 'email'
                    ? (language === 'fr' ? 'Adresse email' : 'Email address')
                    : (language === 'fr' ? 'Numéro de téléphone' : 'Phone number')}
                </Label>
                <Input
                  type={contactMethod === 'email' ? 'email' : 'tel'}
                  placeholder={contactMethod === 'email' ? 'you@example.com' : '+1 (555) 123-4567'}
                  value={contactValue}
                  onChange={(e) => setContactValue(e.target.value)}
                  className="mt-2"
                />
              </div>

              <div className="flex items-start gap-2 p-3 bg-muted rounded-lg">
                <AlertCircle className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                <p className="text-sm text-muted-foreground">
                  {language === 'fr'
                    ? `Vous recevrez ${formatCurrency(parseFloat(amount) || 0, language)} par Interac e-Transfert`
                    : `You will receive ${formatCurrency(parseFloat(amount) || 0, language)} via Interac e-Transfer`}
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('amount')}>
                {language === 'fr' ? 'Retour' : 'Back'}
              </Button>
              <Button onClick={handleSubmit} disabled={isProcessing}>
                {isProcessing && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {language === 'fr' ? 'Confirmer' : 'Confirm'}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'success' && (
          <>
            <div className="py-8 text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center mx-auto">
                <CheckCircle className="h-8 w-8 text-success" />
              </div>
              <div>
                <h3 className="text-xl font-bold">
                  {language === 'fr' ? 'Demande envoyée!' : 'Request Sent!'}
                </h3>
                <p className="text-muted-foreground mt-2">
                  {language === 'fr'
                    ? `${formatCurrency(parseFloat(amount), language)} sera envoyé à ${contactValue}`
                    : `${formatCurrency(parseFloat(amount), language)} will be sent to ${contactValue}`}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {language === 'fr' ? 'Délai: environ 1 heure' : 'ETA: approximately 1 hour'}
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button onClick={handleClose} className="w-full">
                {language === 'fr' ? 'Terminé' : 'Done'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
