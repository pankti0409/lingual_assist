import { useCallback, useEffect, useRef, useState } from "react";
import { useServices } from "@/api/ServicesProvider";
import { ApiError, type ConfirmedMessage } from "@/api/types";
import { play as startPlayback, type PlaybackHandle } from "@/lib/player";
import { usePreferences } from "./preferences";
import { isSpeakable, useSession, type PlaybackStatus } from "./session";

export const PLAYBACK_TEXT: Record<PlaybackStatus, string> = {
  idle: "Not played yet",
  loading: "Preparing audio…",
  playing: "Playing now",
  stopped: "Stopped",
  played: "Played",
  text_only: "Shown as text",
  error: "Playback failed",
};

/**
 * Playback for one confirmed message. Speech is only ever requested for an id that is in
 * `confirmed`; the words played are the ones the service returns for that id.
 */
export function usePlayback(message: ConfirmedMessage | null) {
  const services = useServices();
  const { state, dispatch } = useSession();
  const { prefs } = usePreferences();
  const handle = useRef<PlaybackHandle | null>(null);
  const [subtitle, setSubtitle] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = message?.id ?? null;
  const status: PlaybackStatus = (id && state.playback[id]) || "idle";
  const speakable = isSpeakable(state, id);

  useEffect(() => () => handle.current?.stop(), []);

  const play = useCallback(async () => {
    if (!id || !state.session || !isSpeakable(state, id)) return; // only a confirmed id can ever be spoken
    setError(null);
    dispatch({ type: "playback/set", confirmedId: id, status: "loading" });
    try {
      const res = await services.conversation.speak(state.session.id, id);
      setSubtitle(res.subtitle);
      handle.current?.stop();
      const h = startPlayback(res.subtitle, res.audioUrl, state.session.language === "en" ? "en-GB" : "hi-IN", prefs.voice);
      handle.current = h;
      dispatch({ type: "playback/set", confirmedId: id, status: "playing" });
      await h.done;
      if (handle.current === h) dispatch({ type: "playback/set", confirmedId: id, status: "played" });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Playback failed.");
      dispatch({ type: "playback/set", confirmedId: id, status: "error" });
    }
  }, [id, state, services, dispatch, prefs.voice]);

  const stop = useCallback(() => {
    const h = handle.current;
    handle.current = null;
    h?.stop();
    if (id) dispatch({ type: "playback/set", confirmedId: id, status: "stopped" });
  }, [id, dispatch]);

  return { status, subtitle, error, speakable, play, stop, statusText: PLAYBACK_TEXT[status] };
}
