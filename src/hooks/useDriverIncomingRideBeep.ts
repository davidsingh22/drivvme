import { useEffect, useRef, useCallback } from "react";

/**
 * DRIVER INCOMING RIDE BEEP
 *
 * Uses Web Audio API OscillatorNode to generate a real audible tone.
 * 
 * KEY MOBILE FIX: On iOS / mobile browsers the AudioContext starts
 * "suspended" and can only be resumed inside a user-gesture handler.
 * We listen for EVERY gesture (not just the first) because iOS can
 * re-suspend after backgrounding. If a beep is requested while
 * suspended, we queue it and fire as soon as the context resumes.
 */

// ── Singleton AudioContext ──────────────────────────────────────
let _audioCtx: AudioContext | null = null;
let _unlocked = false;
let _pendingBeep = false;

function getOrCreateCtx(): AudioContext {
  if (!_audioCtx) {
    _audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return _audioCtx;
}

// ── Core tone generator ─────────────────────────────────────────
function fireBeep(ctx: AudioContext) {
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = 880;
    gain.gain.value = 0.45;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
    console.log("[BeepHook] 🔊 tone fired");
  } catch (_e) {
    console.warn("[BeepHook] fireBeep failed", _e);
  }
}

// ── Public play function (queues if ctx suspended) ──────────────
function playBeepTone() {
  try {
    const ctx = getOrCreateCtx();
    if (ctx.state === "suspended") {
      console.log("[BeepHook] ctx suspended – queuing beep & resuming");
      _pendingBeep = true;
      ctx.resume().then(() => {
        if (_pendingBeep) {
          _pendingBeep = false;
          fireBeep(ctx);
        }
      }).catch(() => {});
      return;
    }
    fireBeep(ctx);
  } catch (_e) {
    /* ignore */
  }
}

// ── Unlock on EVERY user gesture (iOS re-suspends after bg) ─────
function onUserGesture() {
  const ctx = getOrCreateCtx();
  if (ctx.state === "suspended") {
    ctx.resume().then(() => {
      console.log("[BeepHook] ctx resumed via gesture");
      if (_pendingBeep) {
        _pendingBeep = false;
        fireBeep(ctx);
      }
    }).catch(() => {});
  }
  // Play silent buffer to fully prime output on iOS (once)
  if (!_unlocked) {
    try {
      const buf = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
    } catch (_e) { /* */ }
    _unlocked = true;
    console.log("[BeepHook] AudioContext unlocked via gesture");
  }
}

document.addEventListener("pointerdown", onUserGesture, true);
document.addEventListener("touchstart", onUserGesture, true);
document.addEventListener("click", onUserGesture, true);

// ── React Hook ──────────────────────────────────────────────────
export function useDriverIncomingRideBeep(
  incomingRideId: string | null | undefined
) {
  const intervalRef = useRef<number | null>(null);

  const stopBeep = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
      console.log("[BeepHook] ⏹ stopped");
    }
  }, []);

  const startBeep = useCallback(() => {
    stopBeep();
    playBeepTone();
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
