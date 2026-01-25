import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, Send, X, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
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
  sender_role: 'driver' | 'rider';
  message: string;
  created_at: string;
}

interface RideMessagingProps {
  rideId: string;
  rideStatus: string;
  driverId: string | null;
  driverName?: string;
  className?: string;
}

export default function RideMessaging({ 
  rideId, 
  rideStatus, 
  driverId,
  driverName = 'Driver',
  className 
}: RideMessagingProps) {
  const { user } = useAuth();
  const { language } = useLanguage();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<RideMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastReadTimestampRef = useRef<string | null>(null);

  const isActive = ACTIVE_STATUSES.includes(rideStatus);
  const isEnded = rideStatus === 'completed' || rideStatus === 'cancelled';

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Fetch messages and subscribe to realtime updates
  useEffect(() => {
    if (!rideId || !user?.id) return;

    const fetchMessages = async () => {
      const { data, error } = await supabase
        .from('ride_messages')
        .select('*')
        .eq('ride_id', rideId)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Error fetching messages:', error);
        return;
      }
      
      // Type assertion for sender_role since DB returns string
      const typedData = (data || []).map(m => ({
        ...m,
        sender_role: m.sender_role as 'driver' | 'rider',
      }));

      setMessages(typedData);
      
      // Count unread (messages from driver since last read)
      if (typedData.length > 0) {
        const driverMessages = typedData.filter(m => m.sender_role === 'driver');
        if (driverMessages.length > 0) {
          const lastRead = lastReadTimestampRef.current;
          if (lastRead) {
            const unread = driverMessages.filter(m => m.created_at > lastRead).length;
            setUnreadCount(unread);
          } else {
            // First load - mark all as read if sheet is open
            if (isOpen) {
              lastReadTimestampRef.current = driverMessages[driverMessages.length - 1].created_at;
              setUnreadCount(0);
            } else {
              setUnreadCount(driverMessages.length);
            }
          }
        }
      }
    };

    fetchMessages();

    // Subscribe to new messages
    const channel = supabase
      .channel(`ride-messages-${rideId}`)
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
            // Avoid duplicates
            if (prev.some(m => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
          
          // Update unread count if from driver and sheet is closed
          if (newMsg.sender_role === 'driver' && !isOpen) {
            setUnreadCount(prev => prev + 1);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [rideId, user?.id, isOpen]);

  // Mark messages as read when opening
  useEffect(() => {
    if (isOpen && messages.length > 0) {
      const driverMessages = messages.filter(m => m.sender_role === 'driver');
      if (driverMessages.length > 0) {
        lastReadTimestampRef.current = driverMessages[driverMessages.length - 1].created_at;
      }
      setUnreadCount(0);
    }
  }, [isOpen, messages]);

  const sendMessage = useCallback(async () => {
    if (!newMessage.trim() || !user?.id || !rideId || !isActive) return;

    setIsSending(true);
    try {
      const { error } = await supabase
        .from('ride_messages')
        .insert({
          ride_id: rideId,
          sender_id: user.id,
          sender_role: 'rider',
          message: newMessage.trim(),
        });

      if (error) {
        // Check if it's a policy violation (ride not active)
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
      console.error('Error sending message:', err);
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
  }, [newMessage, user?.id, rideId, isActive, toast, language]);

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString(language === 'fr' ? 'fr-CA' : 'en-CA', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Don't show if no driver assigned yet
  if (!driverId) return null;

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Button 
          variant="outline" 
          size="icon" 
          className={`relative ${className}`}
          disabled={!isActive && !isEnded}
        >
          <MessageSquare className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="h-[85vh] rounded-t-xl p-0">
        <SheetHeader className="p-4 border-b bg-card">
          <SheetTitle className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <MessageSquare className="h-5 w-5 text-primary" />
            </div>
            <div className="text-left">
              <p className="font-semibold">
                {language === 'fr' ? 'Messages de la course' : 'Ride Messages'}
              </p>
              <p className="text-xs text-muted-foreground font-normal">
                {driverName}
              </p>
            </div>
          </SheetTitle>
        </SheetHeader>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 h-[calc(85vh-160px)]">
          {messages.length === 0 && (
            <div className="text-center text-muted-foreground py-8">
              <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-30" />
              <p>{language === 'fr' ? 'Aucun message.' : 'No messages yet.'}</p>
            </div>
          )}

          <AnimatePresence mode="popLayout">
            {messages.map((msg) => {
              const isOwn = msg.sender_role === 'rider';
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
              />
              <Button 
                type="submit" 
                size="icon" 
                disabled={!newMessage.trim() || isSending}
              >
                <Send className="h-4 w-4" />
              </Button>
            </form>
          ) : (
            <div className="flex items-center justify-center gap-2 text-muted-foreground py-2">
              <Lock className="h-4 w-4" />
              <span className="text-sm">
                {language === 'fr' 
                  ? 'La messagerie sera disponible quand un chauffeur accepte la course.'
                  : 'Messaging will be available when a driver accepts the ride.'}
              </span>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
