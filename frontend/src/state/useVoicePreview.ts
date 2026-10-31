import { useCallback, useEffect, useRef, useState } from "react";
import { useServices } from "@/api/ServicesProvider";
import { ApiError, type SessionVoice } from "@/api/types";
import { play, playbackMode, type PlaybackHandle, type PlaybackSettings } from "@/lib/player";
import { useJourney } from "./journey";
import { usePreferences } from "./preferences";
import { useSession } from "./session";

export type PreviewSource = "service" | "device" | "simulated";

/**
 * Voice previews. A preview is sample text chosen on the Voice screen — it is never a message,
 * and it never enters the conversation. When the service cannot preview (the HTTP backend only
 * speaks confirmed messages), the device's built-in voice is used and labelled as such.
 */
export function useVoicePreview() {
  const services = useServices();
  const { state } = useSession();
  const { prefs } = usePreferences();
  const { record } = useJourney();
  const handle = useRef<PlaybackHandle | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [source, setSource] = useState<PreviewSource | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => handle.current?.stop(), []);

  const stop = useCallback(() => {
    handle.current?.stop();
    handle.current = null;
    setPlaying(null);
  }, []);

  const preview = useCallback(
    async (key: string, text: string, voice: SessionVoice | null, settings: PlaybackSettings = prefs.voice) => {
      stop();
      setError(null);
      setLoading(key);
      const lang = state.session?.language && state.session.language !== "en" ? "hi-IN" : prefs.defaultLanguage === "en" ? "en-GB" : "hi-IN";
      let audioUrl: string | null = null;
      let subtitle = text;
      let src: PreviewSource;
      try {
        const res = await services.voices.preview(text, voice);
        audioUrl = res.audioUrl;
        subtitle = res.subtitle;
        src = audioUrl ? "service" : services.mode === "mock" ? "simulated" : "device";
      } catch (e) {
        if (!(e instanceof ApiError) || e.code !== "not_configured") {
          setLoading(null);
          setError(e instanceof ApiError ? e.message : "The preview could not be played.");
          return;
        }
        if (services.mode !== "mock" && playbackMode(null) !== "browser_voice") {
          setLoading(null);
          setError("No voice preview is available on this device. Your text is still available to read.");
          return;
        }
        src = playbackMode(null) === "browser_voice" ? "device" : "simulated";
      }
      setLoading(null);
      setSource(src);
      record("voice-tried");
      const h = play(subtitle, audioUrl, lang, settings);
      handle.current = h;
      setPlaying(key);
      await h.done;
      if (handle.current === h) {
        handle.current = null;
        setPlaying(null);
      }
    },
    [services, state.session, prefs.voice, prefs.defaultLanguage, record, stop],
  );

  return { preview, stop, playing, loading, source, error };
}

export const PREVIEW_SOURCE_TEXT: Record<PreviewSource, string> = {
  service: "Played by the voice service",
  device: "Played with this device’s built-in voice — the service only speaks confirmed messages",
  simulated: "Simulated preview (browser voice)",
};
