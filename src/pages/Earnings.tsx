import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { DollarSign, TrendingUp, Calendar, Car, ArrowUp, ArrowDown, Wallet, ExternalLink, Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { formatCurrency } from '@/lib/pricing';
import { useToast } from '@/hooks/use-toast';
import Navbar from '@/components/Navbar';

const PLATFORM_FEE = 5.00;

interface EarningsSummary {
  totalEarnings: number;
  totalFares: number;
  totalPlatformFees: number;
  totalRides: number;
  availableBalance: number;
}

interface DailyEarnings {
  date: string;
  earnings: number;
  rides: number;
  fares: number;
}

const Earnings = () => {
  const { t, language } = useLanguage();
  const { user, isDriver, driverProfile, isLoading: authLoading, refreshDriverProfile } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();

  const [period, setPeriod] = useState<'today' | 'week' | 'month' | 'all'>('week');
  const [summary, setSummary] = useState<EarningsSummary>({
    totalEarnings: 0,
    totalFares: 0,
    totalPlatformFees: 0,
    totalRides: 0,
    availableBalance: 0,
  });
  const [dailyData, setDailyData] = useState<DailyEarnings[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [payoutDialog, setPayoutDialog] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState('');
  const [isProcessingPayout, setIsProcessingPayout] = useState(false);

  useEffect(() => {
    if (!authLoading && (!user || !isDriver)) {
      navigate('/login');
    }
  }, [user, isDriver, authLoading, navigate]);

  useEffect(() => {
    // Check if returning from Stripe onboarding
    if (searchParams.get('onboarded') === 'true') {
      toast({
        title: 'Payment Setup Complete',
        description: 'You can now withdraw your earnings!',
      });
    }
  }, [searchParams, toast]);

  useEffect(() => {
    if (!user) return;

    const fetchEarnings = async () => {
      setIsLoading(true);

      let startDate: Date;
      const now = new Date();

      switch (period) {
        case 'today':
          startDate = new Date(now.setHours(0, 0, 0, 0));
          break;
        case 'week':
          startDate = new Date(now.setDate(now.getDate() - 7));
          break;
        case 'month':
          startDate = new Date(now.setMonth(now.getMonth() - 1));
          break;
        case 'all':
          startDate = new Date(0);
          break;
      }

      const { data, error } = await supabase
        .from('rides')
        .select('actual_fare, driver_earnings, platform_fee, dropoff_at')
        .eq('driver_id', user.id)
        .eq('status', 'completed')
        .gte('dropoff_at', startDate.toISOString())
        .order('dropoff_at', { ascending: false });

      if (error) {
        console.error('Error fetching earnings:', error);
        setIsLoading(false);
        return;
      }

      if (data) {
        // Calculate summary
        const totalEarnings = data.reduce((sum, r) => sum + (Number(r.driver_earnings) || 0), 0);
        const totalFares = data.reduce((sum, r) => sum + (Number(r.actual_fare) || 0), 0);
        const totalPlatformFees = data.reduce((sum, r) => sum + (Number(r.platform_fee) || 0), 0);
        const availableBalance = Number(driverProfile?.total_earnings) || 0;

        setSummary({
          totalEarnings,
          totalFares,
          totalPlatformFees,
          totalRides: data.length,
          availableBalance,
        });

        // Group by day
        const dailyMap: Record<string, DailyEarnings> = {};
        data.forEach((ride) => {
          const date = new Date(ride.dropoff_at!).toLocaleDateString(language === 'fr' ? 'fr-CA' : 'en-CA');
          if (!dailyMap[date]) {
            dailyMap[date] = { date, earnings: 0, rides: 0, fares: 0 };
          }
          dailyMap[date].earnings += Number(ride.driver_earnings) || 0;
          dailyMap[date].fares += Number(ride.actual_fare) || 0;
          dailyMap[date].rides += 1;
        });

        setDailyData(Object.values(dailyMap));
      }

      setIsLoading(false);
    };

    fetchEarnings();
  }, [user, period, language, driverProfile?.total_earnings]);

  const handlePayout = async () => {
    const amount = parseFloat(payoutAmount);
    const availableBalance = Number(driverProfile?.total_earnings) || 0;

    if (isNaN(amount) || amount <= 0) {
      toast({
        title: 'Invalid Amount',
        description: 'Please enter a valid amount to withdraw',
        variant: 'destructive',
      });
      return;
    }

    if (amount > availableBalance) {
      toast({
        title: 'Insufficient Balance',
        description: `You can only withdraw up to ${formatCurrency(availableBalance, language)}`,
        variant: 'destructive',
      });
      return;
    }

    setIsProcessingPayout(true);
    try {
      const { data, error } = await supabase.functions.invoke('driver-payout', {
        body: { amount }
      });

      if (error) throw error;

      if (data.needsOnboarding) {
        // Redirect to Stripe onboarding
        toast({
          title: 'Setup Required',
          description: 'Please complete your payment account setup',
        });
        window.location.href = data.onboardingUrl;
        return;
      }

      toast({
        title: 'Payout Successful! 🎉',
        description: data.message,
      });

      setPayoutDialog(false);
      setPayoutAmount('');
      
      // Refresh driver profile to get updated balance
      if (refreshDriverProfile) {
        await refreshDriverProfile();
      }

      // Update local state
      setSummary(prev => ({
        ...prev,
        availableBalance: data.newBalance
      }));

    } catch (error: any) {
      console.error('Payout error:', error);
      toast({
        title: 'Payout Failed',
        description: error.message || 'Failed to process payout',
        variant: 'destructive',
      });
    } finally {
      setIsProcessingPayout(false);
    }
  };

  const availableBalance = Number(driverProfile?.total_earnings) || 0;

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">{t('common.loading')}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      <div className="pt-24 pb-12 container mx-auto px-4 max-w-3xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <h1 className="font-display text-3xl font-bold mb-8">{t('nav.earnings')}</h1>

          {/* Available Balance Card with Withdraw Button */}
          <Card className="p-6 mb-6 gradient-card border-primary/20">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                  <Wallet className="h-5 w-5" />
                  <span>Available Balance</span>
                </div>
                <p className="font-display text-4xl font-bold text-accent">
                  {formatCurrency(availableBalance, language)}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Ready to withdraw anytime
                </p>
              </div>
              <Button 
                size="lg" 
                onClick={() => setPayoutDialog(true)}
                disabled={availableBalance <= 0}
                className="gap-2"
              >
                <ExternalLink className="h-4 w-4" />
                Withdraw
              </Button>
            </div>
          </Card>

          {/* Period Tabs */}
          <Tabs value={period} onValueChange={(v) => setPeriod(v as typeof period)} className="mb-6">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="today">Today</TabsTrigger>
              <TabsTrigger value="week">Week</TabsTrigger>
              <TabsTrigger value="month">Month</TabsTrigger>
              <TabsTrigger value="all">All Time</TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Summary Cards */}
          <div className="grid grid-cols-2 gap-4 mb-8">
            <Card className="p-6">
              <div className="flex items-center gap-2 text-muted-foreground mb-2">
                <DollarSign className="h-5 w-5" />
                <span>Period Earnings</span>
              </div>
              <p className="font-display text-3xl font-bold">
                {formatCurrency(summary.totalEarnings, language)}
              </p>
            </Card>
            <Card className="p-6">
              <div className="flex items-center gap-2 text-muted-foreground mb-2">
                <Car className="h-5 w-5" />
                <span>Completed Rides</span>
              </div>
              <p className="font-display text-3xl font-bold">
                {summary.totalRides}
              </p>
            </Card>
          </div>

          {/* Breakdown */}
          <Card className="p-6 mb-8">
            <h3 className="font-display text-lg font-semibold mb-4">Earnings Breakdown</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <ArrowUp className="h-4 w-4 text-success" />
                  <span>Total Fares Collected</span>
                </div>
                <span className="font-medium">{formatCurrency(summary.totalFares, language)}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <ArrowDown className="h-4 w-4 text-destructive" />
                  <span>Platform Fees ({formatCurrency(PLATFORM_FEE, language)}/ride)</span>
                </div>
                <span className="font-medium text-destructive">-{formatCurrency(summary.totalPlatformFees, language)}</span>
              </div>
              <div className="flex items-center justify-between pt-3 border-t border-border">
                <span className="font-semibold">Your Earnings</span>
                <span className="font-bold text-lg text-accent">{formatCurrency(summary.totalEarnings, language)}</span>
              </div>
            </div>
          </Card>

          {/* Lifetime Stats from profile */}
          {driverProfile && (
            <Card className="p-6 mb-8 bg-muted/50">
              <h3 className="font-display text-lg font-semibold mb-4">Lifetime Stats</h3>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-2xl font-bold">{driverProfile.total_rides}</p>
                  <p className="text-sm text-muted-foreground">Total Rides</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-accent">
                    {formatCurrency(Number(driverProfile.total_earnings), language)}
                  </p>
                  <p className="text-sm text-muted-foreground">Available</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-warning">
                    {Number(driverProfile.average_rating).toFixed(1)}
                  </p>
                  <p className="text-sm text-muted-foreground">Rating</p>
                </div>
              </div>
            </Card>
          )}

          {/* Daily Breakdown */}
          {!isLoading && dailyData.length > 0 && (
            <div>
              <h3 className="font-display text-lg font-semibold mb-4">Daily Breakdown</h3>
              <div className="space-y-3">
                {dailyData.map((day, index) => (
                  <motion.div
                    key={day.date}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.05 }}
                  >
                    <Card className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Calendar className="h-5 w-5 text-muted-foreground" />
                          <div>
                            <p className="font-medium">{day.date}</p>
                            <p className="text-sm text-muted-foreground">{day.rides} rides</p>
                          </div>
                        </div>
                        <p className="font-bold text-accent">
                          {formatCurrency(day.earnings, language)}
                        </p>
                      </div>
                    </Card>
                  </motion.div>
                ))}
              </div>
            </div>
          )}

          {!isLoading && dailyData.length === 0 && (
            <Card className="p-12 text-center">
              <TrendingUp className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="font-display text-xl font-semibold mb-2">No earnings yet</h3>
              <p className="text-muted-foreground">
                Complete rides to start earning!
              </p>
            </Card>
          )}
        </motion.div>
      </div>

      {/* Payout Dialog */}
      <Dialog open={payoutDialog} onOpenChange={setPayoutDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Withdraw Earnings</DialogTitle>
            <DialogDescription>
              Transfer funds directly to your bank account. Available balance: {formatCurrency(availableBalance, language)}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium">Amount to withdraw</label>
              <div className="relative mt-2">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <Input
                  type="number"
                  placeholder="0.00"
                  value={payoutAmount}
                  onChange={(e) => setPayoutAmount(e.target.value)}
                  className="pl-8"
                  min="0"
                  max={availableBalance}
                  step="0.01"
                />
              </div>
              <div className="flex gap-2 mt-2">
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => setPayoutAmount((availableBalance * 0.25).toFixed(2))}
                >
                  25%
                </Button>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => setPayoutAmount((availableBalance * 0.5).toFixed(2))}
                >
                  50%
                </Button>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => setPayoutAmount((availableBalance * 0.75).toFixed(2))}
                >
                  75%
                </Button>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => setPayoutAmount(availableBalance.toFixed(2))}
                >
                  Max
                </Button>
              </div>
            </div>
            
            <div className="p-4 bg-muted rounded-lg">
              <p className="text-sm text-muted-foreground">
                Funds will be transferred to your connected bank account. First-time users will need to complete a quick setup process.
              </p>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayoutDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handlePayout} disabled={isProcessingPayout || !payoutAmount}>
              {isProcessingPayout && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Withdraw {payoutAmount ? formatCurrency(parseFloat(payoutAmount) || 0, language) : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Earnings;
