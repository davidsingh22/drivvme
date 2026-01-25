import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, Send, Lock, RefreshCw, AlertCircle, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';

// Active ride statuses that allow messaging
const ACTIVE_STATUSES = ['driver_assigned', 'driver_en_route', 'arrived', 'in_progress'];

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

interface RideChatProps {
  rideId: string;
  rideStatus: string;
  role: 'driver' | 'rider';
  otherPartyName?: string;
  onClose?: () => void;
  embedded?: boolean;
}

export default function RideChat({
  rideId,
  rideStatus,
  role,
  otherPartyName = role === 'driver' ? 'Rider' : 'Driver',
  onClose,
  embedded = false,
}: RideChatProps) {
  const { user } = useAuth();
  const { language } = useLanguage();
  const { toast } = useToast();
  const [messages, setMessages] = useState<RideMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const isActive = ACTIVE_STATUSES.includes(rideStatus);
  const isEnded = rideStatus === 'completed' || rideStatus === 'cancelled';

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Fetch messages
  const fetchMessages = useCallback(async () => {
    if (!rideId || !user?.id) return;

    setIsLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from('ride_messages')
        .select('*')
        .eq('ride_id', rideId)
        .order('created_at', { ascending: true });

      if (fetchError) {
        console.error('[RideChat] Fetch error:', fetchError);
        setError(fetchError.message);
        return;
      }

      const typedData = (data || []).map(m => ({
        ...m,
        sender_role: m.sender_role as 'driver' | 'rider',
      }));

      setMessages(typedData);
    } catch (err: any) {
      console.error('[RideChat] Unexpected error:', err);
      setError(err.message || 'Failed to load messages');
    } finally {
      setIsLoading(false);
    }
  }, [rideId, user?.id]);

  // Initial fetch
  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  // Subscribe to realtime updates
  useEffect(() => {
    if (!rideId || !user?.id) return;

    const channel = supabase
      .channel(`ride-chat-${rideId}-${role}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'ride_messages',
          filter: `ride_id=eq.${rideId}`,
        },
        (payload) => {
          const newMsg = payload.new as RideMessage;
          setMessages(prev => {
            if (prev.some(m => m.id === newMsg.id)) return prev;
            return [...prev, { ...newMsg, sender_role: newMsg.sender_role as 'driver' | 'rider' }];
          });
        }
      )
      .subscribe((status) => {
        console.log('[RideChat] Subscription status:', status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [rideId, user?.id, role]);

  const sendMessage = useCallback(async () => {
    if (!newMessage.trim() || !user?.id || !rideId || !isActive) return;

    setIsSending(true);
    try {
      const { error: insertError } = await supabase
        .from('ride_messages')
        .insert({
          ride_id: rideId,
          sender_id: user.id,
          sender_user_id: user.id,
          sender_role: role,
          message: newMessage.trim(),
          body: newMessage.trim(),
        });

      if (insertError) {
        console.error('[RideChat] Send error:', insertError);
        if (insertError.code === '42501' || insertError.message.includes('policy')) {
          toast({
            title: language === 'fr' ? 'Erreur' : 'Error',
            description: language === 'fr'
              ? 'La messagerie est disponible uniquement pendant une course active.'
              : 'Messaging is only available during an active ride.',
            variant: 'destructive',
          });
        } else {
          toast({
            title: language === 'fr' ? 'Erreur' : 'Error',
            description: insertError.message,
            variant: 'destructive',
          });
        }
        return;
      }

      setNewMessage('');
    } catch (err: any) {
      console.error('[RideChat] Send error:', err);
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
  }, [newMessage, user?.id, rideId, isActive, role, toast, language]);

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString(language === 'fr' ? 'fr-CA' : 'en-CA', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const containerClass = embedded
    ? 'flex flex-col h-full'
    : 'fixed inset-0 z-50 bg-background flex flex-col';

  return (
    <div className={containerClass}>
      {/* Header */}
      <div className="p-4 border-b bg-card flex items-center gap-3">
        {onClose && (
          <Button variant="ghost" size="icon" onClick={onClose}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
        )}
        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
          <MessageSquare className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1">
          <p className="font-semibold">
            {language === 'fr' ? 'Messages de la course' : 'Ride Messages'}
          </p>
          <p className="text-xs text-muted-foreground">{otherPartyName}</p>
        </div>
        <Button variant="ghost" size="icon" onClick={fetchMessages} disabled={isLoading}>
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Error state */}
      {error && (
        <div className="p-4 bg-destructive/10 border-b border-destructive/20 flex items-center gap-2 text-destructive">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <div className="flex-1">
            <p className="font-medium text-sm">
              {language === 'fr' ? 'Erreur de chargement' : 'Failed to load messages'}
            </p>
            <p className="text-xs opacity-80">{error}</p>
          </div>
          <Button variant="outline" size="sm" onClick={fetchMessages}>
            {language === 'fr' ? 'Réessayer' : 'Retry'}
          </Button>
        </div>
      )}

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {isLoading && messages.length === 0 && (
          <div className="flex justify-center py-8">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && messages.length === 0 && !error && (
          <div className="text-center text-muted-foreground py-8">
            <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-30" />
            <p>{language === 'fr' ? 'Aucun message.' : 'No messages yet.'}</p>
            {isActive && (
              <p className="text-sm mt-2">
                {language === 'fr'
                  ? 'Envoyez un message pour commencer la conversation.'
                  : 'Send a message to start the conversation.'}
              </p>
            )}
          </div>
        )}

        <AnimatePresence mode="popLayout">
          {messages.map((msg) => {
            const isOwn = msg.sender_role === role;
            const displayMessage = msg.body || msg.message;
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
                  <p className="text-sm">{displayMessage}</p>
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

      {/* Input area */}
      <div className="p-4 border-t bg-card">
        {isEnded ? (
          <div className="flex items-center justify-center gap-2 text-muted-foreground py-2">
            <Lock className="h-4 w-4" />
            <span className="text-sm">
              {language === 'fr'
                ? 'Cette course est terminée. La messagerie est fermée.'
                : 'This ride has ended. Messaging is closed.'}
            </span>
          </div>
        ) : isActive ? (
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
              autoFocus={!embedded}
            />
            <Button type="submit" size="icon" disabled={!newMessage.trim() || isSending}>
              <Send className="h-4 w-4" />
            </Button>
          </form>
        ) : (
          <div className="flex items-center justify-center gap-2 text-muted-foreground py-2">
            <Lock className="h-4 w-4" />
            <span className="text-sm">
              {role === 'rider'
                ? language === 'fr'
                  ? 'La messagerie sera disponible quand un chauffeur accepte la course.'
                  : 'Messaging will be available when a driver accepts the ride.'
                : language === 'fr'
                  ? "La messagerie n'est pas disponible."
                  : 'Messaging is not available.'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
