import { X } from 'lucide-react';
import { motion } from 'framer-motion';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { useRef } from 'react';

interface FloatingCancelButtonProps {
  rideId: string | null | undefined;
  driverId: string | null | undefined;
  userId: string | null | undefined;
}

const FloatingCancelButton = ({ rideId, driverId, userId }: FloatingCancelButtonProps) => {
  const { language } = useLanguage();
  const fired = useRef(false);

  const handleCancel = () => {
    if (fired.current) return;
    fired.current = true;

    // Fire-and-forget: push notification to driver
    if (driverId) {
      supabase.functions.invoke('send-onesignal-notification', {
        body: {
          externalUserIds: [driverId],
          title: 'Ride Cancelled ❌',
          message: 'The rider cancelled this ride.',
          url: '/driver',
        },
      }).catch(() => {});

      supabase.from('notifications').insert({
        user_id: driverId,
        ride_id: rideId!,
        type: 'ride_cancelled',
        title: 'Ride Cancelled ❌',
        message: 'The rider cancelled this ride.',
      }).then(() => {});
    }

    // Fire-and-forget: update DB
    if (rideId) {
      supabase.from('rides').update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancelled_by: userId || null,
        cancellation_reason: 'Cancelled by rider',
      }).eq('id', rideId).then(() => {});

      supabase.from('notifications').delete().eq('ride_id', rideId).eq('type', 'new_ride').then(() => {});
      localStorage.removeItem(`drivvme_last_accepted_driver_${rideId}`);
    }

    // Hard exit immediately
    window.location.href = '/rider-home';
  };

  return (
    <motion.button
      initial={{ y: 80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.5, type: 'spring', stiffness: 200, damping: 22 }}
      onClick={handleCancel}
      className="fixed z-[9999] left-4 right-4 bottom-6 flex items-center justify-center gap-2 rounded-2xl py-4 text-base font-bold shadow-2xl"
      style={{
        background: 'linear-gradient(135deg, #dc2626 0%, #991b1b 100%)',
        color: '#fff',
        border: '2px solid rgba(255,255,255,0.15)',
        boxShadow: '0 8px 32px rgba(220, 38, 38, 0.45), 0 0 0 1px rgba(0,0,0,0.2)',
      }}
    >
      <X className="h-5 w-5" />
      {language === 'fr' ? 'Annuler la course' : 'Cancel Ride'}
    </motion.button>
  );
};

export default FloatingCancelButton;
