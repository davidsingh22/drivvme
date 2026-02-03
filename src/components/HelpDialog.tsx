import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Send, MessageSquare, CheckCircle, Clock, HelpCircle } from 'lucide-react';
import { format } from 'date-fns';

interface SupportMessage {
  id: string;
  subject: string;
  message: string;
  status: string;
  admin_reply: string | null;
  replied_at: string | null;
  created_at: string;
}

interface HelpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const HelpDialog = ({ open, onOpenChange }: HelpDialogProps) => {
  const { user, isRider, isDriver } = useAuth();
  const { toast } = useToast();
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [view, setView] = useState<'new' | 'history'>('new');

  useEffect(() => {
    if (open && user) {
      fetchMessages();
      subscribeToMessages();
    }
  }, [open, user]);

  const fetchMessages = async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('support_messages')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setMessages(data || []);
    } catch (error) {
      console.error('Error fetching messages:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const subscribeToMessages = () => {
    if (!user) return;

    const channel = supabase
      .channel('support-messages-user')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'support_messages',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setMessages(prev => [payload.new as SupportMessage, ...prev]);
          } else if (payload.eventType === 'UPDATE') {
            setMessages(prev =>
              prev.map(m => m.id === (payload.new as SupportMessage).id ? payload.new as SupportMessage : m)
            );
            // Show toast if admin replied
            if ((payload.new as SupportMessage).admin_reply && !(payload.old as any)?.admin_reply) {
              toast({
                title: '📩 Admin replied!',
                description: 'You have a new response from support.',
              });
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !subject.trim() || !message.trim()) return;

    setIsSubmitting(true);
    try {
      const userRole = isDriver ? 'driver' : 'rider';
      
      const { error } = await supabase
        .from('support_messages')
        .insert({
          user_id: user.id,
          user_role: userRole,
          subject: subject.trim(),
          message: message.trim(),
        });

      if (error) throw error;

      toast({
        title: '✅ Message sent!',
        description: 'We\'ll respond as soon as possible.',
      });

      setSubject('');
      setMessage('');
      setView('history');
    } catch (error: any) {
      console.error('Error sending message:', error);
      toast({
        title: 'Failed to send',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'open':
        return <Badge variant="outline" className="bg-yellow-500/20 text-yellow-400 border-yellow-500/50"><Clock className="h-3 w-3 mr-1" /> Pending</Badge>;
      case 'replied':
        return <Badge variant="outline" className="bg-green-500/20 text-green-400 border-green-500/50"><CheckCircle className="h-3 w-3 mr-1" /> Replied</Badge>;
      case 'closed':
        return <Badge variant="secondary">Closed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HelpCircle className="h-5 w-5 text-primary" />
            Help & Support
          </DialogTitle>
          <DialogDescription>
            Send us a message and we'll help you right away.
          </DialogDescription>
        </DialogHeader>

        {/* Tab switcher */}
        <div className="flex gap-2 border-b border-border pb-2">
          <Button
            variant={view === 'new' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setView('new')}
          >
            <Send className="h-4 w-4 mr-1" />
            New Message
          </Button>
          <Button
            variant={view === 'history' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setView('history')}
          >
            <MessageSquare className="h-4 w-4 mr-1" />
            My Messages
            {messages.filter(m => m.status === 'replied' && !m.admin_reply).length > 0 && (
              <Badge variant="destructive" className="ml-1 h-5 w-5 p-0 flex items-center justify-center text-xs">
                {messages.filter(m => m.status === 'replied').length}
              </Badge>
            )}
          </Button>
        </div>

        {view === 'new' ? (
          <form onSubmit={handleSubmit} className="space-y-4 flex-1">
            <div className="space-y-2">
              <label className="text-sm font-medium">Subject</label>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="What do you need help with?"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Message</label>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Describe your issue in detail..."
                rows={4}
                required
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={isSubmitting || !subject.trim() || !message.trim()}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    Send Message
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <ScrollArea className="flex-1 min-h-[200px] max-h-[400px]">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : messages.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No messages yet</p>
              </div>
            ) : (
              <div className="space-y-3 pr-4">
                {messages.map((msg) => (
                  <div key={msg.id} className="border border-border rounded-lg p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="font-medium text-sm line-clamp-1">{msg.subject}</h4>
                      {getStatusBadge(msg.status)}
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2">{msg.message}</p>
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(msg.created_at), 'MMM d, yyyy h:mm a')}
                    </p>
                    {msg.admin_reply && (
                      <div className="mt-2 p-2 bg-primary/10 rounded-md border border-primary/20">
                        <p className="text-xs font-medium text-primary mb-1">Admin Reply:</p>
                        <p className="text-sm">{msg.admin_reply}</p>
                        {msg.replied_at && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {format(new Date(msg.replied_at), 'MMM d, yyyy h:mm a')}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
};
