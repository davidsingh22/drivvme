import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

function detectSource(): string {
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream) return 'ios';
  if (/android/i.test(ua)) return 'android';
  return 'web';
}

interface LogActivityParams {
  userId: string;
  role?: string;
  eventType: string;
  message: string;
  meta?: Record<string, any>;
}

export async function logActivity({ userId, role = 'RIDER', eventType, message, meta }: LogActivityParams) {
  try {
    const { error } = await supabase.from('activity_events' as any).insert({
      user_id: userId,
      role,
      event_type: eventType,
      message,
      source: detectSource(),
      ...(meta ? { meta } : {}),
    });
    if (error) {
      console.error(`[Activity] ${eventType} insert error:`, error.message);
      toast({ title: 'Activity log failed', description: error.message, variant: 'destructive' });
    }
  } catch (e: any) {
    console.error(`[Activity] ${eventType} exception:`, e.message);
    toast({ title: 'Activity log failed', description: e.message, variant: 'destructive' });
  }
}
