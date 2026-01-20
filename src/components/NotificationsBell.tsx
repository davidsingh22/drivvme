import { useState } from "react";
import { useNotifications } from "@/hooks/useNotifications";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Bell } from "lucide-react";

type Props = { userId?: string };

export default function NotificationsBell({ userId }: Props) {
  const { items, unreadCount, markAllRead } = useNotifications(userId);
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge 
              variant="destructive" 
              className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs"
            >
              {unreadCount}
            </Badge>
          )}
        </Button>
      </SheetTrigger>

      <SheetContent>
        <SheetHeader>
          <SheetTitle className="flex items-center justify-between">
            Notifications
            <Button variant="ghost" size="sm" onClick={markAllRead}>
              Mark all read
            </Button>
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-3 max-h-[70vh] overflow-y-auto">
          {items.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              No notifications yet.
            </p>
          ) : (
            items.map((n) => (
              <div
                key={n.id}
                className={`p-3 rounded-lg border ${
                  n.is_read ? "bg-muted/50" : "bg-background border-primary/20"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-sm">{n.title}</p>
                  {!n.is_read && (
                    <Badge variant="secondary" className="text-xs">
                      New
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-1">{n.message}</p>
                <p className="text-xs text-muted-foreground mt-2">
                  {new Date(n.created_at).toLocaleString()}
                </p>
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
