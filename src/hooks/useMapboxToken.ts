import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface TokenState {
  token: string | null;
  loading: boolean;
  error: string | null;
}

export const useMapboxToken = (): TokenState => {
  const [state, setState] = useState<TokenState>({
    token: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    const fetchToken = async () => {
      try {
        const { data, error } = await supabase.functions.invoke('get-mapbox-token');

        if (error) {
          setState({ token: null, loading: false, error: error.message });
          return;
        }

        if (data?.error) {
          setState({ token: null, loading: false, error: data.error });
          return;
        }

        if (data?.token) {
          setState({ token: data.token, loading: false, error: null });
        } else {
          setState({ token: null, loading: false, error: 'No token returned' });
        }
      } catch (err: any) {
        setState({ token: null, loading: false, error: err.message || 'Failed to fetch token' });
      }
    };

    fetchToken();
  }, []);

  return state;
};
