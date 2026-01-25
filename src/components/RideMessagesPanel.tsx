import { useState, useEffect } from 'react';
import { MessageSquare } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface RideMessage {
  id: string;
  ride_id: string;
  sender_id: string;
  sender_role: 'driver' | 'rider';
  message: string;
  created_at: string;
}

export default function RideMessagesPanel() {
  const { user, session } = useAuth();
  const [messages, setMessages] = useState<RideMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const currentUserId = session?.user?.id ?? user?.id ?? null;

  // Simple fetch: last 5 messages for ANY ride linked to this driver
  useEffect(() => {
    if (!currentUserId) {
      setIsLoading(false);
      return;
    }

    const fetchMessages = async () => {
      setIsLoading(true);
      setError(null);
      
      try {
        // First get all ride IDs where this user is the driver
        const { data: rides, error: ridesError } = await supabase
          .from('rides')
          .select('id')
          .eq('driver_id', currentUserId);

        if (ridesError) {
          setError(`Rides query error: ${ridesError.message}`);
          setIsLoading(false);
          return;
        }

        const rideIds = rides?.map(r => r.id) || [];
        
        if (rideIds.length === 0) {
          setMessages([]);
          setIsLoading(false);
          return;
        }

        // Fetch last 5 messages from any of these rides
        const { data: msgs, error: msgsError } = await supabase
          .from('ride_messages')
          .select('*')
          .in('ride_id', rideIds)
          .order('created_at', { ascending: false })
          .limit(5);

        if (msgsError) {
          setError(`Messages query error: ${msgsError.message}`);
          setIsLoading(false);
          return;
        }

        const typedMsgs = (msgs || []).map(m => ({
          ...m,
          sender_role: m.sender_role as 'driver' | 'rider',
        }));

        // Reverse to show oldest first
        setMessages(typedMsgs.reverse());
      } catch (err: any) {
        setError(`Unexpected error: ${err.message}`);
      } finally {
        setIsLoading(false);
      }
    };

    fetchMessages();
  }, [currentUserId]);

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString('en-CA', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <Card className="mb-4 border-primary/30 overflow-visible" style={{ minHeight: 240 }}>
      {/* Giant debug header */}
      <div className="bg-green-500 text-black px-4 py-4 text-center font-bold">
        <div className="text-xl">Panel mounted ✅</div>
        <div className="text-sm font-mono mt-1">
          currentUserId: {currentUserId || 'null'}
        </div>
      </div>

      {/* Header */}
      <div className="flex items-center gap-2 p-4 border-b border-border">
        <MessageSquare className="h-5 w-5 text-primary" />
        <h3 className="font-display font-semibold">Ride Messages (Debug)</h3>
      </div>

      {/* Content */}
      <div className="p-4">
        {isLoading && (
          <div className="text-muted-foreground animate-pulse">Loading messages...</div>
        )}

        {error && (
          <div className="text-destructive text-sm font-mono bg-destructive/10 p-3 rounded">
            {error}
          </div>
        )}

        {!isLoading && !error && messages.length === 0 && (
          <div className="text-center text-muted-foreground py-4">
            <p>No messages found for this driver.</p>
          </div>
        )}

        {!isLoading && !error && messages.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground mb-3">
              Last {messages.length} message(s):
            </p>
            {messages.map((msg) => {
              const isOwn = msg.sender_role === 'driver';
              return (
                <div
                  key={msg.id}
                  className={`p-3 rounded-lg text-sm ${
                    isOwn ? 'bg-primary/20 text-foreground' : 'bg-muted'
                  }`}
                >
                  <div className="flex justify-between items-start gap-2">
                    <span className="font-mono text-xs opacity-70">
                      [{msg.sender_role}] {msg.ride_id.slice(0, 8)}...
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatTime(msg.created_at)}
                    </span>
                  </div>
                  <p className="mt-1">{msg.message}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}
