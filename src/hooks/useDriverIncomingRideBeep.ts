import { useEffect, useRef, useCallback } from "react";

/**
 * DRIVER INCOMING RIDE BEEP – HTML Audio Element approach
 *
 * Why HTML <audio> instead of Web Audio API?
 * On iOS, AudioContext.resume() called from a non-gesture context
 * (like a Supabase realtime callback) silently fails.
 * An HTML Audio element, once "primed" during a user gesture,
 * can be .play()'d again from non-gesture contexts reliably.
 *
 * Strategy:
 * 1. Create a singleton <audio> element with a short WAV beep (data URI)
 * 2. On EVERY user gesture, call .play() then immediately .pause()
 *    to keep it "warm" / primed for iOS
 * 3. When a ride offer arrives (from realtime), call .play() on the
 *    already-primed element — this works even without a gesture
 */

// ── Inline short beep WAV ──────────────────────────────────────
// 200ms 880Hz square wave, 8000Hz sample rate, 8-bit mono
function generateBeepWav(): string {
  const sampleRate = 8000;
  const duration = 0.2;
  const frequency = 880;
  const numSamples = Math.floor(sampleRate * duration);

  // WAV header + data
  const buffer = new ArrayBuffer(44 + numSamples);
  const view = new DataView(buffer);

  // RIFF header
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + numSamples, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true); // byte rate
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, numSamples, true);

  // Generate square wave samples (8-bit unsigned, 128 = silence)
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const sample = Math.sin(2 * Math.PI * frequency * t) >= 0 ? 200 : 56;
    view.setUint8(44 + i, sample);
  }

  // Convert to base64 data URI
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return "data:audio/wav;base64," + btoa(binary);
}

// ── Singleton audio element ────────────────────────────────────
let _audio: HTMLAudioElement | null = null;
let _primed = false;

function getAudio(): HTMLAudioElement {
  if (!_audio) {
    _audio = new Audio(generateBeepWav());
    _audio.volume = 0.7;
    // Needed for iOS
    (_audio as any).playsInline = true;
    (_audio as any).setAttribute?.("playsinline", "");
    console.log("[BeepHook] Audio element created");
  }
  return _audio;
}

function playBeep() {
  const audio = getAudio();
  try {
    audio.currentTime = 0;
    const p = audio.play();
    if (p) p.catch(() => {});
    console.log("[BeepHook] 🔊 play() called");
  } catch (_e) {
    console.warn("[BeepHook] play() failed", _e);
  }
}

// ── Prime on EVERY user gesture ────────────────────────────────
// This keeps the audio element "warm" so play() works from
// non-gesture contexts (realtime callbacks)
function onGesture() {
  const audio = getAudio();
  try {
    if (!_primed) {
      // First gesture: play then immediately pause to unlock
      audio.volume = 0.01; // near-silent
      audio.currentTime = 0;
      const p = audio.play();
      if (p) {
        p.then(() => {
          audio.pause();
          audio.volume = 0.7;
          audio.currentTime = 0;
          _primed = true;
          console.log("[BeepHook] ✅ Audio primed via gesture");
        }).catch(() => {});
      }
    } else {
      // Subsequent gestures: just ensure it's still playable
      // (iOS can un-prime after backgrounding)
      audio.volume = 0.01;
      audio.currentTime = 0;
      const p = audio.play();
      if (p) {
        p.then(() => {
          audio.pause();
          audio.volume = 0.7;
          audio.currentTime = 0;
        }).catch(() => {});
      }
    }
  } catch (_e) { /* ignore */ }
}

// Register globally (capture phase, passive)
if (typeof document !== "undefined") {
  document.addEventListener("pointerdown", onGesture, { capture: true, passive: true });
  document.addEventListener("touchstart", onGesture, { capture: true, passive: true });
  document.addEventListener("click", onGesture, { capture: true, passive: true });
}

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
    // Immediate first beep
    playBeep();
    // Repeat every 1.2s
    intervalRef.current = window.setInterval(() => {
      playBeep();
    }, 1200);
    console.log("[BeepHook] ▶ loop started");
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
