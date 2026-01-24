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
 * Best-effort alert sound using WebAudio (no asset files).
 * Supports looping for persistent alerts that require user action to dismiss.
 */
export function useAlertSound(options: AlertSoundOptions = {}) {
  const volume = options.volume ?? 0.18;
  const loop = options.loop ?? false;
  const loopInterval = options.loopInterval ?? 2000;

  const ctxRef = useRef<AudioContext | null>(null);
  const unlockedRef = useRef(false);
  const loopingRef = useRef(false);
  const loopTimeoutRef = useRef<number | null>(null);

  const unlock = useCallback(async () => {
    if (unlockedRef.current) return;

    const AudioContextCtor = (window.AudioContext || (window as any).webkitAudioContext) as
      | (new () => AudioContext)
      | undefined;
    if (!AudioContextCtor) return;

    if (!ctxRef.current) ctxRef.current = new AudioContextCtor();

    try {
      if (ctxRef.current.state === "suspended") await ctxRef.current.resume();
      unlockedRef.current = ctxRef.current.state === "running";
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const handler = () => void unlock();
    window.addEventListener("pointerdown", handler, { passive: true });
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("pointerdown", handler);
      window.removeEventListener("keydown", handler);
    };
  }, [unlock]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (loopTimeoutRef.current) {
        clearTimeout(loopTimeoutRef.current);
      }
      loopingRef.current = false;
    };
  }, []);

  const playOnce = useCallback(async () => {
    await unlock();
    const ctx = ctxRef.current;
    if (!ctx || ctx.state !== "running") return false;

    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);

    const beep = (start: number, freq: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(1, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(gain);
      gain.connect(master);
      osc.start(start);
      osc.stop(start + duration + 0.02);
    };

    // Three attention-grabbing beeps (more urgent than two)
    beep(now + 0.0, 880, 0.18);
    beep(now + 0.26, 880, 0.18);
    beep(now + 0.52, 1100, 0.22); // Higher pitch final beep

    return true;
  }, [unlock, volume]);

  const play = useCallback(async () => {
    const result = await playOnce();
    
    if (loop && result) {
      loopingRef.current = true;
      
      const scheduleNext = () => {
        if (!loopingRef.current) return;
        loopTimeoutRef.current = window.setTimeout(async () => {
          if (loopingRef.current) {
            await playOnce();
            scheduleNext();
          }
        }, loopInterval);
      };
      
      scheduleNext();
    }
    
    return result;
  }, [playOnce, loop, loopInterval]);

  const stop = useCallback(() => {
    loopingRef.current = false;
    if (loopTimeoutRef.current) {
      clearTimeout(loopTimeoutRef.current);
      loopTimeoutRef.current = null;
    }
  }, []);

  const isLooping = useCallback(() => loopingRef.current, []);

  return { play, stop, unlock, isLooping };
}
