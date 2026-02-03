import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { 
  Loader2, 
  Send, 
  MessageSquare, 
  CheckCircle, 
  Clock, 
  User,
  Car,
  RefreshCw,
  XCircle
} from 'lucide-react';
import { format } from 'date-fns';

interface SupportMessage {
  id: string;
  user_id: string;
  user_role: string;
  subject: string;
  message: string;
  status: string;
  admin_reply: string | null;
  replied_at: string | null;
  replied_by: string | null;
  created_at: string;
  user_name?: string;
  user_email?: string;
}

export const SupportMessagesPanel = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedMessage, setSelectedMessage] = useState<SupportMessage | null>(null);
  const [replyText, setReplyText] = useState('');
  const [isReplying, setIsReplying] = useState(false);
  const [filter, setFilter] = useState<'all' | 'open' | 'replied' | 'closed'>('all');

  useEffect(() => {
    fetchMessages();
    subscribeToMessages();
  }, []);

  const fetchMessages = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('support_messages')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Fetch user profiles for names
      if (data && data.length > 0) {
        const userIds = [...new Set(data.map(m => m.user_id))];
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, first_name, last_name, email')
          .in('user_id', userIds);

        const profilesMap: Record<string, any> = {};
        profiles?.forEach(p => {
          profilesMap[p.user_id] = p;
        });

        const messagesWithNames = data.map(m => ({
          ...m,
          user_name: profilesMap[m.user_id]
            ? `${profilesMap[m.user_id].first_name || ''} ${profilesMap[m.user_id].last_name || ''}`.trim() || 'Unknown'
            : 'Unknown',
          user_email: profilesMap[m.user_id]?.email || 'N/A',
        }));

        setMessages(messagesWithNames);
      } else {
        setMessages([]);
      }
    } catch (error) {
      console.error('Error fetching support messages:', error);
      toast({
        title: 'Failed to load messages',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const subscribeToMessages = () => {
    const channel = supabase
      .channel('support-messages-admin')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'support_messages',
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            toast({
              title: '📩 New Support Message!',
              description: (payload.new as SupportMessage).subject,
            });
            fetchMessages();
          } else if (payload.eventType === 'UPDATE') {
            fetchMessages();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

  const handleReply = async () => {
    if (!selectedMessage || !replyText.trim() || !user) return;

    setIsReplying(true);
    try {
      const { error } = await supabase
        .from('support_messages')
        .update({
          admin_reply: replyText.trim(),
          replied_at: new Date().toISOString(),
          replied_by: user.id,
          status: 'replied',
        })
        .eq('id', selectedMessage.id);

      if (error) throw error;

      toast({
        title: '✅ Reply sent!',
        description: 'The user will be notified.',
      });

      setSelectedMessage(null);
      setReplyText('');
      fetchMessages();
    } catch (error: any) {
      console.error('Error sending reply:', error);
      toast({
        title: 'Failed to send reply',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsReplying(false);
    }
  };

  const updateStatus = async (id: string, status: string) => {
    try {
      const { error } = await supabase
        .from('support_messages')
        .update({ status })
        .eq('id', id);

      if (error) throw error;
      toast({ title: `Status updated to ${status}` });
      fetchMessages();
    } catch (error: any) {
      toast({
        title: 'Failed to update status',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'open':
        return <Badge variant="outline" className="bg-yellow-500/20 text-yellow-400 border-yellow-500/50"><Clock className="h-3 w-3 mr-1" /> Open</Badge>;
      case 'replied':
        return <Badge variant="outline" className="bg-green-500/20 text-green-400 border-green-500/50"><CheckCircle className="h-3 w-3 mr-1" /> Replied</Badge>;
      case 'closed':
        return <Badge variant="secondary"><XCircle className="h-3 w-3 mr-1" /> Closed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getRoleBadge = (role: string) => {
    if (role === 'driver') {
      return <Badge variant="outline" className="bg-blue-500/20 text-blue-400 border-blue-500/50"><Car className="h-3 w-3 mr-1" /> Driver</Badge>;
    }
    return <Badge variant="outline" className="bg-purple-500/20 text-purple-400 border-purple-500/50"><User className="h-3 w-3 mr-1" /> Rider</Badge>;
  };

  const filteredMessages = messages.filter(m => {
    if (filter === 'all') return true;
    return m.status === filter;
  });

  const openCount = messages.filter(m => m.status === 'open').length;

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5" />
                Support Messages
                {openCount > 0 && (
                  <Badge variant="destructive">{openCount} new</Badge>
                )}
              </CardTitle>
              <CardDescription>
                Help requests from riders and drivers
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={fetchMessages}>
              <RefreshCw className="h-4 w-4 mr-1" />
              Refresh
            </Button>
          </div>

          {/* Filter tabs */}
          <div className="flex gap-2 pt-2">
            {(['all', 'open', 'replied', 'closed'] as const).map((f) => (
              <Button
                key={f}
                variant={filter === f ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilter(f)}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
                {f === 'open' && openCount > 0 && (
                  <Badge variant="secondary" className="ml-1">{openCount}</Badge>
                )}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredMessages.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No messages found</p>
            </div>
          ) : (
            <ScrollArea className="h-[500px]">
              <div className="space-y-3">
                {filteredMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`border rounded-lg p-4 space-y-2 cursor-pointer hover:bg-muted/50 transition-colors ${
                      msg.status === 'open' ? 'border-yellow-500/50 bg-yellow-500/5' : 'border-border'
                    }`}
                    onClick={() => {
                      setSelectedMessage(msg);
                      setReplyText(msg.admin_reply || '');
                    }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium">{msg.subject}</h4>
                        {getRoleBadge(msg.user_role)}
                      </div>
                      {getStatusBadge(msg.status)}
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2">{msg.message}</p>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{msg.user_name} ({msg.user_email})</span>
                      <span>{format(new Date(msg.created_at), 'MMM d, yyyy h:mm a')}</span>
                    </div>
                    {msg.admin_reply && (
                      <div className="mt-2 p-2 bg-primary/10 rounded-md border border-primary/20">
                        <p className="text-xs font-medium text-primary mb-1">Your Reply:</p>
                        <p className="text-sm line-clamp-2">{msg.admin_reply}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Reply Dialog */}
      <Dialog open={!!selectedMessage} onOpenChange={(open) => !open && setSelectedMessage(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedMessage && getRoleBadge(selectedMessage.user_role)}
              {selectedMessage?.subject}
            </DialogTitle>
            <DialogDescription>
              From: {selectedMessage?.user_name} ({selectedMessage?.user_email})
            </DialogDescription>
          </DialogHeader>

          {selectedMessage && (
            <div className="space-y-4">
              <div className="p-3 bg-muted rounded-lg">
                <p className="text-sm">{selectedMessage.message}</p>
                <p className="text-xs text-muted-foreground mt-2">
                  {format(new Date(selectedMessage.created_at), 'MMM d, yyyy h:mm a')}
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Your Reply</label>
                <Textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Type your response..."
                  rows={4}
                />
              </div>

              <div className="flex gap-2">
                {selectedMessage.status !== 'closed' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      updateStatus(selectedMessage.id, 'closed');
                      setSelectedMessage(null);
                    }}
                  >
                    <XCircle className="h-4 w-4 mr-1" />
                    Close
                  </Button>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedMessage(null)}>
              Cancel
            </Button>
            <Button onClick={handleReply} disabled={isReplying || !replyText.trim()}>
              {isReplying ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Send Reply
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
