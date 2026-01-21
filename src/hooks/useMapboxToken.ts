import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface TokenState {
  token: string | null;
  loading: boolean;
  error: string | null;
}

// Cache token in memory for instant reuse
let cachedToken: string | null = null;
let tokenFetchPromise: Promise<string | null> | null = null;

// Also cache in sessionStorage for page refreshes
const CACHE_KEY = 'mapbox_token_cache';
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

const getSessionCache = (): string | null => {
  try {
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) {
      const { token, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_DURATION) {
        return token;
      }
      sessionStorage.removeItem(CACHE_KEY);
    }
  } catch {
    // Ignore storage errors
  }
  return null;
};

const setSessionCache = (token: string) => {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ token, timestamp: Date.now() }));
  } catch {
    // Ignore storage errors
  }
};

export const useMapboxToken = (): TokenState => {
  const [state, setState] = useState<TokenState>(() => {
    // Check memory cache first, then session cache
    const token = cachedToken || getSessionCache();
    if (token) {
      cachedToken = token;
      return { token, loading: false, error: null };
    }
    return { token: null, loading: true, error: null };
  });

  useEffect(() => {
    // Already have token from cache
    if (state.token) return;

    const fetchToken = async () => {
      // If there's already a fetch in progress, wait for it
      if (tokenFetchPromise) {
        const token = await tokenFetchPromise;
        if (token) {
          setState({ token, loading: false, error: null });
        }
        return;
      }

      // Start new fetch
      tokenFetchPromise = (async () => {
        try {
          const { data, error } = await supabase.functions.invoke('get-mapbox-token');

          if (error) {
            setState({ token: null, loading: false, error: error.message });
            return null;
          }

          if (data?.error) {
            setState({ token: null, loading: false, error: data.error });
            return null;
          }

          if (data?.token) {
            cachedToken = data.token;
            setSessionCache(data.token);
            setState({ token: data.token, loading: false, error: null });
            return data.token;
          } else {
            setState({ token: null, loading: false, error: 'No token returned' });
            return null;
          }
        } catch (err: any) {
          setState({ token: null, loading: false, error: err.message || 'Failed to fetch token' });
          return null;
        } finally {
          tokenFetchPromise = null;
        }
      })();

      await tokenFetchPromise;
    };

    fetchToken();
  }, [state.token]);

  return state;
};
