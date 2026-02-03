import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export const useUnreadSupportMessages = () => {
  const { user } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!user) {
      setUnreadCount(0);
      return;
    }

    const fetchUnread = async () => {
      const { data, error } = await supabase
        .from('support_messages')
        .select('id')
        .eq('user_id', user.id)
        .eq('status', 'replied')
        .not('admin_reply', 'is', null);

      if (!error && data) {
        // Check localStorage for read messages
        const readMessages = JSON.parse(localStorage.getItem('readSupportMessages') || '[]');
        const unread = data.filter(m => !readMessages.includes(m.id));
        setUnreadCount(unread.length);
      }
    };

    fetchUnread();

    // Subscribe to realtime updates
    const channel = supabase
      .channel('support-messages-unread')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'support_messages',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const newMsg = payload.new as any;
          if (newMsg.status === 'replied' && newMsg.admin_reply) {
            const readMessages = JSON.parse(localStorage.getItem('readSupportMessages') || '[]');
            if (!readMessages.includes(newMsg.id)) {
              setUnreadCount(prev => prev + 1);
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const markAsRead = (messageIds: string[]) => {
    const readMessages = JSON.parse(localStorage.getItem('readSupportMessages') || '[]');
    const updated = [...new Set([...readMessages, ...messageIds])];
    localStorage.setItem('readSupportMessages', JSON.stringify(updated));
    setUnreadCount(prev => Math.max(0, prev - messageIds.length));
  };

  const markAllAsRead = async () => {
    if (!user) return;
    
    const { data } = await supabase
      .from('support_messages')
      .select('id')
      .eq('user_id', user.id)
      .eq('status', 'replied')
      .not('admin_reply', 'is', null);

    if (data) {
      markAsRead(data.map(m => m.id));
    }
  };

  return { unreadCount, markAsRead, markAllAsRead };
};
