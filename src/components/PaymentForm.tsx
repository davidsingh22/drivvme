import { useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, CreditCard, Shield } from 'lucide-react';

// Initialize Stripe - this will use Stripe's test publishable key
const stripePromise = loadStripe('pk_live_51Sr74NCPDS7mXarY1uW0yyoWOUzjTxFmhqq1Qu1b4EHIKlHCXCJLHBDjWp0LXJnYYRHqgNHNCcGQbdOEfWsjJBTv00oeyeqN30');

interface PaymentFormInnerProps {
  onSuccess: () => void;
  onCancel: () => void;
}

const PaymentFormInner = ({ onSuccess, onCancel }: PaymentFormInnerProps) => {
  const stripe = useStripe();
  const elements = useElements();
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
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
      
      <PaymentElement 
        options={{
          layout: 'tabs',
        }}
      />
      
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
          disabled={!stripe || isProcessing}
          className="flex-1 gradient-primary"
        >
          {isProcessing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Processing...
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
  useState(() => {
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
  });

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
      stripe={stripePromise}
      options={{
        clientSecret,
        appearance: {
          theme: 'stripe',
          variables: {
            colorPrimary: '#06b6d4',
            borderRadius: '8px',
          },
        },
      }}
    >
      <PaymentFormInner onSuccess={onSuccess} onCancel={onCancel} />
    </Elements>
  );
};

export default PaymentForm;
