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
      // Only use valid tokens (not error states) and within cache duration
      if (token && typeof token === 'string' && token.startsWith('pk.') && Date.now() - timestamp < CACHE_DURATION) {
        return token;
      }
      sessionStorage.removeItem(CACHE_KEY);
    }
  } catch {
    // Ignore storage errors
  }
  return null;
};

export const clearMapboxTokenCache = () => {
  cachedToken = null;
  tokenFetchPromise = null;
  try {
    sessionStorage.removeItem(CACHE_KEY);
  } catch {
    // Ignore storage errors
  }
};

const setSessionCache = (token: string) => {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ token, timestamp: Date.now() }));
  } catch {
    // Ignore storage errors
  }
};

// Fetch token function that can be called early
const fetchTokenInternal = async (): Promise<string | null> => {
  // Check cache first — instant, no network
  const cached = cachedToken || getSessionCache();
  if (cached) {
    cachedToken = cached;
    return cached;
  }

  // If already fetching, return that promise
  if (tokenFetchPromise) {
    return tokenFetchPromise;
  }

  // Start new fetch with retry logic
  tokenFetchPromise = (async () => {
    const maxRetries = 1;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Try existing session first (instant, no network call)
        const { data: { session: existingSession } } = await supabase.auth.getSession();
        let session = existingSession;
        
        // Only refresh if no session or token is about to expire (< 60s)
        if (!session || (session.expires_at && session.expires_at * 1000 - Date.now() < 60000)) {
          const { data: refreshData } = await supabase.auth.refreshSession();
          session = refreshData?.session ?? null;
        }
        
        if (!session) {
          console.log('[useMapboxToken] No session available, skipping token fetch');
          return null;
        }

        const { data, error } = await supabase.functions.invoke('get-mapbox-token');

        if (error) {
          console.error(`Mapbox token fetch error (attempt ${attempt + 1}):`, error.message);
          if (attempt < maxRetries) {
            await new Promise(r => setTimeout(r, 300));
            continue;
          }
          return null;
        }

        if (data?.error) {
          console.error('Mapbox token error:', data.error);
          return null;
        }

        if (data?.token && typeof data.token === 'string' && data.token.startsWith('pk.')) {
          cachedToken = data.token;
          setSessionCache(data.token);
          return data.token;
        } else {
          console.error('Invalid mapbox token returned:', data);
          return null;
        }
      } catch (err: any) {
        console.error(`Mapbox token fetch failed (attempt ${attempt + 1}):`, err.message);
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 300));
          continue;
        }
        return null;
      }
    }
    return null;
  })();

  tokenFetchPromise.finally(() => {
    tokenFetchPromise = null;
  });

  return tokenFetchPromise;
};

// Prefetch token - only fetches if user is already authenticated
export const prefetchMapboxToken = async () => {
  // Check session cache first for instant availability
  const sessionToken = getSessionCache();
  if (sessionToken) {
    cachedToken = sessionToken;
    return;
  }
  
  // Check if user is authenticated before prefetching
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    // Start fetching in background
    fetchTokenInternal();
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

    let mounted = true;

    const fetchToken = async () => {
      // Wait for auth state to be determined
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        if (mounted) {
          setState({ token: null, loading: false, error: 'Not authenticated' });
        }
        return;
      }

      const token = await fetchTokenInternal();
      
      if (mounted) {
        if (token) {
          setState({ token, loading: false, error: null });
        } else {
          setState({ token: null, loading: false, error: 'Failed to load map token' });
        }
      }
    };

    fetchToken();

    return () => {
      mounted = false;
    };
  }, [state.token]);

  return state;
};
