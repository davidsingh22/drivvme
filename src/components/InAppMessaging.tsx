import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Send, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';

interface Message {
  id: string;
  sender_id: string;
  message: string;
  created_at: string;
  sender_name?: string;
}

interface InAppMessagingProps {
  rideId: string;
  recipientId: string;
  recipientName: string;
  onClose: () => void;
}

export default function InAppMessaging({ 
  rideId, 
  recipientId, 
  recipientName,
  onClose 
}: InAppMessagingProps) {
  const { user } = useAuth();
  const { language } = useLanguage();
  const { toast } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Fetch existing messages and subscribe to new ones
  useEffect(() => {
    if (!rideId || !user?.id) return;

    const fetchMessages = async () => {
      const { data } = await supabase
        .from('notifications')
        .select('id, user_id, message, created_at, title')
        .eq('ride_id', rideId)
        .eq('type', 'ride_message')
        .order('created_at', { ascending: true });

      if (data) {
        setMessages(data.map(n => ({
          id: n.id,
          sender_id: n.title === 'from_driver' ? recipientId : user.id,
          message: n.message,
          created_at: n.created_at,
        })));
      }
    };

    fetchMessages();

    // Subscribe to new messages
    const channel = supabase
      .channel(`messages-${rideId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `ride_id=eq.${rideId}`,
        },
        (payload) => {
          const notification = payload.new as any;
          if (notification.type === 'ride_message') {
            setMessages(prev => [...prev, {
              id: notification.id,
              sender_id: notification.title === 'from_driver' ? recipientId : user?.id || '',
              message: notification.message,
              created_at: notification.created_at,
            }]);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [rideId, user?.id, recipientId]);

  const sendMessage = async () => {
    if (!newMessage.trim() || !user?.id || !rideId) return;
    
    setIsSending(true);
    try {
      // Insert message as notification for the recipient
      const { error } = await supabase
        .from('notifications')
        .insert({
          user_id: recipientId,
          ride_id: rideId,
          title: 'from_driver', // Indicates sender type
          message: newMessage.trim(),
          type: 'ride_message',
        });

      if (error) throw error;

      setNewMessage('');
    } catch (err) {
      console.error('Error sending message:', err);
      toast({
        title: language === 'fr' ? 'Erreur' : 'Error',
        description: language === 'fr' ? "Impossible d'envoyer le message" : 'Failed to send message',
        variant: 'destructive',
      });
    } finally {
      setIsSending(false);
    }
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString(language === 'fr' ? 'fr-CA' : 'en-CA', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-background flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b bg-card">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <MessageSquare className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="font-semibold">{recipientName}</h2>
            <p className="text-xs text-muted-foreground">
              {language === 'fr' ? 'Messagerie' : 'Chat'}
            </p>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-5 w-5" />
        </Button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center text-muted-foreground py-8">
            {language === 'fr' 
              ? 'Aucun message. Envoyez un message pour commencer.'
              : 'No messages yet. Send a message to start chatting.'}
          </div>
        )}
        
        {messages.map((msg) => {
          const isOwn = msg.sender_id === user?.id;
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
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t bg-card">
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
          />
          <Button 
            type="submit" 
            size="icon" 
            disabled={!newMessage.trim() || isSending}
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </motion.div>
  );
}
