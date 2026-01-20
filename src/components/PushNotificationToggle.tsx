import { useMemo, useState } from 'react';
import { Bell, BellOff, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { useAuth } from '@/contexts/AuthContext';
import { NotificationPermissionHelpDialog } from '@/components/NotificationPermissionHelpDialog';

export function PushNotificationToggle() {
  const { user } = useAuth();
  const { isSupported, isSubscribed, isLoading, permission, subscribe, unsubscribe, refreshPermission } = usePushNotifications();
  const [helpOpen, setHelpOpen] = useState(false);

  const title = useMemo(() => {
    if (!isSupported) return 'Push notifications not supported';
    if (permission === 'denied') return 'Notifications blocked - tap to see how to enable';
    return isSubscribed ? 'Disable notifications' : 'Enable notifications';
  }, [isSupported, permission, isSubscribed]);

  if (!user) return null;

  if (!isSupported) {
    return (
      <>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setHelpOpen(true)}
          title={title}
        >
          <BellOff className="h-5 w-5 text-muted-foreground" />
        </Button>
        <NotificationPermissionHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
      </>
    );
  }

  const handleToggle = async () => {
    // If blocked, show help instead of doing nothing.
    refreshPermission();
    if (Notification.permission === 'denied' || permission === 'denied') {
      setHelpOpen(true);
      return;
    }

    if (isSubscribed) {
      await unsubscribe();
    } else {
      await subscribe();
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={handleToggle}
        disabled={isLoading}
        title={title}
      >
        {isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : isSubscribed ? (
          <Bell className="h-5 w-5 text-primary" />
        ) : (
          <BellOff className="h-5 w-5 text-muted-foreground" />
        )}
      </Button>

      <NotificationPermissionHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </>
  );
}
