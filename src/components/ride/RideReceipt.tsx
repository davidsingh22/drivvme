import { motion } from 'framer-motion';
import { Receipt, TrendingDown, Calendar, Clock, MapPin, Navigation } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useLanguage } from '@/contexts/LanguageContext';
import { formatCurrency } from '@/lib/pricing';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface RideReceiptProps {
  rideId: string;
  pickupAddress: string;
  dropoffAddress: string;
  distanceKm: number;
  durationMinutes: number;
  completedAt: Date;
  subtotal: number;
  promoDiscount: number;
  afterPromo: number;
  taxes: number;
  total: number;
  savings: number;
}

const RideReceipt = ({
  rideId,
  pickupAddress,
  dropoffAddress,
  distanceKm,
  durationMinutes,
  completedAt,
  subtotal,
  promoDiscount,
  afterPromo,
  taxes,
  total,
  savings,
}: RideReceiptProps) => {
  const { language } = useLanguage();

  const formatDate = (date: Date) => {
    return format(date, 'PPP', { locale: language === 'fr' ? fr : undefined });
  };

  const formatTime = (date: Date) => {
    return format(date, 'p', { locale: language === 'fr' ? fr : undefined });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
    >
      <Card className="p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-full bg-primary/10">
            <Receipt className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold">
              {language === 'fr' ? 'Reçu de trajet' : 'Trip Receipt'}
            </h3>
            <p className="text-xs text-muted-foreground">
              #{rideId.slice(0, 8).toUpperCase()}
            </p>
          </div>
        </div>

        {/* Trip details */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Calendar className="h-4 w-4" />
            <span>{formatDate(completedAt)}</span>
            <Clock className="h-4 w-4 ml-2" />
            <span>{formatTime(completedAt)}</span>
          </div>
          
          <div className="space-y-2">
            <div className="flex gap-2 text-sm">
              <MapPin className="h-4 w-4 text-success flex-shrink-0 mt-0.5" />
              <span className="line-clamp-2">{pickupAddress}</span>
            </div>
            <div className="flex gap-2 text-sm">
              <Navigation className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
              <span className="line-clamp-2">{dropoffAddress}</span>
            </div>
          </div>

          <div className="flex gap-4 text-sm text-muted-foreground">
            <span>{distanceKm.toFixed(1)} km</span>
            <span>•</span>
            <span>{Math.round(durationMinutes)} min</span>
          </div>
        </div>

        <Separator />

        {/* Fare breakdown */}
        <div className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">
              {language === 'fr' ? 'Sous-total' : 'Subtotal'}
            </span>
            <span>{formatCurrency(subtotal, language)}</span>
          </div>

          <div className="flex justify-between text-sm text-accent">
            <span>
              {language === 'fr' ? 'Promo Drivveme (-7.5%)' : 'Drivveme Promo (-7.5%)'}
            </span>
            <span>-{formatCurrency(promoDiscount, language)}</span>
          </div>

          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">
              {language === 'fr' ? 'Après promo' : 'After promo'}
            </span>
            <span>{formatCurrency(afterPromo, language)}</span>
          </div>

          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">
              {language === 'fr' ? 'Taxes (TPS + TVQ)' : 'Taxes (GST + QST)'}
            </span>
            <span>{formatCurrency(taxes, language)}</span>
          </div>

          <Separator />

          <div className="flex justify-between font-semibold text-lg">
            <span>{language === 'fr' ? 'Total' : 'Total'}</span>
            <span>{formatCurrency(total, language)}</span>
          </div>
        </div>

        {/* Savings highlight */}
        {savings > 0 && (
          <div className="flex items-center gap-2 text-accent bg-accent/10 rounded-lg p-3">
            <TrendingDown className="h-5 w-5" />
            <span className="font-medium">
              {language === 'fr' 
                ? `Vous avez économisé ${formatCurrency(savings, language)}!`
                : `You saved ${formatCurrency(savings, language)}!`
              }
            </span>
          </div>
        )}
      </Card>
    </motion.div>
  );
};

export default RideReceipt;
