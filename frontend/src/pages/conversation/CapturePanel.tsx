import { Camera, CameraOff, Mic, SendHorizontal, Square, X } from "lucide-react";
import { motion } from "motion/react";
import { forwardRef } from "react";
import { useServices } from "@/api/ServicesProvider";
import type { Speaker } from "@/api/types";
import { Button } from "@/components/Button";
import { TextArea } from "@/components/Field";
import { SimulatedTag } from "@/components/Status";
import { useCalm } from "@/lib/motion";
import type { useConversation } from "./useConversation";

type Ctl = ReturnType<typeof useConversation>;

/** The composer: who is speaking, record or type, and the camera switch. */
export const CapturePanel = forwardRef<HTMLTextAreaElement, { ctl: Ctl }>(function CapturePanel({ ctl }, typedRef) {
  const services = useServices();
  const calm = useCalm();
  const { state, dispatch, phase, live, cameraOn, setCameraOn } = ctl;
  const consent = state.session?.consent;
  const recording = phase === "recording";
  const canRecord = live && !!consent?.audio_recording && !state.typedOnly;
  const canCamera = live && !!consent?.face_capture && !state.typedOnly;
  const speakerName = state.speaker === "patient" ? "patient" : "partner";
  const busy = phase === "committing" || phase === "fusing" || phase === "starting";

  return (
    <section className={`composer composer--${state.speaker}`} aria-labelledby="capture-h">
      <div className="composer__head">
        <h2 id="capture-h" className="composer__title">Add to the conversation</h2>
        {services.mode === "mock" && canRecord && <SimulatedTag>Simulated microphone · scripted speech</SimulatedTag>}
      </div>

      <fieldset className="speaker-switch" aria-describedby="speaker-hint">
        <legend className="field__label">Who is taking this turn?</legend>
        <div className="speaker-switch__row">
          {(["patient", "partner"] as Speaker[]).map((s) => (
            <label key={s} className={`speaker-opt speaker-opt--${s}${state.speaker === s ? " is-selected" : ""}`}>
              <input type="radio" name="speaker" value={s} checked={state.speaker === s} onChange={() => dispatch({ type: "speaker/set", speaker: s })} />
              <span className={`avatar avatar--${s}`} aria-hidden>{s === "patient" ? "Pt" : "Pa"}</span>
              <span>{s === "patient" ? "Patient" : "Partner"}</span>
            </label>
          ))}
        </div>
        <p id="speaker-hint" className="field__hint">The speaker is always chosen here — it is never guessed.</p>
      </fieldset>

      <div className="composer__controls">
        {!recording ? (
          <Button size="lg" icon={<Mic size={22} />} onClick={() => void ctl.startRecording()} disabled={!canRecord || busy} loading={phase === "starting"}>
            Record the {speakerName}
          </Button>
        ) : (
          <>
            <motion.span className="rec-pulse" aria-hidden animate={calm ? undefined : { scale: [1, 1.25, 1], opacity: [0.9, 0.4, 0.9] }} transition={{ duration: 1.6, repeat: Infinity }} />
            <Button size="lg" variant="confirm" icon={<Square size={20} />} onClick={() => void ctl.finishSpeaking()}>
              Finish speaking
            </Button>
            <Button variant="secondary" icon={<X size={20} />} onClick={ctl.cancelRecording}>Cancel</Button>
          </>
        )}
        <Button
          variant="secondary"
          icon={cameraOn ? <CameraOff size={20} /> : <Camera size={20} />}
          aria-pressed={cameraOn}
          onClick={() => setCameraOn(!cameraOn)}
          disabled={!canCamera}
        >
          {cameraOn ? "Camera on — turn off" : "Camera off — turn on"}
        </Button>
      </div>

      {!canRecord && live && (
        <p className="muted small">
          {state.typedOnly
            ? "This is a typed-only session: no microphone or camera is used."
            : "Recording is off because audio recording consent is off for this session. Typing works."}
        </p>
      )}
      {!canCamera && live && !state.typedOnly && !consent?.face_capture && (
        <p className="muted small">The camera stays off because face and hand capture consent is off.</p>
      )}
      {recording && !state.partial && <p className="partial partial--waiting">Listening to the {speakerName}…</p>}
      {phase === "committing" && <p className="muted" role="status">Saving the turn…</p>}

      <div className="composer__typed">
        <TextArea
          ref={typedRef}
          label={`Type the ${speakerName}’s message`}
          hint="Your draft is kept if the connection drops. Ctrl + Enter adds it."
          value={state.drafts.typed}
          maxChars={1000}
          rows={2}
          disabled={!live}
          onChange={(e) => dispatch({ type: "draft/typed", text: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void ctl.submitTyped();
          }}
        />
        <Button
          icon={<SendHorizontal size={20} />}
          onClick={() => void ctl.submitTyped()}
          disabled={!live || !state.drafts.typed.trim() || busy || state.drafts.typed.length > 1000}
        >
          Add {speakerName} message
        </Button>
      </div>
      <p className="muted small">A patient message is followed by suggested replies. Nothing is spoken until it’s confirmed.</p>
    </section>
  );
});
