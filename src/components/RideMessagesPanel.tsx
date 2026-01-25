import { useState, useEffect } from 'react';
import { MessageSquare } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export default function RideMessagesPanel() {
  const { user, session } = useAuth();
  const [result, setResult] = useState<{ data: any[] | null; error: string | null; loading: boolean }>({
    data: null,
    error: null,
    loading: true,
  });

  const currentUserId = session?.user?.id ?? user?.id ?? null;

  useEffect(() => {
    const runQuery = async () => {
      setResult({ data: null, error: null, loading: true });

      const { data, error } = await supabase
        .from('ride_messages')
        .select('*')
        .limit(5);

      setResult({
        data: data,
        error: error ? `${error.code}: ${error.message}` : null,
        loading: false,
      });
    };

    runQuery();
  }, []);

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
        <h3 className="font-display font-semibold">Raw Query Test</h3>
      </div>

      {/* Content */}
      <div className="p-4 font-mono text-sm space-y-3">
        <div className="bg-muted p-3 rounded">
          <code>supabase.from('ride_messages').select('*').limit(5)</code>
        </div>

        {result.loading && (
          <div className="text-muted-foreground animate-pulse">Running query...</div>
        )}

        {!result.loading && (
          <>
            <div className="p-3 rounded bg-muted/50">
              <strong>data.length:</strong>{' '}
              <span className={result.data ? 'text-green-400' : 'text-destructive'}>
                {result.data ? result.data.length : 'null'}
              </span>
            </div>

            <div className="p-3 rounded bg-muted/50">
              <strong>error:</strong>{' '}
              <span className={result.error ? 'text-destructive' : 'text-green-400'}>
                {result.error || 'null'}
              </span>
            </div>

            {result.data && result.data.length > 0 && (
              <div className="p-3 rounded bg-muted/50 overflow-x-auto">
                <strong>First row:</strong>
                <pre className="mt-2 text-xs">{JSON.stringify(result.data[0], null, 2)}</pre>
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}