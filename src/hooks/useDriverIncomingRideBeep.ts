import { useEffect, useRef, useCallback } from "react";

/**
 * DRIVER INCOMING RIDE BEEP
 *
 * Uses Web Audio API OscillatorNode to generate a real audible tone.
 * This bypasses file-loading issues AND works better on mobile than
 * HTMLAudioElement (which gets blocked outside user-gesture contexts).
 *
 * The AudioContext is "unlocked" on the very first user interaction
 * (tap/click anywhere) so that subsequent programmatic plays work
 * even from realtime-callback contexts.
 *
 * RULES:
 * - Beep starts when incomingRideId is truthy (ride OFFER)
 * - Beep stops when incomingRideId becomes null/undefined
 * - Beep NEVER depends on active/accepted ride state
 */

// Singleton AudioContext – created once, reused forever
let _audioCtx: AudioContext | null = null;
let _unlocked = false;

function getAudioContext(): AudioContext {
  if (!_audioCtx) {
    _audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return _audioCtx;
}

// Unlock AudioContext on first user gesture (required by Safari / iOS)
function ensureUnlockListeners() {
  if (_unlocked) return;
  const unlock = () => {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    // Play a silent buffer to fully unlock
    try {
      const buf = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
    } catch (_e) {
      /* ignore */
    }
    _unlocked = true;
    document.removeEventListener("pointerdown", unlock, true);
    document.removeEventListener("click", unlock, true);
    document.removeEventListener("touchstart", unlock, true);
  };
  document.addEventListener("pointerdown", unlock, true);
  document.addEventListener("click", unlock, true);
  document.addEventListener("touchstart", unlock, true);
}

// Call once at module load
ensureUnlockListeners();

/** Play a single 200ms 880Hz beep using OscillatorNode */
function playBeepTone() {
  try {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = 880;
    gain.gain.value = 0.5;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
  } catch (_e) {
    /* AudioContext not available */
  }
}

export function useDriverIncomingRideBeep(
  incomingRideId: string | null | undefined
) {
  const intervalRef = useRef<number | null>(null);

  const stopBeep = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startBeep = useCallback(() => {
    stopBeep();

    // Play once immediately
    playBeepTone();

    // Then repeat every 1.2s
    intervalRef.current = window.setInterval(() => {
      playBeepTone();
    }, 1200);
  }, [stopBeep]);

  useEffect(() => {
    if (incomingRideId) {
      console.log("[BeepHook] ▶ Starting beep for ride:", incomingRideId);
      startBeep();
    } else {
      stopBeep();
    }
    return () => stopBeep();
  }, [incomingRideId, startBeep, stopBeep]);

  return { stopBeep };
}
