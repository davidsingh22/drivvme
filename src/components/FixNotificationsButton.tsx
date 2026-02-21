import { useState } from 'react';
import { Bell, Loader2, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export function FixNotificationsButton() {
  const { user } = useAuth();
  const [isFixing, setIsFixing] = useState(false);
  const [showPermissionDialog, setShowPermissionDialog] = useState(false);

  const openSystemSettings = () => {
    // Android intent for app notification settings (works in Median/WebView)
    const intentUrl = `intent://settings/app_notification#Intent;scheme=android-app;end`;
    // Fallback: try standard Android settings deep link
    try {
      (window as any).median?.run?.({ url: 'gonative://webview/open?url=app-settings:' });
    } catch { /* ignore */ }
    // For web browsers, just show instructions
    toast.info('Open your device Settings → Apps → DrivveMe → Notifications → Enable');
  };

  const handleFix = async () => {
    if (!user?.id) {
      toast.error('You must be logged in');
      return;
    }

    setIsFixing(true);

    try {
      // 1. Clear all local OneSignal data
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('onesignal') || key.startsWith('OneSignal') || key.startsWith('os_'))) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
      console.log('[FixNotifications] Cleared', keysToRemove.length, 'OneSignal localStorage keys');

      // 2. Clear stored player ID from database
      await supabase
        .from('profiles')
        .update({ onesignal_player_id: null })
        .eq('user_id', user.id);
      console.log('[FixNotifications] Cleared onesignal_player_id from DB');

      // 3. OneSignal hard reset
      const OS = (window as any).OneSignal;
      if (OS) {
        // Logout first to disconnect old external ID
        try {
          if (OS.logout) await OS.logout();
          else if (OS.removeExternalUserId) await OS.removeExternalUserId();
          console.log('[FixNotifications] OneSignal logout done');
        } catch (e) {
          console.warn('[FixNotifications] OneSignal logout error:', e);
        }

        // Small delay to let logout propagate
        await new Promise(r => setTimeout(r, 1000));

        // Request permission
        try {
          if (OS.Notifications?.requestPermission) {
            await OS.Notifications.requestPermission(true);
          } else if (OS.registerForPushNotifications) {
            await OS.registerForPushNotifications();
          }
          console.log('[FixNotifications] Permission requested');
        } catch (e) {
          console.warn('[FixNotifications] Permission request error:', e);
        }

        // Check if permission was granted
        const permStatus = OS.Notifications?.permission ??
          (typeof Notification !== 'undefined' ? Notification.permission : 'default');

        if (permStatus === 'denied' || permStatus === false) {
          setShowPermissionDialog(true);
          setIsFixing(false);
          return;
        }

        // Small delay before login
        await new Promise(r => setTimeout(r, 500));

        // Re-login with current user ID
        try {
          if (OS.login) {
            await OS.login(user.id);
          } else if (OS.setExternalUserId) {
            await OS.setExternalUserId(user.id);
          }
          console.log('[FixNotifications] OneSignal login done with', user.id);
        } catch (e) {
          console.warn('[FixNotifications] OneSignal login error:', e);
        }

        // Capture new player ID after a delay
        await new Promise(r => setTimeout(r, 2000));
        const newPlayerId = OS.User?.PushSubscription?.id ??
          (OS.getUserId ? await OS.getUserId() : null);

        if (newPlayerId) {
          await supabase
            .from('profiles')
            .update({ onesignal_player_id: newPlayerId })
            .eq('user_id', user.id);
          console.log('[FixNotifications] Saved new player ID:', newPlayerId);
        }

        toast.success('Notifications reset successfully!');
      } else {
        // Try Median native bridge
        try {
          (window as any).median?.onesignal?.externalUserId?.remove?.();
          await new Promise(r => setTimeout(r, 500));
          (window as any).median?.onesignal?.externalUserId?.set?.({ externalId: user.id });
          console.log('[FixNotifications] Median bridge reset done');
          toast.success('Notifications reset successfully!');
        } catch (e) {
          console.warn('[FixNotifications] Median bridge error:', e);
          toast.error('Could not reset notifications. Try reinstalling the app.');
        }
      }
    } catch (err) {
      console.error('[FixNotifications] Error:', err);
      toast.error('Failed to reset notifications');
    } finally {
      setIsFixing(false);
    }
  };

  if (!user) return null;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={handleFix}
        disabled={isFixing}
        className="gap-2"
      >
        {isFixing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Bell className="h-4 w-4" />
        )}
        {isFixing ? 'Fixing...' : 'Fix Notifications'}
      </Button>

      <AlertDialog open={showPermissionDialog} onOpenChange={setShowPermissionDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Action Required</AlertDialogTitle>
            <AlertDialogDescription>
              Notifications are blocked. You need to enable them in your device's System Settings for DrivveMe to send you ride alerts.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
            <Button variant="secondary" onClick={() => setShowPermissionDialog(false)}>
              Later
            </Button>
            <Button onClick={() => { openSystemSettings(); setShowPermissionDialog(false); }} className="gap-2">
              <Settings className="h-4 w-4" />
              Open System Settings
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
