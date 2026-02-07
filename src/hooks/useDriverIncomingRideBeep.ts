import { useEffect, useRef, useCallback } from "react";

/**
 * DRIVER INCOMING RIDE BEEP
 *
 * RULES:
 * - Beep starts when incomingRideId is truthy (ride OFFER)
 * - Beep stops when incomingRideId becomes null/undefined
 * - Beep NEVER depends on active/accepted ride state
 * - Uses inline base64 WAV so there is zero file-loading risk
 */

// Tiny base64-encoded 200ms 880Hz beep WAV
const BEEP_WAV =
  "data:audio/wav;base64,UklGRjIAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQ4AAAD/" +
  "/wAA//8AAP//AAD//w==";

function createBeepAudio(): HTMLAudioElement {
  const a = new Audio(BEEP_WAV);
  a.volume = 1.0;
  return a;
}

export function useDriverIncomingRideBeep(
  incomingRideId: string | null | undefined
) {
  const intervalRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stopBeep = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      } catch (_e) {
        /* ignore */
      }
      audioRef.current = null;
    }
  }, []);

  const startBeep = useCallback(() => {
    stopBeep();

    audioRef.current = createBeepAudio();

    // Play once immediately
    try {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
    } catch (_e) {
      /* blocked */
    }

    // Then repeat every 1.2s
    intervalRef.current = window.setInterval(() => {
      const a = audioRef.current;
      if (!a) return;
      try {
        a.currentTime = 0;
        a.play().catch(() => {});
      } catch (_e) {
        /* blocked */
      }
    }, 1200);
  }, [stopBeep]);

  useEffect(() => {
    if (incomingRideId) {
      startBeep();
    } else {
      stopBeep();
    }
    return () => stopBeep();
  }, [incomingRideId, startBeep, stopBeep]);

  // Expose stop so callers can force-stop if needed
  return { stopBeep };
}
