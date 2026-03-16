import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Send, Loader2, Megaphone, History } from 'lucide-react';
import { format } from 'date-fns';

interface NotificationLog {
  id: string;
  title: string;
  message: string;
  audience: string;
  sent_at: string;
  sent_by_admin: string;
}

export function AdminPushNotificationsPanel() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [audience, setAudience] = useState('all');
  const [sending, setSending] = useState(false);
  const [logs, setLogs] = useState<NotificationLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(true);

  const fetchLogs = async () => {
    setLoadingLogs(true);
    const { data, error } = await supabase
      .from('admin_notifications_log')
      .select('*')
      .order('sent_at', { ascending: false })
      .limit(50);
    if (!error && data) setLogs(data as NotificationLog[]);
    setLoadingLogs(false);
  };

  useEffect(() => { fetchLogs(); }, []);

  const handleSend = async () => {
    if (!title.trim() || !message.trim()) {
      toast({ title: 'Missing fields', description: 'Title and message are required.', variant: 'destructive' });
      return;
    }
    setSending(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;

      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/admin-send-notification`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ title: title.trim(), message: message.trim(), audience }),
        }
      );

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to send');

      toast({ title: 'Notification sent!', description: `Delivered to ${result.recipients ?? '?'} recipient(s).` });
      setTitle('');
      setMessage('');
      setAudience('all');
      fetchLogs();
    } catch (err: any) {
      toast({ title: 'Failed to send', description: err.message, variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  const audienceLabel = (a: string) => {
    if (a === 'drivers') return 'Drivers only';
    if (a === 'riders') return 'Riders only';
    return 'All users';
  };

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {/* Send Panel */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Megaphone className="w-5 h-5" />
            Send Push Notification
          </CardTitle>
          <CardDescription>
            Broadcast a push notification to users via OneSignal.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Title</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Notification title..." />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Message</label>
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Notification message..." rows={3} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Target Audience</label>
            <Select value={audience} onValueChange={setAudience}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All users</SelectItem>
                <SelectItem value="drivers">Drivers only</SelectItem>
                <SelectItem value="riders">Riders only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleSend} disabled={sending || !title.trim() || !message.trim()} className="w-full">
            {sending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
            Send Notification
          </Button>
        </CardContent>
      </Card>

      {/* Log Panel */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="w-5 h-5" />
            Notification History
          </CardTitle>
          <CardDescription>Recent admin push notifications.</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingLogs ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : logs.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No notifications sent yet.</p>
          ) : (
            <div className="border rounded-lg max-h-[400px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Audience</TableHead>
                    <TableHead>Sent At</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell>
                        <p className="font-medium text-sm">{log.title}</p>
                        <p className="text-xs text-muted-foreground truncate max-w-[200px]">{log.message}</p>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{audienceLabel(log.audience)}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {format(new Date(log.sent_at), 'MMM d, HH:mm')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
