/**
 * Conversation controller. Rules enforced here:
 *  - partials are display-only; only `finish()` produces a turn
 *  - drafts are cleared only after the service accepted them (errors and disconnects keep them)
 *  - a visual cue can only ever be sent as evidence; there is no code path from a cue to confirm/speak
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { SpeechCapture } from "@/api/contracts";
import { useServices } from "@/api/ServicesProvider";
import { ApiError, type Proposal } from "@/api/types";
import { useJourney } from "@/state/journey";
import { activeProposal, useSession } from "@/state/session";

export type Phase = "idle" | "starting" | "recording" | "committing" | "fusing" | "acting";

function asApiError(e: unknown): ApiError {
  return e instanceof ApiError ? e : new ApiError("internal_error", e instanceof Error ? e.message : "Something went wrong.");
}

export function useConversation() {
  const services = useServices();
  const { state, dispatch } = useSession();
  const { record } = useJourney();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<ApiError | null>(null);
  const [announce, setAnnounce] = useState("");
  const [cameraOn, setCameraOnState] = useState(() => services.mock?.cameraOn() ?? false);
  const capture = useRef<SpeechCapture | null>(null);
  const sid = state.session?.id ?? null;
  const language = state.session?.language ?? "en";
  const live = state.status === "active";

  useEffect(() => () => capture.current?.cancel(), []);

  const setCameraOn = useCallback(
    (on: boolean) => {
      services.mock?.setCameraOn(on);
      setCameraOnState(on);
      setAnnounce(on ? "Camera on. Cues can inform suggestions but never confirm them." : "Camera off.");
    },
    [services],
  );

  const run = useCallback(async <T,>(p: Phase, fn: () => Promise<T>): Promise<T | null> => {
    setPhase(p);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      const err = asApiError(e);
      setError(err);
      setAnnounce(err.message);
      return null;
    } finally {
      setPhase((cur) => (cur === p ? "idle" : cur));
    }
  }, []);

  const fuse = useCallback(async () => {
    if (!sid) return null;
    const proposal = await run("fusing", () => services.conversation.finishTurn(sid, { includeVisualCues: cameraOn }));
    if (proposal) {
      dispatch({ type: "proposal/added", proposal });
      setAnnounce(
        proposal.fusion.clarificationRequired
          ? "The assistant needs clarification. Nothing will be spoken."
          : `${proposal.fusion.candidateReplies.length} suggested replies are ready to review. Nothing has been spoken.`,
      );
    }
    return proposal;
  }, [sid, run, services, cameraOn, dispatch]);

  const startRecording = useCallback(async () => {
    if (!sid || !live) return;
    const c = await run("starting", () => services.conversation.startCapture(sid, state.speaker, language));
    if (!c) return;
    capture.current = c;
    setPhase("recording");
    setAnnounce(`Listening to the ${state.speaker}.`);
    c.onPartial((p) => dispatch({ type: "partial/set", partial: p }));
  }, [sid, live, run, services, state.speaker, language, dispatch]);

  const finishSpeaking = useCallback(async () => {
    const c = capture.current;
    if (!c) return;
    capture.current = null;
    const turn = await run("committing", () => c.finish());
    dispatch({ type: "partial/set", partial: null });
    if (!turn) {
      if (!error) setAnnounce("Nothing was heard. Try again or type instead.");
      return;
    }
    dispatch({ type: "turn/added", turn });
    setAnnounce(`${turn.speaker === "patient" ? "Patient" : "Partner"} turn saved.`);
    if (turn.speaker === "patient") await fuse();
  }, [run, dispatch, fuse, error]);

  const cancelRecording = useCallback(() => {
    capture.current?.cancel();
    capture.current = null;
    dispatch({ type: "partial/set", partial: null });
    setPhase("idle");
    setAnnounce("Recording cancelled. Nothing was saved.");
  }, [dispatch]);

  const submitTyped = useCallback(async () => {
    if (!sid || !live) return;
    const text = state.drafts.typed;
    const turn = await run("committing", () => services.conversation.addTypedTurn(sid, state.speaker, text, language));
    if (!turn) return; // draft kept
    dispatch({ type: "turn/added", turn });
    dispatch({ type: "draft/typed", text: "" });
    setAnnounce(`${turn.speaker === "patient" ? "Patient" : "Partner"} message added.`);
    if (turn.speaker === "patient") await fuse();
  }, [sid, live, state.drafts.typed, state.speaker, language, run, services, dispatch, fuse]);

  const decide = useCallback(
    async (kind: "confirm" | "edit" | "reject" | "clarify", proposal: Proposal, arg?: number | string) => {
      if (!sid) return null;
      const res = await run("acting", () => {
        switch (kind) {
          case "confirm":
            return services.conversation.confirm(sid, proposal.id, arg as number);
          case "edit":
            return services.conversation.edit(sid, proposal.id, arg as string);
          case "reject":
            return services.conversation.reject(sid, proposal.id);
          case "clarify":
            return services.conversation.clarify(sid, proposal.id);
        }
      });
      if (!res) return null;
      dispatch({ type: "proposal/updated", proposal: { ...res.proposal, evidence: proposal.evidence, clarificationMessage: proposal.clarificationMessage, stageMs: proposal.stageMs } });
      dispatch({ type: "decision/counted" });
      if (res.confirmed) {
        dispatch({ type: "confirmed/added", message: res.confirmed });
        record(kind === "edit" ? "confirmed-edit" : "confirmed-suggestion");
        if (kind === "edit") dispatch({ type: "draft/edit", text: "" });
        setAnnounce(`Confirmed: “${res.confirmed.text}”. It will only be spoken when you press Play.`);
      } else {
        setAnnounce(kind === "reject" ? "Suggestions rejected. Nothing was spoken." : "Clarification requested. Nothing was spoken.");
      }
      return res;
    },
    [sid, run, services, dispatch, record],
  );

  return {
    state,
    dispatch,
    phase,
    error,
    clearError: () => setError(null),
    announce,
    setAnnounce,
    live,
    cameraOn,
    setCameraOn,
    proposal: activeProposal(state),
    startRecording,
    finishSpeaking,
    cancelRecording,
    submitTyped,
    fuse,
    decide,
  };
}
