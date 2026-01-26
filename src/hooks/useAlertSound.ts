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
  const volume = options.volume ?? 0.35;
  const loop = options.loop ?? false;
  const loopInterval = options.loopInterval ?? 2000;

  const ctxRef = useRef<AudioContext | null>(null);
  const unlockedRef = useRef(false);
  const loopingRef = useRef(false);
  const loopTimeoutRef = useRef<number | null>(null);

  const getOrCreateContext = useCallback(() => {
    if (ctxRef.current) return ctxRef.current;
    
    const AudioContextCtor = (window.AudioContext || (window as any).webkitAudioContext) as
      | (new () => AudioContext)
      | undefined;
    if (!AudioContextCtor) return null;
    
    ctxRef.current = new AudioContextCtor();
    console.log('[AlertSound] Created AudioContext, state:', ctxRef.current.state);
    return ctxRef.current;
  }, []);

  const unlock = useCallback(async () => {
    const ctx = getOrCreateContext();
    if (!ctx) {
      console.log('[AlertSound] No AudioContext available');
      return false;
    }

    try {
      if (ctx.state === "suspended") {
        console.log('[AlertSound] Resuming suspended AudioContext...');
        await ctx.resume();
      }
      
      // Play a silent sound to fully unlock on iOS
      if (!unlockedRef.current && ctx.state === "running") {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.value = 0.001; // Nearly silent
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.01);
      }
      
      unlockedRef.current = ctx.state === "running";
      console.log('[AlertSound] Unlock complete, state:', ctx.state, 'unlocked:', unlockedRef.current);
      return unlockedRef.current;
    } catch (err) {
      console.error('[AlertSound] Unlock error:', err);
      return false;
    }
  }, [getOrCreateContext]);

  // Auto-unlock on user interaction
  useEffect(() => {
    const handler = () => void unlock();
    window.addEventListener("pointerdown", handler, { passive: true });
    window.addEventListener("keydown", handler);
    window.addEventListener("touchstart", handler, { passive: true });
    window.addEventListener("click", handler, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", handler);
      window.removeEventListener("keydown", handler);
      window.removeEventListener("touchstart", handler);
      window.removeEventListener("click", handler);
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
    // Always try to unlock first
    await unlock();
    
    const ctx = ctxRef.current;
    if (!ctx) {
      console.log('[AlertSound] playOnce: No context');
      return false;
    }
    
    // Force resume if suspended
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch (e) {
        console.log('[AlertSound] Failed to resume:', e);
      }
    }
    
    if (ctx.state !== "running") {
      console.log('[AlertSound] playOnce: Context not running, state:', ctx.state);
      return false;
    }

    console.log('[AlertSound] Playing alert beeps...');
    
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
    console.log('[AlertSound] play() called, loop:', loop);
    const result = await playOnce();
    
    if (loop && result) {
      loopingRef.current = true;
      
      const scheduleNext = () => {
        if (!loopingRef.current) return;
        loopTimeoutRef.current = window.setTimeout(async () => {
          if (loopingRef.current) {
            console.log('[AlertSound] Playing loop iteration');
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
    console.log('[AlertSound] stop() called');
    loopingRef.current = false;
    if (loopTimeoutRef.current) {
      clearTimeout(loopTimeoutRef.current);
      loopTimeoutRef.current = null;
    }
  }, []);

  const isLooping = useCallback(() => loopingRef.current, []);

  return { play, stop, unlock, isLooping };
}
