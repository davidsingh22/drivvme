import { useCallback, useEffect, useRef } from "react";

type AlertSoundOptions = {
  /** Overall volume 0..1 */
  volume?: number;
};

/**
 * Best-effort short alert sound using WebAudio (no asset files).
 * Note: browsers may block audio until the user interacts with the page.
 */
export function useAlertSound(options: AlertSoundOptions = {}) {
  const volume = options.volume ?? 0.18;

  const ctxRef = useRef<AudioContext | null>(null);
  const unlockedRef = useRef(false);

  const unlock = useCallback(async () => {
    if (unlockedRef.current) return;

    const AudioContextCtor = (window.AudioContext || (window as any).webkitAudioContext) as
      | (new () => AudioContext)
      | undefined;
    if (!AudioContextCtor) return;

    if (!ctxRef.current) ctxRef.current = new AudioContextCtor();

    try {
      // Some browsers start in 'suspended' until user gesture.
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

  const play = useCallback(async () => {
    await unlock();
    const ctx = ctxRef.current;
    if (!ctx || ctx.state !== "running") return false;

    // Two quick beeps (professional but noticeable)
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

    beep(now + 0.0, 880, 0.18);
    beep(now + 0.26, 880, 0.18);
    return true;
  }, [unlock, volume]);

  return { play, unlock };
}
