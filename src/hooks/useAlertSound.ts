import { useCallback, useEffect, useRef } from "react";

type AlertSoundOptions = {
  /** Overall volume 0..1 */
  volume?: number;
  /** Loop the sound until stop() is called */
  loop?: boolean;
  /** Interval between loops in ms (default: 2000) */
  loopInterval?: number;
};

// Tiny WAV beep as base64 data-URI — guaranteed to play without user gesture on most browsers
const BEEP_WAV_URI = (() => {
  // Generate a simple 440Hz beep WAV (0.15s, 8kHz mono 8-bit)
  const sampleRate = 8000;
  const duration = 0.15;
  const numSamples = Math.floor(sampleRate * duration);
  const dataSize = numSamples;
  const fileSize = 44 + dataSize;
  const buf = new ArrayBuffer(fileSize);
  const view = new DataView(buf);
  const writeStr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, fileSize - 8, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true); // 8-bit
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const sample = Math.sin(2 * Math.PI * 880 * t) * 0.8; // 880Hz
    view.setUint8(44 + i, Math.floor((sample + 1) * 127.5));
  }
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return 'data:audio/wav;base64,' + btoa(binary);
})();

/**
 * LOUD alert sound using WebAudio (no asset files).
 * Falls back to HTML5 Audio with inline WAV when WebAudio is blocked (no user gesture).
 * Supports looping for persistent alerts that require user action to dismiss.
 */
export function useAlertSound(options: AlertSoundOptions = {}) {
  const volume = options.volume ?? 0.8;
  const loop = options.loop ?? false;
  const loopInterval = options.loopInterval ?? 1500;

  const ctxRef = useRef<AudioContext | null>(null);
  const unlockedRef = useRef(false);
  const loopingRef = useRef(false);
  const loopIntervalIdRef = useRef<number | null>(null);
  // HTML5 Audio fallback pool for when WebAudio is blocked
  const fallbackAudioRef = useRef<HTMLAudioElement | null>(null);

  const getOrCreateContext = useCallback(() => {
    if (ctxRef.current) return ctxRef.current;
    const AudioContextCtor = (window.AudioContext || (window as any).webkitAudioContext) as
      | (new () => AudioContext)
      | undefined;
    if (!AudioContextCtor) return null;
    ctxRef.current = new AudioContextCtor();
    return ctxRef.current;
  }, []);

  const unlock = useCallback(async () => {
    const ctx = getOrCreateContext();
    if (!ctx) return false;
    try {
      if (ctx.state === "suspended") await ctx.resume();
      if (ctx.state === "running") {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.value = 0.001;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.01);
        unlockedRef.current = true;
      }
      return unlockedRef.current;
    } catch {
      return false;
    }
  }, [getOrCreateContext]);

  // Auto-unlock on ANY user interaction
  useEffect(() => {
    const handler = () => void unlock();
    const events = ["pointerdown", "keydown", "touchstart", "click", "touchend"];
    events.forEach(e => window.addEventListener(e, handler, { passive: true }));
    return () => {
      events.forEach(e => window.removeEventListener(e, handler));
    };
  }, [unlock]);

  // Hard cleanup on unmount
  useEffect(() => {
    return () => {
      loopingRef.current = false;
      if (loopIntervalIdRef.current) {
        clearInterval(loopIntervalIdRef.current);
        loopIntervalIdRef.current = null;
      }
      if (fallbackAudioRef.current) {
        try { fallbackAudioRef.current.pause(); } catch {}
        fallbackAudioRef.current = null;
      }
    };
  }, []);

  /** Play using HTML5 Audio fallback (works without user gesture on many mobile browsers) */
  const playFallbackBeep = useCallback(() => {
    try {
      const audio = new Audio(BEEP_WAV_URI);
      audio.volume = Math.min(volume, 1);
      fallbackAudioRef.current = audio;
      audio.play().catch(() => {
        // Even fallback blocked — nothing more we can do
        console.warn('[AlertSound] Fallback audio also blocked');
      });
      return true;
    } catch {
      return false;
    }
  }, [volume]);

  const playWebAudio = useCallback(async () => {
    await unlock();
    const ctx = ctxRef.current;
    if (!ctx || ctx.state !== "running") return false;

    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);

    const playTone = (startTime: number, freq: number, duration: number, type: OscillatorType = "square") => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.exponentialRampToValueAtTime(1, startTime + 0.02);
      gain.gain.setValueAtTime(1, startTime + duration - 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
      osc.connect(gain);
      gain.connect(master);
      osc.start(startTime);
      osc.stop(startTime + duration + 0.02);
    };

    playTone(now + 0.0, 880, 0.15, "square");
    playTone(now + 0.18, 660, 0.15, "square");
    playTone(now + 0.36, 880, 0.15, "square");
    playTone(now + 0.54, 660, 0.15, "square");
    playTone(now + 0.72, 1100, 0.25, "sawtooth");

    return true;
  }, [unlock, volume]);

  /** Play once — tries WebAudio first, falls back to HTML5 Audio */
  const playOnce = useCallback(async () => {
    const webAudioOk = await playWebAudio();
    if (!webAudioOk) {
      // WebAudio blocked (no user gesture) — use HTML5 Audio fallback
      playFallbackBeep();
    }
    return true;
  }, [playWebAudio, playFallbackBeep]);

  /** Start beeping. Kills any existing beep first. */
  const play = useCallback(async () => {
    loopingRef.current = false;
    if (loopIntervalIdRef.current) {
      clearInterval(loopIntervalIdRef.current);
      loopIntervalIdRef.current = null;
    }

    await playOnce();

    if (loop) {
      loopingRef.current = true;
      loopIntervalIdRef.current = window.setInterval(() => {
        if (!loopingRef.current) {
          if (loopIntervalIdRef.current) {
            clearInterval(loopIntervalIdRef.current);
            loopIntervalIdRef.current = null;
          }
          return;
        }
        void playOnce();
      }, loopInterval);
    }

    return true;
  }, [playOnce, loop, loopInterval]);

  /** Stop beeping immediately. Safe to call multiple times. */
  const stop = useCallback(() => {
    loopingRef.current = false;
    if (loopIntervalIdRef.current) {
      clearInterval(loopIntervalIdRef.current);
      loopIntervalIdRef.current = null;
    }
    // Also kill any fallback audio
    if (fallbackAudioRef.current) {
      try { fallbackAudioRef.current.pause(); } catch {}
      fallbackAudioRef.current = null;
    }
  }, []);

  const isLooping = useCallback(() => loopingRef.current, []);

  return { play, stop, unlock, isLooping };
}
