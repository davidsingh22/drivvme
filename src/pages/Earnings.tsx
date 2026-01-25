import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { DollarSign, TrendingUp, Car, ArrowUp, ArrowDown, Wallet, ExternalLink } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { formatCurrency } from '@/lib/pricing';
import { useToast } from '@/hooks/use-toast';
import Navbar from '@/components/Navbar';
import { DailyEarningsDetail } from '@/components/DailyEarningsDetail';
import { WithdrawDialog } from '@/components/WithdrawDialog';

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
  dateKey: string;
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
  const [withdrawDialogOpen, setWithdrawDialogOpen] = useState(false);

  // Force refresh driver profile on mount to ensure fresh data
  useEffect(() => {
    if (user && isDriver && refreshDriverProfile) {
      refreshDriverProfile();
    }
  }, [user, isDriver]);

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

        // Group by day - use ISO format for easier parsing
        const dailyMap: Record<string, DailyEarnings> = {};
        data.forEach((ride) => {
          const rideDate = new Date(ride.dropoff_at!);
          const dateKey = rideDate.toISOString().split('T')[0]; // YYYY-MM-DD format
          const displayDate = rideDate.toLocaleDateString(language === 'fr' ? 'fr-CA' : 'en-CA');
          if (!dailyMap[dateKey]) {
            dailyMap[dateKey] = { date: displayDate, dateKey, earnings: 0, rides: 0, fares: 0 };
          }
          dailyMap[dateKey].earnings += Number(ride.driver_earnings) || 0;
          dailyMap[dateKey].fares += Number(ride.actual_fare) || 0;
          dailyMap[dateKey].rides += 1;
        });

        setDailyData(Object.values(dailyMap));
      }

      setIsLoading(false);
    };

    fetchEarnings();
  }, [user, period, language, driverProfile?.total_earnings]);

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
                  <span>{language === 'fr' ? 'Solde disponible' : 'Available Balance'}</span>
                </div>
                <p className="font-display text-4xl font-bold text-accent">
                  {formatCurrency(availableBalance, language)}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {language === 'fr' ? 'Prêt à retirer' : 'Ready to withdraw anytime'}
                </p>
              </div>
              <Button 
                size="lg" 
                onClick={() => setWithdrawDialogOpen(true)}
                disabled={availableBalance <= 0}
                className="gap-2"
              >
                <ExternalLink className="h-4 w-4" />
                {language === 'fr' ? 'Retirer' : 'Withdraw'}
              </Button>
            </div>
          </Card>

          {/* Period Tabs */}
          <Tabs value={period} onValueChange={(v) => setPeriod(v as typeof period)} className="mb-6">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="today">{language === 'fr' ? "Aujourd'hui" : 'Today'}</TabsTrigger>
              <TabsTrigger value="week">{language === 'fr' ? 'Semaine' : 'Week'}</TabsTrigger>
              <TabsTrigger value="month">{language === 'fr' ? 'Mois' : 'Month'}</TabsTrigger>
              <TabsTrigger value="all">{language === 'fr' ? 'Total' : 'All Time'}</TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Summary Cards */}
          <div className="grid grid-cols-2 gap-4 mb-8">
            <Card className="p-6">
              <div className="flex items-center gap-2 text-muted-foreground mb-2">
                <DollarSign className="h-5 w-5" />
                <span>{language === 'fr' ? 'Gains période' : 'Period Earnings'}</span>
              </div>
              <p className="font-display text-3xl font-bold">
                {formatCurrency(summary.totalEarnings, language)}
              </p>
            </Card>
            <Card className="p-6">
              <div className="flex items-center gap-2 text-muted-foreground mb-2">
                <Car className="h-5 w-5" />
                <span>{language === 'fr' ? 'Courses complétées' : 'Completed Rides'}</span>
              </div>
              <p className="font-display text-3xl font-bold">
                {summary.totalRides}
              </p>
            </Card>
          </div>

          {/* Breakdown */}
          <Card className="p-6 mb-8">
            <h3 className="font-display text-lg font-semibold mb-4">
              {language === 'fr' ? 'Détail des gains' : 'Earnings Breakdown'}
            </h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <ArrowUp className="h-4 w-4 text-success" />
                  <span>{language === 'fr' ? 'Tarifs collectés' : 'Total Fares Collected'}</span>
                </div>
                <span className="font-medium">{formatCurrency(summary.totalFares, language)}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <ArrowDown className="h-4 w-4 text-destructive" />
                  <span>{language === 'fr' ? 'Frais plateforme' : 'Platform Fees'} ({formatCurrency(PLATFORM_FEE, language)}/{language === 'fr' ? 'course' : 'ride'})</span>
                </div>
                <span className="font-medium text-destructive">-{formatCurrency(summary.totalPlatformFees, language)}</span>
              </div>
              <div className="flex items-center justify-between pt-3 border-t border-border">
                <span className="font-semibold">{language === 'fr' ? 'Vos gains' : 'Your Earnings'}</span>
                <span className="font-bold text-lg text-accent">{formatCurrency(summary.totalEarnings, language)}</span>
              </div>
            </div>
          </Card>

          {/* Lifetime Stats from profile */}
          {driverProfile && (
            <Card className="p-6 mb-8 bg-muted/50">
              <h3 className="font-display text-lg font-semibold mb-4">
                {language === 'fr' ? 'Statistiques' : 'Lifetime Stats'}
              </h3>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-2xl font-bold">{driverProfile.total_rides}</p>
                  <p className="text-sm text-muted-foreground">{language === 'fr' ? 'Courses' : 'Total Rides'}</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-accent">
                    {formatCurrency(Number(driverProfile.total_earnings), language)}
                  </p>
                  <p className="text-sm text-muted-foreground">{language === 'fr' ? 'Disponible' : 'Available'}</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-warning">
                    {Number(driverProfile.average_rating).toFixed(1)}
                  </p>
                  <p className="text-sm text-muted-foreground">{language === 'fr' ? 'Note' : 'Rating'}</p>
                </div>
              </div>
            </Card>
          )}

          {/* Daily Breakdown - Click to expand */}
          {!isLoading && dailyData.length > 0 && (
            <div>
              <h3 className="font-display text-lg font-semibold mb-4">
                {language === 'fr' ? 'Détail par jour' : 'Daily Breakdown'}
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                {language === 'fr' ? 'Cliquez sur un jour pour voir les détails' : 'Click on a day to see details'}
              </p>
              <div className="space-y-3">
                {dailyData.map((day, index) => (
                  <motion.div
                    key={day.dateKey}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.05 }}
                  >
                    <DailyEarningsDetail
                      date={day.date}
                      earnings={day.earnings}
                      rides={day.rides}
                      fares={day.fares}
                      driverId={user?.id || ''}
                    />
                  </motion.div>
                ))}
              </div>
            </div>
          )}

          {!isLoading && dailyData.length === 0 && (
            <Card className="p-12 text-center">
              <TrendingUp className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="font-display text-xl font-semibold mb-2">
                {language === 'fr' ? 'Pas encore de gains' : 'No earnings yet'}
              </h3>
              <p className="text-muted-foreground">
                {language === 'fr' ? 'Complétez des courses pour commencer à gagner!' : 'Complete rides to start earning!'}
              </p>
            </Card>
          )}
        </motion.div>
      </div>

      {/* Withdraw Dialog */}
      <WithdrawDialog
        open={withdrawDialogOpen}
        onOpenChange={setWithdrawDialogOpen}
        availableBalance={availableBalance}
        driverId={user?.id || ''}
        onSuccess={() => {
          if (refreshDriverProfile) {
            refreshDriverProfile();
          }
        }}
      />
    </div>
  );
};

export default Earnings;
