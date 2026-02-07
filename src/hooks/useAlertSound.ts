import { useCallback, useEffect, useRef } from "react";

type AlertSoundOptions = {
  /** Overall volume 0..1 */
  volume?: number;
  /** Loop the sound until stop() is called */
  loop?: boolean;
  /** Interval between loops in ms (default: 2000) */
  loopInterval?: number;
};

/**
 * LOUD alert sound using WebAudio (no asset files).
 * Designed to be attention-grabbing for driver notifications.
 * Supports looping for persistent alerts that require user action to dismiss.
 *
 * startBeep() / stopBeep() guarantee exactly one interval at a time.
 */
export function useAlertSound(options: AlertSoundOptions = {}) {
  const volume = options.volume ?? 0.8;
  const loop = options.loop ?? false;
  const loopInterval = options.loopInterval ?? 1500;

  const ctxRef = useRef<AudioContext | null>(null);
  const unlockedRef = useRef(false);
  const loopingRef = useRef(false);
  const loopIntervalIdRef = useRef<number | null>(null);

  const getOrCreateContext = useCallback(() => {
    if (ctxRef.current) return ctxRef.current;

    const AudioContextCtor = (window.AudioContext || (window as any).webkitAudioContext) as
      | (new () => AudioContext)
      | undefined;
    if (!AudioContextCtor) {
      console.warn('[AlertSound] WebAudio not supported');
      return null;
    }

    ctxRef.current = new AudioContextCtor();
    return ctxRef.current;
  }, []);

  const unlock = useCallback(async () => {
    const ctx = getOrCreateContext();
    if (!ctx) return false;

    try {
      // Always attempt resume — iOS may suspend at any time
      if (ctx.state === "suspended") {
        await ctx.resume();
      }

      // Play a silent tone to fully unlock the audio pipeline on iOS
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

  // Hard cleanup on unmount — kill any running interval
  useEffect(() => {
    return () => {
      loopingRef.current = false;
      if (loopIntervalIdRef.current) {
        clearInterval(loopIntervalIdRef.current);
        loopIntervalIdRef.current = null;
      }
    };
  }, []);

  const playOnce = useCallback(async () => {
    // Always try to unlock + resume before playing
    await unlock();

    const ctx = ctxRef.current;
    if (!ctx) return false;

    // Aggressive resume: try multiple times on iOS
    if (ctx.state === "suspended") {
      try { await ctx.resume(); } catch { /* */ }
    }
    if (ctx.state === "suspended") {
      // Second attempt after a micro-delay
      await new Promise(r => setTimeout(r, 50));
      try { await ctx.resume(); } catch { /* */ }
    }
    if (ctx.state !== "running") return false;

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

  /** Start beeping. Kills any existing beep first. */
  const play = useCallback(async () => {
    // Always kill existing loop first
    loopingRef.current = false;
    if (loopIntervalIdRef.current) {
      clearInterval(loopIntervalIdRef.current);
      loopIntervalIdRef.current = null;
    }

    const result = await playOnce();

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

    return result;
  }, [playOnce, loop, loopInterval]);

  /** Stop beeping immediately. Safe to call multiple times. */
  const stop = useCallback(() => {
    loopingRef.current = false;
    if (loopIntervalIdRef.current) {
      clearInterval(loopIntervalIdRef.current);
      loopIntervalIdRef.current = null;
    }
  }, []);

  const isLooping = useCallback(() => loopingRef.current, []);

  return { play, stop, unlock, isLooping };
}
