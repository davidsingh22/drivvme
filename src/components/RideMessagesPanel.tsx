import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, Send, Lock, AlertTriangle, Info, Bug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';

// Active ride statuses that allow messaging
const ACTIVE_STATUSES = ['driver_assigned', 'driver_en_route', 'arrived', 'in_progress'] as const;

interface RideMessage {
  id: string;
  ride_id: string;
  sender_id: string;
  sender_user_id: string | null;
  sender_role: 'driver' | 'rider';
  message: string;
  body: string | null;
  created_at: string;
}

interface ActiveRide {
  id: string;
  rider_id: string | null;
  driver_id: string | null;
  status: string;
  pickup_address: string;
  dropoff_address: string;
}

interface DebugInfo {
  currentUserId: string | null;
  role: string;
  activeRideId: string | null;
  activeRideStatus: string | null;
  activeRideDriverId: string | null;
  activeRideRiderId: string | null;
  isLinked: boolean;
  isActive: boolean;
  lastQueryCount: number | null;
  lastError: string | null;
}

export default function RideMessagesPanel() {
  const { user, session, roles, isDriver, isAdmin } = useAuth();
  const { language } = useLanguage();
  const { toast } = useToast();
  
  const [activeRide, setActiveRide] = useState<ActiveRide | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<RideMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastQueryCount, setLastQueryCount] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const currentUserId = session?.user?.id ?? user?.id ?? null;
  
  // Determine role string for debug
  const roleStr = isAdmin ? 'admin' : isDriver ? 'driver' : roles.includes('rider') ? 'rider' : 'unknown';
  
  // Fetch active ride for current driver (rides.driver_id = auth.uid())
  const fetchActiveRide = useCallback(async () => {
    if (!currentUserId) {
      // No user yet — don't show loading, just show the "accept a ride" message
      return;
    }

    setIsLoading(true);

    try {
      setLastError(null);
      
      // Query for any active ride where this user is the driver
      const { data, error } = await supabase
        .from('rides')
        .select('id, rider_id, driver_id, status, pickup_address, dropoff_address')
        .eq('driver_id', currentUserId)
        .in('status', ['driver_assigned', 'driver_en_route', 'arrived', 'in_progress'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('[RideMessagesPanel] Error fetching ride:', error);
        setLastError(`Ride query: ${error.code} - ${error.message}`);
      }

      setActiveRide(data || null);
    } catch (err: any) {
      console.error('[RideMessagesPanel] Unexpected error:', err);
      setLastError(`Unexpected: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [currentUserId]);

  // Initial fetch
  useEffect(() => {
    fetchActiveRide();
  }, [fetchActiveRide]);

  // Subscribe to ride updates
  useEffect(() => {
    if (!currentUserId) return;

    const channel = supabase
      .channel('ride-messages-panel-rides')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'rides',
        },
        () => {
          fetchActiveRide();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUserId, fetchActiveRide]);

  // Fetch messages when we have an active ride
  useEffect(() => {
    if (!activeRide?.id || !currentUserId) {
      setMessages([]);
      setLastQueryCount(null);
      return;
    }

    const fetchMessages = async () => {
      const { data, error } = await supabase
        .from('ride_messages')
        .select('*')
        .eq('ride_id', activeRide.id)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('[RideMessagesPanel] Error fetching messages:', error);
        setLastError(`Messages query: ${error.code} - ${error.message}`);
        setLastQueryCount(null);
        return;
      }

      const typedData = (data || []).map(m => ({
        ...m,
        sender_role: m.sender_role as 'driver' | 'rider',
      }));

      setMessages(typedData);
      setLastQueryCount(typedData.length);
      setLastError(null);
    };

    fetchMessages();

    // Subscribe to new messages
    const channel = supabase
      .channel(`ride-messages-panel-${activeRide.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'ride_messages',
          filter: `ride_id=eq.${activeRide.id}`,
        },
        (payload) => {
          const newMsg = payload.new as RideMessage;
          setMessages(prev => {
            if (prev.some(m => m.id === newMsg.id)) return prev;
            return [...prev, { ...newMsg, sender_role: newMsg.sender_role as 'driver' | 'rider' }];
          });
          setLastQueryCount(prev => (prev ?? 0) + 1);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeRide?.id, currentUserId]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(async () => {
    if (!newMessage.trim() || !currentUserId || !activeRide?.id) return;

    setIsSending(true);
    try {
      const { error } = await supabase
        .from('ride_messages')
        .insert({
          ride_id: activeRide.id,
          sender_id: currentUserId,
          sender_user_id: currentUserId,
          sender_role: 'driver',
          message: newMessage.trim(),
          body: newMessage.trim(),
        });

      if (error) {
        if (error.code === '42501' || error.message.includes('policy')) {
          setLastError(`RLS block: ${error.message}`);
          toast({
            title: language === 'fr' ? 'Erreur' : 'Error',
            description: language === 'fr' 
              ? 'La messagerie est disponible uniquement pendant une course active.'
              : 'Messaging is only available during an active ride.',
            variant: 'destructive',
          });
        } else {
          setLastError(`Insert error: ${error.code} - ${error.message}`);
          throw error;
        }
        return;
      }

      setNewMessage('');
      setLastError(null);
    } catch (err: any) {
      console.error('[RideMessagesPanel] Error sending message:', err);
      toast({
        title: language === 'fr' ? 'Erreur' : 'Error',
        description: language === 'fr'
          ? "Impossible d'envoyer le message"
          : 'Failed to send message',
        variant: 'destructive',
      });
    } finally {
      setIsSending(false);
    }
  }, [newMessage, currentUserId, activeRide?.id, toast, language]);

  // Admin test message button
  const sendTestMessage = useCallback(async () => {
    if (!activeRide?.id || !currentUserId) {
      toast({
        title: 'No active ride',
        description: 'Cannot send test message without an active ride.',
        variant: 'destructive',
      });
      return;
    }

    const { error } = await supabase
      .from('ride_messages')
      .insert({
        ride_id: activeRide.id,
        sender_id: activeRide.rider_id ?? currentUserId,
        sender_user_id: activeRide.rider_id ?? currentUserId,
        sender_role: 'rider',
        message: `[TEST] Message from admin at ${new Date().toISOString()}`,
        body: `[TEST] Message from admin at ${new Date().toISOString()}`,
      });

    if (error) {
      setLastError(`Test insert error: ${error.code} - ${error.message}`);
      toast({
        title: 'Test failed',
        description: error.message,
        variant: 'destructive',
      });
    } else {
      toast({
        title: 'Test message sent',
        description: 'Check if it appears in realtime.',
      });
    }
  }, [activeRide, currentUserId, toast]);

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString(language === 'fr' ? 'fr-CA' : 'en-CA', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Compute debug info
  const isLinked = activeRide ? activeRide.driver_id === currentUserId : false;
  const isActive = activeRide ? (ACTIVE_STATUSES as readonly string[]).includes(activeRide.status) : false;
  const canMessage = isLinked && isActive;
  const isEnded = activeRide ? (activeRide.status === 'completed' || activeRide.status === 'cancelled') : false;

  const debugInfo: DebugInfo = {
    currentUserId,
    role: roleStr,
    activeRideId: activeRide?.id || null,
    activeRideStatus: activeRide?.status || null,
    activeRideDriverId: activeRide?.driver_id || null,
    activeRideRiderId: activeRide?.rider_id || null,
    isLinked,
    isActive,
    lastQueryCount,
    lastError,
  };

  // Render "Why you can't message" explanation
  const renderExplanation = () => {
    // Simplified: just show a short message or nothing
    if (isLoading) {
      return (
        <div className="text-muted-foreground animate-pulse text-sm">
          {language === 'fr' ? 'Chargement...' : 'Loading...'}
        </div>
      );
    }

    if (!activeRide) {
      return (
        <p className="text-sm text-muted-foreground">
          {language === 'fr' 
            ? 'Acceptez une course pour envoyer des messages.'
            : 'Accept a ride to send messages.'}
        </p>
      );
    }

    if (isEnded) {
      return (
        <p className="text-sm text-muted-foreground">
          {language === 'fr' ? 'Course terminée.' : 'Ride ended.'}
        </p>
      );
    }

    return null;
  };

  return (
    <Card className="mb-4 border-primary/30 overflow-visible">

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <MessageSquare className="h-4 w-4 text-primary" />
        <h3 className="font-display font-semibold text-sm">
          {language === 'fr' ? 'Messages' : 'Messages'}
        </h3>
        {canMessage && messages.length > 0 && (
          <span className="ml-auto text-xs text-muted-foreground">
            {messages.length}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="px-3 py-2">
        {!canMessage ? (
          <div className="py-2">
            {renderExplanation()}
          </div>
        ) : (
          <>
            {/* Messages List */}
            <div className="space-y-2 max-h-40 overflow-y-auto mb-3">
              {messages.length === 0 && (
                <div className="text-center text-muted-foreground py-3">
                  <p className="text-sm">{language === 'fr' ? 'Aucun message.' : 'No messages yet.'}</p>
                </div>
              )}

              <AnimatePresence mode="popLayout">
                {messages.map((msg) => {
                  const isOwn = msg.sender_role === 'driver';
                  return (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[75%] px-4 py-2 rounded-2xl ${
                          isOwn
                            ? 'bg-primary text-primary-foreground rounded-br-md'
                            : 'bg-muted rounded-bl-md'
                        }`}
                      >
                        <p className="text-sm">{msg.body || msg.message}</p>
                        <p className={`text-xs mt-1 ${isOwn ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                          {formatTime(msg.created_at)}
                        </p>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            {isEnded ? (
              <div className="flex items-center justify-center gap-2 text-muted-foreground py-2">
                <Lock className="h-4 w-4" />
                <span className="text-sm">
                  {language === 'fr' 
                    ? 'Cette course est terminée. La messagerie est fermée.'
                    : 'This ride has ended. Messaging is closed.'}
                </span>
              </div>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  sendMessage();
                }}
                className="flex items-center gap-2"
              >
                <Input
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder={language === 'fr' ? 'Écrivez un message...' : 'Type a message...'}
                  className="flex-1"
                  disabled={isSending}
                  maxLength={500}
                />
                <Button 
                  type="submit" 
                  size="icon" 
                  disabled={!newMessage.trim() || isSending}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </form>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
