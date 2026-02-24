import { useMemo, useState, useEffect, useRef } from 'react';
import { loadStripe, PaymentRequest, Stripe } from '@stripe/stripe-js';
import {
  Elements,
  PaymentElement,
  PaymentRequestButtonElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, CreditCard, Shield, Smartphone } from 'lucide-react';
import { SavedCardsSelector, SaveCardPrompt } from '@/components/SavedCardsSelector';
import { Checkbox as CheckboxUI } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

// Global cache for Stripe instance to avoid re-fetching
let cachedStripePromise: Promise<Stripe | null> | null = null;

// Get or create Stripe promise (cached)
const getStripePromise = (): Promise<Stripe | null> => {
  if (cachedStripePromise) return cachedStripePromise;
  
  // Check sessionStorage first
  const cached = sessionStorage.getItem('stripe_pk');
  if (cached) {
    cachedStripePromise = loadStripe(cached);
    return cachedStripePromise;
  }
  
  // Fetch from edge function and cache the promise
  cachedStripePromise = (async () => {
    const { data, error } = await supabase.functions.invoke('get-stripe-config');
    if (error || !data?.publishableKey) {
      cachedStripePromise = null; // Reset on error so we can retry
      throw new Error('Failed to get Stripe config');
    }
    
    sessionStorage.setItem('stripe_pk', data.publishableKey);
    return loadStripe(data.publishableKey);
  })().then(stripe => stripe);
  
  return cachedStripePromise;
};

// Start prefetching immediately when this module loads
getStripePromise().catch(console.error);

interface PaymentFormInnerProps {
  onSuccess: (paymentMethodId?: string) => void;
  onCancel: () => void;
  amount: number;
  clientSecret: string;
}

const PaymentFormInner = ({ onSuccess, onCancel, amount, clientSecret }: PaymentFormInnerProps) => {
  const stripe = useStripe();
  const elements = useElements();
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentRequest, setPaymentRequest] = useState<PaymentRequest | null>(null);
  const [canMakePayment, setCanMakePayment] = useState(false);
  const [isElementReady, setIsElementReady] = useState(false);
  const [saveCard, setSaveCard] = useState(false);
  const paymentRequestRef = useRef<PaymentRequest | null>(null);

  // Set up Apple Pay / Google Pay
  useEffect(() => {
    if (!stripe) return;

    // Stripe warns if paymentRequest is swapped after mount; keep it stable.
    // Recreate only if amount meaningfully changes.
    if (paymentRequestRef.current) {
      try {
        // Update total on existing instance when possible.
        paymentRequestRef.current.update({
          total: {
            label: 'Ride Payment',
            amount: Math.round(amount * 100),
          },
        });
      } catch {
        // If update fails for any reason, fall back to re-creating.
        paymentRequestRef.current = null;
      }
    }

    if (paymentRequestRef.current) {
      setPaymentRequest(paymentRequestRef.current);
      return;
    }

    const pr = stripe.paymentRequest({
      // App charges in CAD; using CA/cad also improves Apple/Google Pay availability.
      country: 'CA',
      currency: 'cad',
      total: {
        label: 'Ride Payment',
        amount: Math.round(amount * 100), // Convert to cents
      },
      requestPayerName: true,
      requestPayerEmail: true,
    });

    // Check if the Payment Request is available
    pr.canMakePayment().then((result) => {
      if (result) {
        paymentRequestRef.current = pr;
        setPaymentRequest(pr);
        setCanMakePayment(true);
      }
    });

    // Handle the payment
    pr.on('paymentmethod', async (event) => {
      setIsProcessing(true);
      
      try {
        const { error, paymentIntent } = await stripe.confirmCardPayment(
          clientSecret,
          { payment_method: event.paymentMethod.id },
          { handleActions: false }
        );

        if (error) {
          event.complete('fail');
          toast({
            title: 'Payment failed',
            description: error.message,
            variant: 'destructive',
          });
        } else if (paymentIntent?.status === 'requires_action') {
          event.complete('success');
          // Handle 3D Secure if needed
          const { error: confirmError } = await stripe.confirmCardPayment(clientSecret);
          if (confirmError) {
            toast({
              title: 'Payment failed',
              description: confirmError.message,
              variant: 'destructive',
            });
          } else {
            toast({
              title: 'Payment successful!',
              description: 'Your ride has been confirmed.',
            });
            onSuccess();
          }
        } else if (paymentIntent?.status === 'succeeded') {
          event.complete('success');
          toast({
            title: 'Payment successful!',
            description: 'Your ride has been confirmed.',
          });
          onSuccess();
        }
      } catch (err: any) {
        event.complete('fail');
        toast({
          title: 'Error',
          description: err.message || 'Something went wrong',
          variant: 'destructive',
        });
      } finally {
        setIsProcessing(false);
      }
    });
  }, [stripe, amount, clientSecret, onSuccess, toast]);

  const paymentRequestButtonOptions = useMemo(() => {
    if (!paymentRequest) return undefined;
    return {
      paymentRequest,
      style: {
        paymentRequestButton: {
          type: 'default' as const,
          theme: 'dark' as const,
          height: '48px',
        },
      },
    };
  }, [paymentRequest]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements || !isElementReady) {
      toast({
        title: 'Please wait',
        description: 'Payment form is still loading...',
      });
      return;
    }

    setIsProcessing(true);

    try {
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/ride`,
          save_payment_method: saveCard,
        },
        redirect: 'if_required',
      });

      if (error) {
        toast({
          title: 'Payment failed',
          description: error.message,
          variant: 'destructive',
        });
      } else if (paymentIntent?.status === 'succeeded') {
        toast({
          title: 'Payment successful!',
          description: 'Your ride has been confirmed.',
        });
        // Pass the payment method ID if user wants to save the card
        const pmId = saveCard ? paymentIntent.payment_method as string : undefined;
        onSuccess(pmId);
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Something went wrong',
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
        <Shield className="h-4 w-4" />
        <span>Secure payment powered by Stripe</span>
      </div>

      {/* Apple Pay / Google Pay Button */}
      {canMakePayment && paymentRequest && isElementReady && paymentRequestButtonOptions && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Smartphone className="h-4 w-4" />
            <span>Express checkout</span>
          </div>
          <PaymentRequestButtonElement
            options={paymentRequestButtonOptions}
          />
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">Or pay with card</span>
            </div>
          </div>
        </div>
      )}
      
      <div className="min-h-[200px] relative">
        {!isElementReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-card z-10">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        )}
        <PaymentElement 
          options={{
            layout: 'tabs',
            wallets: {
              applePay: 'auto',
              googlePay: 'auto',
            },
          }}
          onReady={() => {
            console.log('PaymentElement ready');
            setIsElementReady(true);
          }}
          onLoadError={(error) => {
            console.error('PaymentElement load error:', error);
          }}
        />
      </div>

      {/* Save card option */}
      <div className="flex items-center space-x-2 pt-2">
        <CheckboxUI
          id="save-card"
          checked={saveCard}
          onCheckedChange={(checked) => setSaveCard(checked === true)}
        />
        <Label 
          htmlFor="save-card" 
          className="text-sm text-muted-foreground cursor-pointer"
        >
          Save this card for future payments
        </Label>
      </div>
      
      <div className="flex gap-3 pt-4">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isProcessing}
          className="flex-1"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={!stripe || !elements || isProcessing || !isElementReady}
          className="flex-1 gradient-primary"
        >
          {isProcessing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Processing...
            </>
          ) : !isElementReady ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Loading...
            </>
          ) : (
            <>
              <CreditCard className="h-4 w-4 mr-2" />
              Pay Now
            </>
          )}
        </Button>
      </div>
    </form>
  );
};

interface PaymentFormProps {
  rideId: string;
  amount: number;
  onSuccess: () => void;
  onCancel: () => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type PaymentMode = 'select' | 'new' | 'save_prompt';

const PaymentForm = ({ rideId, amount, onSuccess, onCancel }: PaymentFormProps) => {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [mode, setMode] = useState<PaymentMode>('select');
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [paymentMethodToSave, setPaymentMethodToSave] = useState<string | null>(null);
  const [isPayingWithSaved, setIsPayingWithSaved] = useState(false);
  const { toast } = useToast();
  const initKeyRef = useRef<string | null>(null);

  // Fetch Stripe config and create payment intent in PARALLEL
  useEffect(() => {
    let isMounted = true;

    // Prevent duplicate initialization loops for the same ride+amount
    const initKey = `${rideId}:${amount}`;
    if (initKeyRef.current === initKey) return;
    initKeyRef.current = initKey;

    const initialize = async () => {
      try {
        // ── POINT 1: Force-refresh session before payment intent ──
        // getSession() returns a CACHED token — it looks valid but may be expired.
        // Always call refreshSession() to guarantee a fresh JWT.
        console.log('[PaymentForm] STEP_3_FORCE_REFRESH_SESSION');
        const { data: refreshData, error: refreshErr } = await supabase.auth.refreshSession();
        if (refreshErr || !refreshData?.session) {
          throw new Error('Session expired. Please sign in again.');
        }
        console.log('[PaymentForm] STEP_3_SESSION_FRESH, expires:', new Date((refreshData.session.expires_at || 0) * 1000).toISOString());

        // Get cached stripe promise (doesn't await - just gets the promise)
        const stripePromiseToUse = getStripePromise();
        setStripePromise(stripePromiseToUse);
        
        // Create payment intent (retry a few times to handle transient backend latency)
        let lastErr: unknown = null;
        let paymentResult:
          | { data: any; error: any }
          | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          console.log(`[PaymentForm] STEP_3_PAYMENT_INTENT attempt ${attempt + 1}`, { rideId, amount });
          paymentResult = await supabase.functions.invoke('create-payment-intent', {
            body: { rideId, amount },
          });

          // ── POINT 3: Surface real error from edge function ──
          const fnError = paymentResult?.data?.error || paymentResult?.error?.message;
          console.log(`[PaymentForm] attempt ${attempt + 1} result:`, paymentResult?.data ? 'has data' : 'no data', fnError || 'OK');

          if (!paymentResult?.error && paymentResult?.data?.clientSecret) break;
          lastErr = paymentResult?.error ?? new Error(fnError || 'No client secret returned');
          await sleep(300 * Math.pow(2, attempt));
        }

        if (!isMounted) return;

        if (paymentResult?.error) {
          throw new Error(paymentResult.error.message || 'Failed to create payment');
        }

        if (!paymentResult?.data?.clientSecret) {
          throw (lastErr instanceof Error ? lastErr : new Error('Failed to create payment'));
        }

        console.log('[PaymentForm] STEP_3_PAYMENT_INTENT_CREATED');
        setClientSecret(paymentResult.data.clientSecret);
      } catch (err: any) {
        if (!isMounted) return;
        // ── POINT 3: Full error surfacing ──
        console.error('PAYMENT_FLOW_ERROR', err);
        setError(err.message);
        toast({
          title: 'Payment error',
          description: err.message || 'Failed to initialize payment. Please try again.',
          variant: 'destructive',
        });
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    initialize();

    return () => {
      isMounted = false;
    };
  }, [rideId, amount, toast]);

  const handlePayWithSavedCard = async () => {
    if (!selectedCardId) return;
    
    setIsPayingWithSaved(true);
    try {
      const { data, error } = await supabase.functions.invoke('manage-saved-cards', {
        body: { 
          action: 'pay_with_saved',
          cardId: selectedCardId,
          rideId,
          amount,
        },
      });

      if (error) throw error;
      
      if (data.success) {
        toast({
          title: 'Payment successful!',
          description: 'Your ride has been confirmed.',
        });
        onSuccess();
      } else {
        throw new Error('Payment was not successful');
      }
    } catch (err: any) {
      toast({
        title: 'Payment failed',
        description: err.message || 'Failed to process payment with saved card',
        variant: 'destructive',
      });
    } finally {
      setIsPayingWithSaved(false);
    }
  };

  const handleNewCardSuccess = (paymentMethodId?: string) => {
    if (paymentMethodId) {
      setPaymentMethodToSave(paymentMethodId);
      setMode('save_prompt');
    } else {
      onSuccess();
    }
  };

  // Show save card prompt after payment
  if (mode === 'save_prompt' && paymentMethodToSave) {
    return (
      <SaveCardPrompt
        paymentMethodId={paymentMethodToSave}
        onSaved={onSuccess}
        onSkip={onSuccess}
      />
    );
  }

  // Card selection mode
  if (mode === 'select') {
    return (
      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Shield className="h-4 w-4" />
          <span>Secure payment powered by Stripe</span>
        </div>

        <SavedCardsSelector
          onSelectCard={setSelectedCardId}
          onPayWithNew={() => setMode('new')}
          selectedCardId={selectedCardId}
        />

        {selectedCardId && (
          <Button
            className="w-full gradient-primary"
            onClick={handlePayWithSavedCard}
            disabled={isPayingWithSaved}
          >
            {isPayingWithSaved ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Processing...
              </>
            ) : (
              <>
                <CreditCard className="h-4 w-4 mr-2" />
                Pay ${amount.toFixed(2)} CAD
              </>
            )}
          </Button>
        )}

        <Button
          variant="outline"
          className="w-full"
          onClick={onCancel}
        >
          Cancel
        </Button>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-6">
        <p className="text-destructive text-center">{error}</p>
        <div className="mt-4 flex gap-3">
          <Button
            onClick={() => {
              initKeyRef.current = null;
              setError(null);
              setIsLoading(true);
              setClientSecret(null);
              setStripePromise(null);
              setMode('select');
            }}
            className="flex-1"
          >
            Retry
          </Button>
          <Button onClick={onCancel} variant="outline" className="flex-1">
            Go Back
          </Button>
        </div>
      </Card>
    );
  }

  if (isLoading || !clientSecret || !stripePromise) {
    return (
      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Shield className="h-4 w-4" />
          <span>Secure payment powered by Stripe</span>
        </div>
        {/* Skeleton loader that matches the payment form layout */}
        <div className="space-y-4">
          <Skeleton className="h-12 w-full rounded-lg" />
          <Skeleton className="h-12 w-full rounded-lg" />
          <div className="flex gap-3 pt-4">
            <Skeleton className="h-12 flex-1 rounded-lg" />
            <Skeleton className="h-12 flex-1 rounded-lg" />
          </div>
        </div>
        <p className="text-center text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
          Loading payment form...
        </p>
      </Card>
    );
  }

  return (
    <Elements
      key={clientSecret}
      stripe={stripePromise}
      options={{
        clientSecret,
        appearance: {
          theme: 'night',
          variables: {
            colorPrimary: '#a855f7',
            colorBackground: '#0f0f12',
            colorText: '#fafafa',
            colorTextSecondary: '#a1a1aa',
            colorTextPlaceholder: '#71717a',
            colorDanger: '#ef4444',
            colorSuccess: '#22c55e',
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSizeBase: '16px',
            borderRadius: '12px',
            spacingUnit: '4px',
            focusBoxShadow: '0 0 0 2px rgba(168, 85, 247, 0.4)',
            focusOutline: 'none',
          },
          rules: {
            '.Input': {
              backgroundColor: '#1a1a1f',
              border: '1px solid #2a2a32',
              boxShadow: 'none',
              padding: '12px 14px',
            },
            '.Input:hover': {
              border: '1px solid #3a3a45',
            },
            '.Input:focus': {
              border: '1px solid #a855f7',
              boxShadow: '0 0 0 2px rgba(168, 85, 247, 0.2)',
            },
            '.Label': {
              color: '#a1a1aa',
              fontSize: '14px',
              fontWeight: '500',
              marginBottom: '8px',
            },
            '.Tab': {
              backgroundColor: '#1a1a1f',
              border: '1px solid #2a2a32',
              color: '#a1a1aa',
            },
            '.Tab:hover': {
              backgroundColor: '#252530',
              border: '1px solid #3a3a45',
            },
            '.Tab--selected': {
              backgroundColor: '#a855f7',
              border: '1px solid #a855f7',
              color: '#ffffff',
            },
            '.TabIcon': {
              fill: '#a1a1aa',
            },
            '.TabIcon--selected': {
              fill: '#ffffff',
            },
            '.Error': {
              color: '#ef4444',
              fontSize: '14px',
            },
          },
        },
      }}
    >
      <PaymentFormInner 
        onSuccess={handleNewCardSuccess} 
        onCancel={() => setMode('select')} 
        amount={amount} 
        clientSecret={clientSecret} 
      />
    </Elements>
  );
};

export default PaymentForm;
