import { useState, useEffect, useCallback, useRef } from 'react';

interface WakeLockState {
  isSupported: boolean;
  isActive: boolean;
  isLoading: boolean;
  error: string | null;
}

export function useWakeLock() {
  const [state, setState] = useState<WakeLockState>({
    isSupported: false,
    isActive: false,
    isLoading: false,
    error: null,
  });
  
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  // Check if Wake Lock API is supported
  useEffect(() => {
    const isSupported = 'wakeLock' in navigator;
    setState(prev => ({ ...prev, isSupported }));
  }, []);

  // Re-acquire wake lock when page becomes visible again
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible' && wakeLockRef.current === null && state.isActive) {
        // Try to re-acquire if we had it before
        try {
          wakeLockRef.current = await navigator.wakeLock.request('screen');
        } catch (err) {
          console.log('Failed to re-acquire wake lock:', err);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [state.isActive]);

  const requestWakeLock = useCallback(async () => {
    if (!state.isSupported) {
      setState(prev => ({ ...prev, error: 'Wake Lock not supported' }));
      return false;
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      wakeLockRef.current = await navigator.wakeLock.request('screen');
      
      wakeLockRef.current.addEventListener('release', () => {
        setState(prev => ({ ...prev, isActive: false }));
        wakeLockRef.current = null;
      });

      setState(prev => ({ ...prev, isActive: true, isLoading: false }));
      return true;
    } catch (err: any) {
      const errorMessage = err?.message || 'Failed to request wake lock';
      setState(prev => ({ ...prev, isLoading: false, error: errorMessage }));
      return false;
    }
  }, [state.isSupported]);

  const releaseWakeLock = useCallback(async () => {
    if (wakeLockRef.current) {
      try {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
        setState(prev => ({ ...prev, isActive: false }));
        return true;
      } catch (err) {
        console.error('Failed to release wake lock:', err);
        return false;
      }
    }
    return true;
  }, []);

  const toggleWakeLock = useCallback(async () => {
    if (state.isActive) {
      return releaseWakeLock();
    } else {
      return requestWakeLock();
    }
  }, [state.isActive, requestWakeLock, releaseWakeLock]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
      }
    };
  }, []);

  return {
    ...state,
    requestWakeLock,
    releaseWakeLock,
    toggleWakeLock,
  };
}
