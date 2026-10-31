/**
 * Plays a confirmed message. Callers must only pass text that came back from `speak()` for a
 * confirmed id (or a voice preview); this module never decides what to say.
 *  - real audio URL (HTTP adapter) -> <audio>
 *  - no URL (mock mode) -> the browser's built-in speech voice when available, otherwise a timed
 *    simulation. Both are labelled "simulated" in the UI.
 *
 * Playback settings are applied on this device only: speed and volume work for every mode; pitch
 * can only be changed for the browser's built-in voice (provider audio keeps its own pitch).
 */
export interface PlaybackHandle {
  stop(): void;
  done: Promise<void>;
}

export type PlayMode = "audio" | "browser_voice" | "simulated";

export interface PlaybackSettings {
  rate: number;
  pitch: number;
  volume: number;
}

export const DEFAULT_PLAYBACK: PlaybackSettings = { rate: 1, pitch: 1, volume: 1 };

export function playbackMode(audioUrl: string | null): PlayMode {
  if (audioUrl) return "audio";
  if (typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined") return "browser_voice";
  return "simulated";
}

/** Whether pitch can be changed for audio that will be played in this mode. */
export function pitchSupported(mode: PlayMode): boolean {
  return mode === "browser_voice";
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function play(text: string, audioUrl: string | null, lang: string, settings: PlaybackSettings = DEFAULT_PLAYBACK): PlaybackHandle {
  const mode = playbackMode(audioUrl);
  const rate = clamp(settings.rate, 0.5, 2);
  const volume = clamp(settings.volume, 0, 1);
  if (mode === "audio") {
    const audio = new Audio(audioUrl!);
    audio.playbackRate = rate;
    audio.volume = volume;
    const done = new Promise<void>((resolve) => {
      audio.onended = () => resolve();
      audio.onerror = () => resolve();
    });
    void audio.play().catch(() => undefined);
    return { stop: () => audio.pause(), done };
  }
  if (mode === "browser_voice") {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = rate;
    u.pitch = clamp(settings.pitch, 0, 2);
    u.volume = volume;
    const done = new Promise<void>((resolve) => {
      u.onend = () => resolve();
      u.onerror = () => resolve();
    });
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    return { stop: () => window.speechSynthesis.cancel(), done };
  }
  let timer: ReturnType<typeof setTimeout>;
  let finish: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
    timer = setTimeout(resolve, Math.min(6000, (600 + text.length * 55) / rate));
  });
  return {
    stop: () => {
      clearTimeout(timer);
      finish();
    },
    done,
  };
}
