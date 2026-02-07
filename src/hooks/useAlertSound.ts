import { useCallback, useEffect, useRef } from "react";

type AlertSoundOptions = {
  volume?: number;
  loop?: boolean;
  loopInterval?: number;
};

// Tiny WAV beep as base64 — plays without user gesture on most browsers
const BEEP_WAV_URI = (() => {
  const sampleRate = 8000;
  const duration = 0.15;
  const numSamples = Math.floor(sampleRate * duration);
  const dataSize = numSamples;
  const fileSize = 44 + dataSize;
  const buf = new ArrayBuffer(fileSize);
  const view = new DataView(buf);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, fileSize - 8, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const sample = Math.sin(2 * Math.PI * 880 * t) * 0.8;
    view.setUint8(44 + i, Math.floor((sample + 1) * 127.5));
  }
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return "data:audio/wav;base64," + btoa(binary);
})();

/**
 * Bullet-proof alert sound hook.
 * All options are stored in refs so re-renders NEVER kill an active beep loop.
 * The returned play/stop functions have stable identity (no deps that change).
 */
export function useAlertSound(options: AlertSoundOptions = {}) {
  // Store ALL config in refs so re-renders don't affect anything
  const volumeRef = useRef(options.volume ?? 0.8);
  const loopRef = useRef(options.loop ?? false);
  const loopIntervalRef = useRef(options.loopInterval ?? 1500);

  // Update refs when options change (but don't trigger re-renders or recreate callbacks)
  volumeRef.current = options.volume ?? 0.8;
  loopRef.current = options.loop ?? false;
  loopIntervalRef.current = options.loopInterval ?? 1500;

  const ctxRef = useRef<AudioContext | null>(null);
  const unlockedRef = useRef(false);
  const activeRef = useRef(false); // true while beeping
  const intervalIdRef = useRef<number | null>(null);
  const fallbackAudioRef = useRef<HTMLAudioElement | null>(null);
  const mountedRef = useRef(true);

  // Create or get AudioContext — stable, no deps
  const getCtx = useCallback(() => {
    if (ctxRef.current) return ctxRef.current;
    const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as
      | (new () => AudioContext)
      | undefined;
    if (!Ctor) return null;
    ctxRef.current = new Ctor();
    return ctxRef.current;
  }, []);

  // Unlock AudioContext — stable
  const unlock = useCallback(async () => {
    const ctx = getCtx();
    if (!ctx) return false;
    try {
      if (ctx.state === "suspended") await ctx.resume();
      if (ctx.state === "running" && !unlockedRef.current) {
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
  }, [getCtx]);

  // Auto-unlock on user interaction
  useEffect(() => {
    mountedRef.current = true;
    const handler = () => void unlock();
    const events = ["pointerdown", "keydown", "touchstart", "click", "touchend"];
    events.forEach((e) => window.addEventListener(e, handler, { passive: true }));
    return () => {
      mountedRef.current = false;
      events.forEach((e) => window.removeEventListener(e, handler));
    };
  }, [unlock]);

  // Play HTML5 fallback beep — reads volume from ref
  const playFallbackBeep = useCallback(() => {
    try {
      if (!fallbackAudioRef.current) {
        fallbackAudioRef.current = new Audio(BEEP_WAV_URI);
      }
      const audio = fallbackAudioRef.current;
      audio.volume = Math.min(volumeRef.current, 1);
      audio.currentTime = 0;
      audio.play().catch(() => {
        console.warn("[AlertSound] Fallback audio blocked");
      });
    } catch {}
  }, []);

  // Play WebAudio beep — reads volume from ref
  const playWebAudio = useCallback(async () => {
    await unlock();
    const ctx = ctxRef.current;
    if (!ctx || ctx.state !== "running") return;

    const now = ctx.currentTime;
    const vol = volumeRef.current;
    const master = ctx.createGain();
    master.gain.value = vol;
    master.connect(ctx.destination);

    const playTone = (
      startTime: number,
      freq: number,
      dur: number,
      type: OscillatorType = "square"
    ) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.exponentialRampToValueAtTime(1, startTime + 0.02);
      gain.gain.setValueAtTime(1, startTime + dur - 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + dur);
      osc.connect(gain);
      gain.connect(master);
      osc.start(startTime);
      osc.stop(startTime + dur + 0.02);
    };

    playTone(now, 880, 0.15, "square");
    playTone(now + 0.18, 660, 0.15, "square");
    playTone(now + 0.36, 880, 0.15, "square");
    playTone(now + 0.54, 660, 0.15, "square");
    playTone(now + 0.72, 1100, 0.25, "sawtooth");
  }, [unlock]);

  // Play one beep (both channels)
  const playOnce = useCallback(() => {
    playFallbackBeep();
    try {
      void playWebAudio();
    } catch {}
  }, [playFallbackBeep, playWebAudio]);

  // Clear any running loop interval
  const clearLoop = useCallback(() => {
    if (intervalIdRef.current !== null) {
      clearInterval(intervalIdRef.current);
      intervalIdRef.current = null;
    }
  }, []);

  /** Stop beeping. Stable identity — safe to call anytime, multiple times. */
  const stop = useCallback(() => {
    activeRef.current = false;
    clearLoop();
    if (fallbackAudioRef.current) {
      try {
        fallbackAudioRef.current.pause();
      } catch {}
      fallbackAudioRef.current = null;
    }
  }, [clearLoop]);

  /** Start beeping. Stable identity — reads loop config from refs. */
  const play = useCallback(async () => {
    // Kill any previous beep first
    stop();

    activeRef.current = true;
    playOnce();

    if (loopRef.current) {
      intervalIdRef.current = window.setInterval(() => {
        if (!activeRef.current || !mountedRef.current) {
          clearLoop();
          return;
        }
        playOnce();
      }, loopIntervalRef.current);
    }

    return true;
  }, [stop, playOnce, clearLoop]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      activeRef.current = false;
      clearLoop();
      if (fallbackAudioRef.current) {
        try {
          fallbackAudioRef.current.pause();
        } catch {}
        fallbackAudioRef.current = null;
      }
    };
  }, [clearLoop]);

  const isLooping = useCallback(() => activeRef.current, []);

  return { play, stop, unlock, isLooping };
}
