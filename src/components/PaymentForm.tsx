import { useState, useEffect } from 'react';
import { loadStripe, PaymentRequest } from '@stripe/stripe-js';
import {
  Elements,
  PaymentElement,
  PaymentRequestButtonElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, CreditCard, Shield, Smartphone } from 'lucide-react';

// Initialize Stripe
const stripePromise = loadStripe('pk_live_51Sr74NCPDS7mXarY1uW0yyoWOUzjTxFmhqq1Qu1b4EHIKlHCXCJLHBDjWp0LXJnYYRHqgNHNCcGQbdOEfWsjJBTv00oeyeqN30');

interface PaymentFormInnerProps {
  onSuccess: () => void;
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

  // Set up Apple Pay / Google Pay
  useEffect(() => {
    if (!stripe) return;

    const pr = stripe.paymentRequest({
      country: 'US',
      currency: 'usd',
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
        onSuccess();
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
      {canMakePayment && paymentRequest && isElementReady && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Smartphone className="h-4 w-4" />
            <span>Express checkout</span>
          </div>
          <PaymentRequestButtonElement
            options={{
              paymentRequest,
              style: {
                paymentRequestButton: {
                  type: 'default',
                  theme: 'dark',
                  height: '48px',
                },
              },
            }}
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

const PaymentForm = ({ rideId, amount, onSuccess, onCancel }: PaymentFormProps) => {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  // Create payment intent on mount
  useEffect(() => {
    const createPaymentIntent = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        
        if (!session) {
          throw new Error('Not authenticated');
        }

        const response = await supabase.functions.invoke('create-payment-intent', {
          body: { rideId, amount },
        });

        if (response.error) {
          throw new Error(response.error.message);
        }

        setClientSecret(response.data.clientSecret);
      } catch (err: any) {
        console.error('Error creating payment intent:', err);
        setError(err.message);
        toast({
          title: 'Error',
          description: 'Failed to initialize payment. Please try again.',
          variant: 'destructive',
        });
      }
    };

    createPaymentIntent();
  }, [rideId, amount, toast]);

  if (error) {
    return (
      <Card className="p-6">
        <p className="text-destructive text-center">{error}</p>
        <Button onClick={onCancel} variant="outline" className="w-full mt-4">
          Go Back
        </Button>
      </Card>
    );
  }

  if (!clientSecret) {
    return (
      <Card className="p-6 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
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
      <PaymentFormInner onSuccess={onSuccess} onCancel={onCancel} amount={amount} clientSecret={clientSecret} />
    </Elements>
  );
};

export default PaymentForm;
