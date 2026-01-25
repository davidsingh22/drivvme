import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, X, ChevronRight, User, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Database } from '@/integrations/supabase/types';

type RideStatus = Database['public']['Enums']['ride_status'];
import { useLanguage } from '@/contexts/LanguageContext';
import InAppMessaging from './InAppMessaging';

interface RideThread {
  rideId: string;
  riderId: string;
  riderName: string;
  riderAvatar: string | null;
  lastMessage: string;
  lastMessageTime: string;
  unreadCount: number;
  rideStatus: string;
  pickupAddress: string;
}

interface DriverInboxProps {
  className?: string;
}

const ACTIVE_STATUSES = ['driver_assigned', 'driver_en_route', 'arrived', 'in_progress'];

export default function DriverInbox({ className }: DriverInboxProps) {
  const { user } = useAuth();
  const { language } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const [threads, setThreads] = useState<RideThread[]>([]);
  const [selectedThread, setSelectedThread] = useState<RideThread | null>(null);
  const [totalUnread, setTotalUnread] = useState(0);

  // Fetch unread count proactively (even when closed) so badge is visible
  useEffect(() => {
    if (!user?.id) return;

    const fetchUnreadCount = async () => {
      const { count } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('type', 'ride_message')
        .eq('is_read', false);

      setTotalUnread(count || 0);
    };

    fetchUnreadCount();

    // Subscribe to new messages for badge updates
    const badgeChannel = supabase
      .channel(`driver-inbox-badge-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const notification = payload.new as any;
          if (notification?.type === 'ride_message') {
            fetchUnreadCount();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(badgeChannel);
    };
  }, [user?.id]);

  // Fetch full threads when the inbox sheet is opened
  useEffect(() => {
    if (!user?.id || !isOpen) return;

    const fetchThreads = async () => {
      // Get all rides where driver has messages (active or recent completed)
      const statusFilter: RideStatus[] = [
        'driver_assigned', 'driver_en_route', 'arrived', 'in_progress', 'completed', 'cancelled'
      ];
      const { data: rides } = await supabase
        .from('rides')
        .select('id, rider_id, status, pickup_address, dropoff_address, created_at')
        .eq('driver_id', user.id)
        .in('status', statusFilter)
        .order('created_at', { ascending: false })
        .limit(20);

      if (!rides || rides.length === 0) {
        setThreads([]);
        return;
      }

      // For each ride, get latest message and unread count
      const threadPromises = rides.map(async (ride) => {
        const [{ data: messages }, { count: unreadCount }, { data: riderProfile }] = await Promise.all([
          supabase
            .from('notifications')
            .select('message, created_at')
            .eq('ride_id', ride.id)
            .eq('user_id', user.id)
            .eq('type', 'ride_message')
            .order('created_at', { ascending: false })
            .limit(1),
          supabase
            .from('notifications')
            .select('*', { count: 'exact', head: true })
            .eq('ride_id', ride.id)
            .eq('user_id', user.id)
            .eq('type', 'ride_message')
            .eq('is_read', false),
          supabase
            .from('profiles')
            .select('first_name, last_name, avatar_url')
            .eq('user_id', ride.rider_id)
            .maybeSingle(),
        ]);

        // Only include if there are messages
        if (!messages || messages.length === 0) return null;

        const thread: RideThread = {
          rideId: ride.id,
          riderId: ride.rider_id,
          riderName: riderProfile
            ? `${riderProfile.first_name || ''} ${riderProfile.last_name?.[0] || ''}.`.trim()
            : 'Rider',
          riderAvatar: riderProfile?.avatar_url || null,
          lastMessage: messages[0]?.message || '',
          lastMessageTime: messages[0]?.created_at || '',
          unreadCount: unreadCount || 0,
          rideStatus: ride.status,
          pickupAddress: ride.pickup_address,
        };

        return thread;
      });

      const resolvedThreads = (await Promise.all(threadPromises)).filter(Boolean) as RideThread[];
      setThreads(resolvedThreads);
      setTotalUnread(resolvedThreads.reduce((sum, t) => sum + t.unreadCount, 0));
    };

    fetchThreads();

    // Subscribe to new messages while sheet is open
    const channel = supabase
      .channel(`driver-inbox-threads-${user.id}`)
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
            fetchThreads();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, isOpen]);

  const openThread = (thread: RideThread) => {
    // Only allow opening chat if ride is still active
    if (!ACTIVE_STATUSES.includes(thread.rideStatus)) {
      return;
    }
    setSelectedThread(thread);
  };

  const closeThread = async () => {
    if (selectedThread) {
      // Mark messages as read
      await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('ride_id', selectedThread.rideId)
        .eq('user_id', user?.id)
        .eq('type', 'ride_message');

      // Update local state
      setThreads((prev) =>
        prev.map((t) =>
          t.rideId === selectedThread.rideId ? { ...t, unreadCount: 0 } : t
        )
      );
      setTotalUnread((prev) => Math.max(0, prev - selectedThread.unreadCount));
    }
    setSelectedThread(null);
  };

  const formatTime = (dateStr: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return language === 'fr' ? 'Maintenant' : 'Now';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    return `${diffDays}d`;
  };

  const getStatusBadge = (status: string) => {
    const isActive = ACTIVE_STATUSES.includes(status);
    return (
      <Badge
        variant={isActive ? 'default' : 'secondary'}
        className={isActive ? 'bg-success/20 text-success' : 'bg-muted text-muted-foreground'}
      >
        {isActive
          ? language === 'fr' ? 'Active' : 'Active'
          : language === 'fr' ? 'Terminée' : 'Ended'}
      </Badge>
    );
  };

  return (
    <>
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetTrigger asChild>
          <Button variant="outline" size="icon" className={`relative ${className}`}>
            <MessageSquare className="h-5 w-5" />
            {totalUnread > 0 && (
              <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-destructive text-destructive-foreground text-xs flex items-center justify-center font-bold">
                {totalUnread > 9 ? '9+' : totalUnread}
              </span>
            )}
          </Button>
        </SheetTrigger>
        <SheetContent side="right" className="w-full sm:max-w-md p-0">
          <SheetHeader className="p-4 border-b">
            <SheetTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              {language === 'fr' ? 'Messages' : 'Messages'}
            </SheetTitle>
          </SheetHeader>

          <div className="overflow-y-auto h-[calc(100vh-80px)]">
            {threads.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <MessageSquare className="h-12 w-12 mb-4 opacity-50" />
                <p>{language === 'fr' ? 'Aucun message' : 'No messages yet'}</p>
              </div>
            ) : (
              <div className="divide-y">
                {threads.map((thread) => {
                  const isActive = ACTIVE_STATUSES.includes(thread.rideStatus);
                  return (
                    <motion.div
                      key={thread.rideId}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`p-4 cursor-pointer transition-colors ${
                        isActive
                          ? 'hover:bg-muted/50'
                          : 'opacity-60 cursor-not-allowed'
                      }`}
                      onClick={() => openThread(thread)}
                    >
                      <div className="flex items-start gap-3">
                        {/* Avatar */}
                        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0 overflow-hidden">
                          {thread.riderAvatar ? (
                            <img
                              src={thread.riderAvatar}
                              alt={thread.riderName}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <User className="h-6 w-6 text-primary" />
                          )}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-semibold text-sm truncate">
                              {thread.riderName}
                            </span>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-xs text-muted-foreground">
                                {formatTime(thread.lastMessageTime)}
                              </span>
                              {thread.unreadCount > 0 && (
                                <span className="h-5 w-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">
                                  {thread.unreadCount}
                                </span>
                              )}
                            </div>
                          </div>

                          <p className="text-sm text-muted-foreground truncate mb-2">
                            {thread.lastMessage}
                          </p>

                          <div className="flex items-center justify-between">
                            <p className="text-xs text-muted-foreground truncate max-w-[70%]">
                              {thread.pickupAddress}
                            </p>
                            {getStatusBadge(thread.rideStatus)}
                          </div>

                          {!isActive && (
                            <p className="text-xs text-muted-foreground mt-2 italic">
                              {language === 'fr'
                                ? 'Messagerie désactivée (course terminée)'
                                : 'Messaging disabled (ride ended)'}
                            </p>
                          )}
                        </div>

                        {isActive && (
                          <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Active chat overlay */}
      <AnimatePresence>
        {selectedThread && (
          <InAppMessaging
            rideId={selectedThread.rideId}
            recipientId={selectedThread.riderId}
            recipientName={selectedThread.riderName}
            senderRole="driver"
            onClose={closeThread}
          />
        )}
      </AnimatePresence>
    </>
  );
}
