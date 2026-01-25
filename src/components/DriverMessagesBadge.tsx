import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import InAppMessaging from './InAppMessaging';

interface ActiveRideMessage {
  rideId: string;
  riderId: string;
  riderName: string;
  unreadCount: number;
  lastMessage: string;
  lastMessageTime: string;
}

export default function DriverMessagesBadge() {
  const { user } = useAuth();
  const { language } = useLanguage();
  const [activeRideMessage, setActiveRideMessage] = useState<ActiveRideMessage | null>(null);
  const [showChat, setShowChat] = useState(false);
  const [showNotification, setShowNotification] = useState(false);
  const [latestMessage, setLatestMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id) return;

    const loadFromRide = async (ride: { id: string; rider_id: string } | null) => {
      if (!ride) {
        setActiveRideMessage(null);
        return;
      }

      const [{ data: profile }, { count }] = await Promise.all([
        supabase
          .from('profiles')
          .select('first_name, last_name')
          .eq('user_id', ride.rider_id)
          .maybeSingle(),
        supabase
          .from('notifications')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('ride_id', ride.id)
          .eq('type', 'ride_message')
          .eq('is_read', false),
      ]);

      setActiveRideMessage({
        rideId: ride.id,
        riderId: ride.rider_id,
        riderName: profile
          ? `${profile.first_name || ''} ${profile.last_name?.[0] || ''}.`.trim()
          : 'Rider',
        unreadCount: count || 0,
        lastMessage: '',
        lastMessageTime: '',
      });
    };

    // Check for active ride first (and anytime we need to recover state)
    const fetchActiveRide = async () => {
      const { data: ride } = await supabase
        .from('rides')
        .select('id, rider_id')
        .eq('driver_id', user.id)
        .in('status', ['driver_assigned', 'driver_en_route', 'arrived', 'in_progress'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      await loadFromRide(ride ?? null);
    };

    fetchActiveRide();

    // If the driver opens the app BEFORE a ride becomes active, we must still attach later.
    // Subscribe to ride updates for this driver and refresh active ride state.
    const ridesChannel = supabase
      .channel(`driver-rides-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'rides',
          filter: `driver_id=eq.${user.id}`,
        },
        () => {
          fetchActiveRide();
        }
      )
      .subscribe();

    // Subscribe to new messages for this driver
    const channel = supabase
      .channel('driver-messages')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const notification = payload.new as any;
          if (notification.type === 'ride_message') {
            // Show popup notification
            setLatestMessage(notification.message);
            setShowNotification(true);

            // If we don't yet know the active ride (e.g. app opened early), recover now.
            if (!activeRideMessage && notification.ride_id) {
              fetchActiveRide();
            }
            
            // Update unread count
            setActiveRideMessage(prev => prev ? {
              ...prev,
              unreadCount: prev.unreadCount + 1,
              lastMessage: notification.message,
            } : null);

            // Auto-hide after 5 seconds
            setTimeout(() => setShowNotification(false), 5000);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(ridesChannel);
    };
  }, [user?.id, activeRideMessage]);

  const markAsRead = async () => {
    if (!user?.id || !activeRideMessage?.rideId) return;

    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', user.id)
      .eq('ride_id', activeRideMessage.rideId)
      .eq('type', 'ride_message');

    setActiveRideMessage(prev => prev ? { ...prev, unreadCount: 0 } : null);
  };

  const handleOpenChat = () => {
    setShowNotification(false);
    markAsRead();
    setShowChat(true);
  };

  if (!activeRideMessage) return null;

  return (
    <>
      {/* Floating notification popup */}
      <AnimatePresence>
        {showNotification && latestMessage && (
          <motion.div
            initial={{ opacity: 0, y: -50, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: -50, x: '-50%' }}
            className="fixed top-4 left-1/2 z-50 w-[90%] max-w-sm"
          >
            <Card 
              className="p-4 bg-primary text-primary-foreground cursor-pointer shadow-2xl"
              onClick={handleOpenChat}
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-primary-foreground/20 flex items-center justify-center shrink-0">
                  <MessageSquare className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm">
                    {language === 'fr' ? 'Nouveau message du passager' : 'New message from rider'}
                  </p>
                  <p className="text-sm opacity-90 truncate">{latestMessage}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-primary-foreground hover:bg-primary-foreground/20 shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowNotification(false);
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating message button with badge */}
      {activeRideMessage.unreadCount > 0 && !showChat && (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="fixed bottom-40 right-4 z-40"
        >
          <Button
            onClick={handleOpenChat}
            className="h-14 w-14 rounded-full shadow-2xl bg-accent hover:bg-accent/90 relative"
          >
            <MessageSquare className="h-6 w-6" />
            <span className="absolute -top-1 -right-1 h-6 w-6 rounded-full bg-destructive text-destructive-foreground text-xs flex items-center justify-center font-bold">
              {activeRideMessage.unreadCount}
            </span>
          </Button>
        </motion.div>
      )}

      {/* Full chat interface */}
      <AnimatePresence>
        {showChat && (
          <InAppMessaging
            rideId={activeRideMessage.rideId}
            recipientId={activeRideMessage.riderId}
            recipientName={activeRideMessage.riderName}
            senderRole="driver"
            onClose={() => setShowChat(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}
