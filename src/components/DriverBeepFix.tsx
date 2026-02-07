import { useEffect, useRef } from "react";

type IncomingRide = { id: string } | null;

// Generate a short beep WAV as a data URI (no external file needed)
function generateBeepWav(): string {
  const sampleRate = 8000;
  const duration = 0.2;
  const frequency = 880;
  const numSamples = Math.floor(sampleRate * duration);
  const buffer = new ArrayBuffer(44 + numSamples);
  const view = new DataView(buffer);
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + numSamples, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  writeString(36, "data");
  view.setUint32(40, numSamples, true);
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const sample = Math.sin(2 * Math.PI * frequency * t) >= 0 ? 200 : 56;
    view.setUint8(44 + i, sample);
  }
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return "data:audio/wav;base64," + btoa(binary);
}

// Prime audio on user gestures so mobile browsers allow background playback
let _beepDataUri: string | null = null;
function getBeepUri() {
  if (!_beepDataUri) _beepDataUri = generateBeepWav();
  return _beepDataUri;
}

// Global priming: keep a singleton audio element "warm" via user gestures
let _primedAudio: HTMLAudioElement | null = null;
function getPrimedAudio(): HTMLAudioElement {
  if (!_primedAudio) {
    _primedAudio = new Audio(getBeepUri());
    _primedAudio.volume = 0.7;
    (_primedAudio as any).playsInline = true;
    _primedAudio.setAttribute("playsinline", "");
  }
  return _primedAudio;
}

function primeOnGesture() {
  const audio = getPrimedAudio();
  try {
    audio.volume = 0.01;
    audio.currentTime = 0;
    const p = audio.play();
    if (p) p.then(() => { audio.pause(); audio.volume = 0.7; audio.currentTime = 0; }).catch(() => {});
  } catch {}
}

if (typeof document !== "undefined") {
  document.addEventListener("touchstart", primeOnGesture, { capture: true, passive: true });
  document.addEventListener("pointerdown", primeOnGesture, { capture: true, passive: true });
  document.addEventListener("click", primeOnGesture, { capture: true, passive: true });
}

export default function DriverBeepFix({
  incomingRide,
  onTimeout,
  timeoutSeconds = 25,
}: {
  incomingRide: IncomingRide;
  onTimeout: () => void;
  timeoutSeconds?: number;
}) {
  const intervalRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);

  const stopBeep = () => {
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    console.log("[DriverBeepFix] ⏹ stopped");
  };

  const playOnce = () => {
    const audio = getPrimedAudio();
    try {
      audio.currentTime = 0;
      const p = audio.play();
      if (p) p.catch(() => {});
      console.log("[DriverBeepFix] 🔊 beep");
    } catch {}
  };

  const startBeep = () => {
    stopBeep();
    console.log("[DriverBeepFix] ▶ starting beep loop");

    // Immediate first beep
    playOnce();

    // Repeat every 1.2s
    intervalRef.current = window.setInterval(() => {
      playOnce();
    }, 1200);

    // Auto-timeout
    timeoutRef.current = window.setTimeout(() => {
      stopBeep();
      onTimeout();
    }, timeoutSeconds * 1000);
  };

  useEffect(() => {
    if (incomingRide?.id) {
      startBeep();
    } else {
      stopBeep();
    }
    return () => stopBeep();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingRide?.id]);

  return null;
}
