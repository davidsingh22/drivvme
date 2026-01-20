import { Bell, BellOff, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { useAuth } from '@/contexts/AuthContext';

export function PushNotificationToggle() {
  const { user } = useAuth();
  const { isSupported, isSubscribed, isLoading, permission, subscribe, unsubscribe } = usePushNotifications();

  if (!user) return null;
  
  if (!isSupported) {
    return (
      <Button variant="ghost" size="icon" disabled title="Push notifications not supported">
        <BellOff className="h-5 w-5 text-muted-foreground" />
      </Button>
    );
  }

  const handleToggle = async () => {
    if (isSubscribed) {
      await unsubscribe();
    } else {
      await subscribe();
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleToggle}
      disabled={isLoading || permission === 'denied'}
      title={
        permission === 'denied'
          ? 'Notifications blocked - enable in browser settings'
          : isSubscribed
          ? 'Disable notifications'
          : 'Enable notifications'
      }
    >
      {isLoading ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : isSubscribed ? (
        <Bell className="h-5 w-5 text-primary" />
      ) : (
        <BellOff className="h-5 w-5 text-muted-foreground" />
      )}
    </Button>
  );
}
