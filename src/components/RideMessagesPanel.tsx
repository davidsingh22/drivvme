import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, Send, Lock, AlertTriangle, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';

// Active ride statuses that allow messaging
const ACTIVE_STATUSES = ['driver_assigned', 'driver_en_route', 'arrived', 'in_progress'] as const;
type ActiveStatus = typeof ACTIVE_STATUSES[number];

interface RideMessage {
  id: string;
  ride_id: string;
  sender_id: string;
  sender_role: 'driver' | 'rider';
  message: string;
  created_at: string;
}

interface ActiveRide {
  id: string;
  rider_id: string;
  driver_id: string;
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
}

export default function RideMessagesPanel() {
  const { user, session, roles, isDriver, isAdmin } = useAuth();
  const { language } = useLanguage();
  const { toast } = useToast();
  
  const [activeRide, setActiveRide] = useState<ActiveRide | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [messages, setMessages] = useState<RideMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const currentUserId = session?.user?.id ?? user?.id ?? null;
  
  // Determine role string for debug
  const roleStr = isAdmin ? 'admin' : isDriver ? 'driver' : roles.includes('rider') ? 'rider' : 'unknown';
  
  // Fetch active ride for current driver
  const fetchActiveRide = useCallback(async () => {
    if (!currentUserId) {
      setIsLoading(false);
      return;
    }

    try {
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
      }

      setActiveRide(data || null);
    } catch (err) {
      console.error('[RideMessagesPanel] Unexpected error:', err);
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
        (payload) => {
          // Refetch on any ride change
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
        return;
      }

      const typedData = (data || []).map(m => ({
        ...m,
        sender_role: m.sender_role as 'driver' | 'rider',
      }));

      setMessages(typedData);
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
            return [...prev, newMsg];
          });
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
          sender_role: 'driver',
          message: newMessage.trim(),
        });

      if (error) {
        if (error.code === '42501' || error.message.includes('policy')) {
          toast({
            title: language === 'fr' ? 'Erreur' : 'Error',
            description: language === 'fr' 
              ? 'La messagerie est disponible uniquement pendant une course active.'
              : 'Messaging is only available during an active ride.',
            variant: 'destructive',
          });
        } else {
          throw error;
        }
        return;
      }

      setNewMessage('');
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

  const debugInfo: DebugInfo = {
    currentUserId,
    role: roleStr,
    activeRideId: activeRide?.id || null,
    activeRideStatus: activeRide?.status || null,
    activeRideDriverId: activeRide?.driver_id || null,
    activeRideRiderId: activeRide?.rider_id || null,
    isLinked,
    isActive,
  };

  // Render "Why you can't message" explanation
  const renderExplanation = () => {
    if (!currentUserId) {
      return (
        <div className="flex items-center gap-2 text-muted-foreground">
          <AlertTriangle className="h-5 w-5 text-warning" />
          <span>{language === 'fr' ? 'Non connecté' : 'Not logged in'}</span>
        </div>
      );
    }

    if (isLoading) {
      return (
        <div className="text-muted-foreground animate-pulse">
          {language === 'fr' ? 'Chargement...' : 'Loading...'}
        </div>
      );
    }

    if (!activeRide) {
      return (
        <div className="flex items-start gap-3 text-muted-foreground">
          <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">
              {language === 'fr' ? 'Aucune course active' : 'No active ride'}
            </p>
            <p className="text-sm mt-1">
              {language === 'fr' 
                ? 'Acceptez une course pour commencer à communiquer avec le passager.'
                : 'Accept a ride to start messaging with the rider.'}
            </p>
          </div>
        </div>
      );
    }

    if (!isLinked) {
      return (
        <div className="flex items-start gap-3 text-destructive">
          <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">
              {language === 'fr' ? 'Course non assignée' : 'Ride not assigned to you'}
            </p>
            <p className="text-sm mt-1 text-muted-foreground">
              {language === 'fr'
                ? `driver_id (${activeRide.driver_id}) ≠ vous (${currentUserId})`
                : `driver_id (${activeRide.driver_id}) ≠ you (${currentUserId})`}
            </p>
          </div>
        </div>
      );
    }

    if (!isActive) {
      return (
        <div className="flex items-start gap-3 text-muted-foreground">
          <Lock className="h-5 w-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">
              {language === 'fr' ? 'Course terminée' : 'Ride ended'}
            </p>
            <p className="text-sm mt-1">
              {language === 'fr'
                ? 'La messagerie est fermée pour les courses terminées.'
                : 'Messaging is closed for completed rides.'}
            </p>
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <Card className="mb-4 border-primary/30 overflow-visible" style={{ minHeight: 240 }}>
      {/* Debug Banner (dev only) */}
      {import.meta.env.DEV && (
        <div className="bg-muted/80 border-b border-border px-3 py-2 text-xs font-mono overflow-x-auto">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span><strong>userId:</strong> {debugInfo.currentUserId || 'null'}</span>
            <span><strong>role:</strong> {debugInfo.role}</span>
            <span><strong>rideId:</strong> {debugInfo.activeRideId || 'null'}</span>
            <span><strong>status:</strong> {debugInfo.activeRideStatus || 'null'}</span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
            <span><strong>driver_id:</strong> {debugInfo.activeRideDriverId || 'null'}</span>
            <span><strong>rider_id:</strong> {debugInfo.activeRideRiderId || 'null'}</span>
            <span className={debugInfo.isLinked ? 'text-success' : 'text-destructive'}>
              <strong>isLinked:</strong> {String(debugInfo.isLinked)}
            </span>
            <span className={debugInfo.isActive ? 'text-success' : 'text-warning'}>
              <strong>isActive:</strong> {String(debugInfo.isActive)}
            </span>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-2 p-4 border-b border-border">
        <MessageSquare className="h-5 w-5 text-primary" />
        <h3 className="font-display font-semibold">
          {language === 'fr' ? 'Messages de la course' : 'Ride Messages'}
        </h3>
        {canMessage && messages.length > 0 && (
          <span className="ml-auto text-xs text-muted-foreground">
            {messages.length} {language === 'fr' ? 'messages' : 'messages'}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="p-4">
        {!canMessage ? (
          <div className="py-4">
            {renderExplanation()}
          </div>
        ) : (
          <>
            {/* Messages List */}
            <div className="space-y-3 max-h-60 overflow-y-auto mb-4">
              {messages.length === 0 && (
                <div className="text-center text-muted-foreground py-6">
                  <MessageSquare className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p>{language === 'fr' ? 'Aucun message.' : 'No messages yet.'}</p>
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
                        <p className="text-sm">{msg.message}</p>
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
          </>
        )}
      </div>
    </Card>
  );
}
