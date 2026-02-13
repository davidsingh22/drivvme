import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type NotificationRow = {
  id: string;
  user_id: string;
  ride_id: string | null;
  type: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
};

export function useNotifications(userId?: string) {
  const [items, setItems] = useState<NotificationRow[]>([]);
  const unreadCount = useMemo(
    () => items.filter((n) => !n.is_read).length,
    [items]
  );

  useEffect(() => {
    if (!userId) return;

    let isMounted = true;

    // 1) Load latest notifications
    (async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(50);

      if (!error && isMounted && data) setItems(data as NotificationRow[]);
    })();

    // 2) Subscribe to realtime inserts
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const newRow = payload.new as NotificationRow;

          setItems((prev) => [newRow, ...prev]);

          // Pop a toast for general notifications only — skip ride request
          // notifications (drivers get a dedicated modal, riders should never see these)
          if (newRow.type !== 'new_ride') {
            toast(newRow.title, { description: newRow.message });
          }
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const markAllRead = async () => {
    if (!userId) return;
    const unreadIds = items.filter((n) => !n.is_read).map((n) => n.id);
    if (unreadIds.length === 0) return;

    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .in("id", unreadIds);

    if (!error) {
      setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
    }
  };

  return { items, unreadCount, markAllRead };
}
