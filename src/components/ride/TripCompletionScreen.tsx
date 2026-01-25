import { useState } from 'react';
import { motion } from 'framer-motion';
import { Star, DollarSign, TrendingDown, CheckCircle2, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { formatCurrency } from '@/lib/pricing';

interface DriverInfo {
  first_name: string;
  avatar_url: string | null;
}

interface TripCompletionScreenProps {
  rideId: string;
  driverId: string;
  riderId: string;
  driverInfo: DriverInfo;
  actualFare: number;
  estimatedFare: number;
  savings: number;
  onComplete: () => void;
}

const tipOptions = [0, 1, 2, 3, 5, 7, 10];

const TripCompletionScreen = ({
  rideId,
  driverId,
  riderId,
  driverInfo,
  actualFare,
  estimatedFare,
  savings,
  onComplete,
}: TripCompletionScreenProps) => {
  const { language } = useLanguage();
  const { toast } = useToast();
  const [rating, setRating] = useState(5);
  const [hoveredRating, setHoveredRating] = useState(0);
  const [selectedTip, setSelectedTip] = useState(0);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);

  const handleSubmit = async () => {
    setIsSubmitting(true);

    try {
      // Submit rating
      const { error: ratingError } = await supabase.from('ratings').insert({
        ride_id: rideId,
        driver_id: driverId,
        rider_id: riderId,
        rating,
        comment: comment || null,
      });

      if (ratingError) throw ratingError;

      // Update driver's average rating
      const { data: ratings } = await supabase
        .from('ratings')
        .select('rating')
        .eq('driver_id', driverId);

      if (ratings && ratings.length > 0) {
        const avgRating = ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length;
        await supabase
          .from('driver_profiles')
          .update({ average_rating: avgRating })
          .eq('user_id', driverId);
      }

      // TODO: Handle tip payment if selectedTip > 0

      toast({
        title: language === 'fr' ? 'Merci!' : 'Thank you!',
        description: language === 'fr' 
          ? 'Votre évaluation a été enregistrée' 
          : 'Your rating has been submitted',
      });

      onComplete();
    } catch (error: any) {
      console.error('Submit error:', error);
      toast({
        title: language === 'fr' ? 'Erreur' : 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Success header */}
      <div className="text-center">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', delay: 0.2 }}
          className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-success/10 mb-4"
        >
          <CheckCircle2 className="h-10 w-10 text-success" />
        </motion.div>
        <h2 className="font-display text-2xl font-bold">
          {language === 'fr' ? 'Trajet terminé!' : 'Trip completed!'}
        </h2>
        <p className="text-muted-foreground">
          {language === 'fr' ? 'Merci d\'avoir choisi Drivveme' : 'Thanks for riding with Drivveme'}
        </p>
      </div>

      {/* Fare breakdown */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <span className="text-muted-foreground">
            {language === 'fr' ? 'Tarif total' : 'Total fare'}
          </span>
          <span className="font-display text-3xl font-bold">
            {formatCurrency(actualFare, language)}
          </span>
        </div>
        
        <div className="flex items-center gap-2 text-accent bg-accent/10 rounded-lg p-3">
          <TrendingDown className="h-5 w-5" />
          <span className="font-medium">
            {language === 'fr' ? 'Vous avez économisé' : 'You saved'} {formatCurrency(savings, language)}!
          </span>
        </div>
      </Card>

      {/* Driver rating */}
      <Card className="p-6">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden">
            {driverInfo.avatar_url ? (
              <img
                src={driverInfo.avatar_url}
                alt={driverInfo.first_name}
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-2xl font-bold text-primary">
                {driverInfo.first_name?.[0] || 'D'}
              </span>
            )}
          </div>
          <div>
            <h3 className="font-semibold text-lg">
              {language === 'fr' ? 'Comment était' : 'How was'} {driverInfo.first_name}?
            </h3>
            <p className="text-sm text-muted-foreground">
              {language === 'fr' ? 'Évaluez votre trajet' : 'Rate your trip'}
            </p>
          </div>
        </div>

        {/* Star rating */}
        <div className="flex justify-center gap-2 mb-6">
          {[1, 2, 3, 4, 5].map((star) => (
            <motion.button
              key={star}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={() => setRating(star)}
              onMouseEnter={() => setHoveredRating(star)}
              onMouseLeave={() => setHoveredRating(0)}
            >
              <Star
                className={`h-10 w-10 transition-colors ${
                  star <= (hoveredRating || rating)
                    ? 'text-warning fill-warning'
                    : 'text-muted-foreground'
                }`}
              />
            </motion.button>
          ))}
        </div>

        {/* Feedback toggle */}
        <Button
          variant="ghost"
          size="sm"
          className="w-full gap-2"
          onClick={() => setShowFeedback(!showFeedback)}
        >
          <MessageSquare className="h-4 w-4" />
          {showFeedback 
            ? (language === 'fr' ? 'Masquer le commentaire' : 'Hide comment')
            : (language === 'fr' ? 'Ajouter un commentaire' : 'Add comment')}
        </Button>

        {showFeedback && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            className="mt-4"
          >
            <Textarea
              placeholder={language === 'fr' ? 'Commentaire optionnel...' : 'Optional feedback...'}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
            />
          </motion.div>
        )}
      </Card>

      {/* Tip options */}
      <Card className="p-6">
        <h3 className="font-semibold mb-4">
          {language === 'fr' ? 'Ajouter un pourboire?' : 'Add a tip?'}
        </h3>
        <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
          {tipOptions.map((tip) => (
            <motion.button
              key={tip}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setSelectedTip(tip)}
              className={`p-3 rounded-xl border-2 transition-all ${
                selectedTip === tip
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border hover:border-primary/50'
              }`}
            >
              {tip === 0 ? (
                <span className="text-sm">
                  {language === 'fr' ? 'Non' : 'No tip'}
                </span>
              ) : (
                <span className="font-bold">${tip}</span>
              )}
            </motion.button>
          ))}
        </div>
      </Card>

      {/* Submit button */}
      <Button
        onClick={handleSubmit}
        disabled={isSubmitting}
        className="w-full gradient-primary shadow-button py-6 text-lg"
      >
        {isSubmitting ? (
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            className="w-5 h-5 rounded-full border-2 border-primary-foreground border-t-transparent"
          />
        ) : (
          language === 'fr' ? 'Terminer' : 'Done'
        )}
      </Button>
    </motion.div>
  );
};

export default TripCompletionScreen;
