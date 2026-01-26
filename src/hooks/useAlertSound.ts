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
 */
export function useAlertSound(options: AlertSoundOptions = {}) {
  const volume = options.volume ?? 0.8; // Default to LOUD
  const loop = options.loop ?? false;
  const loopInterval = options.loopInterval ?? 1500; // Faster loops

  const ctxRef = useRef<AudioContext | null>(null);
  const unlockedRef = useRef(false);
  const loopingRef = useRef(false);
  const loopTimeoutRef = useRef<number | null>(null);

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
    console.log('[AlertSound] Created AudioContext, state:', ctxRef.current.state);
    return ctxRef.current;
  }, []);

  const unlock = useCallback(async () => {
    const ctx = getOrCreateContext();
    if (!ctx) return false;

    try {
      if (ctx.state === "suspended") {
        console.log('[AlertSound] Resuming suspended AudioContext...');
        await ctx.resume();
      }
      
      // Play a silent sound to fully unlock on iOS
      if (!unlockedRef.current && ctx.state === "running") {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.value = 0.001;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.01);
        console.log('[AlertSound] Played silent unlock tone');
      }
      
      unlockedRef.current = ctx.state === "running";
      console.log('[AlertSound] Unlock result:', unlockedRef.current);
      return unlockedRef.current;
    } catch (err) {
      console.error('[AlertSound] Unlock error:', err);
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
    // Always try to unlock/resume first
    await unlock();
    
    const ctx = ctxRef.current;
    if (!ctx) {
      console.warn('[AlertSound] No AudioContext available');
      return false;
    }
    
    // Force resume if suspended
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
        console.log('[AlertSound] Resumed context before playing');
      } catch (e) {
        console.warn('[AlertSound] Could not resume:', e);
      }
    }
    
    if (ctx.state !== "running") {
      console.warn('[AlertSound] Context not running:', ctx.state);
      return false;
    }

    console.log('[AlertSound] 🔊 Playing LOUD alert!');
    
    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);

    // Create a more attention-grabbing alarm sound
    const playTone = (startTime: number, freq: number, duration: number, type: OscillatorType = "square") => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      
      // Sharp attack, sustain, quick release
      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.exponentialRampToValueAtTime(1, startTime + 0.02);
      gain.gain.setValueAtTime(1, startTime + duration - 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
      
      osc.connect(gain);
      gain.connect(master);
      osc.start(startTime);
      osc.stop(startTime + duration + 0.02);
    };

    // LOUD alarm pattern - alternating high/low tones like a siren
    playTone(now + 0.0, 880, 0.15, "square");   // High
    playTone(now + 0.18, 660, 0.15, "square");  // Low
    playTone(now + 0.36, 880, 0.15, "square");  // High
    playTone(now + 0.54, 660, 0.15, "square");  // Low
    playTone(now + 0.72, 1100, 0.25, "sawtooth"); // Final high alert

    return true;
  }, [unlock, volume]);

  const play = useCallback(async () => {
    console.log('[AlertSound] play() called, loop:', loop);
    
    // Stop any existing loop first
    loopingRef.current = false;
    if (loopTimeoutRef.current) {
      clearTimeout(loopTimeoutRef.current);
      loopTimeoutRef.current = null;
    }
    
    const result = await playOnce();
    
    if (loop) {
      loopingRef.current = true;
      
      const scheduleNext = () => {
        if (!loopingRef.current) return;
        loopTimeoutRef.current = window.setTimeout(async () => {
          if (loopingRef.current) {
            console.log('[AlertSound] 🔁 Loop iteration');
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
    console.log('[AlertSound] ⏹️ Stopping sound');
    loopingRef.current = false;
    if (loopTimeoutRef.current) {
      clearTimeout(loopTimeoutRef.current);
      loopTimeoutRef.current = null;
    }
  }, []);

  const isLooping = useCallback(() => loopingRef.current, []);

  return { play, stop, unlock, isLooping };
}
