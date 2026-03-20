import { useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { fireSessionRefresh } from '@/lib/ensureFreshSession';

const INTERVAL_MS = 150_000; // 2.5 minutes

export function useBackgroundSessionRefresh() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;

    const id = setInterval(fireSessionRefresh, INTERVAL_MS);
    return () => clearInterval(id);
  }, [user]);
}
