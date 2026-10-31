import { useQuery } from "@tanstack/react-query";
import { CameraOff, Ear, Hand, MessagesSquare, ScanFace, Smile } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { useServices } from "@/api/ServicesProvider";
import { GesturePortrait } from "@/art/Scenes";
import { SimulatedTag, StatusBadge } from "@/components/Status";
import type { useConversation } from "./useConversation";

type Ctl = ReturnType<typeof useConversation>;

/** The latest visual cues, only while the camera is on. Shared by the strip and the panel. */
export function useCues(ctl: Ctl) {
  const services = useServices();
  const sid = ctl.state.session?.id;
  const on = ctl.cameraOn && ctl.live;
  const q = useQuery({
    queryKey: ["cues", sid, on],
    queryFn: () => services.vision.cues(sid!),
    enabled: !!sid && on,
    refetchInterval: on ? 1500 : false,
  });
  return { on, ...q };
}

const gestureName = (label: string) => label.replace(/_/g, " ").replace(/^ILoveYou$/, "I love you");

type Status = "active" | "ready" | "processing" | "off" | "unavailable";
const STATUS_WORD: Record<Status, string> = { active: "Active", ready: "Ready", processing: "Processing", off: "Off", unavailable: "Not available" };

function Signal({ icon, label, detail, status }: { icon: ReactNode; label: string; detail: string; status: Status }) {
  return (
    <li className={`signal signal--${status}`}>
      <span className="signal__icon" aria-hidden>{icon}</span>
      <span className="signal__text">
        <span className="signal__label">{label}</span>
        <span className="signal__value">{detail}</span>
      </span>
      <span className="signal__status">{STATUS_WORD[status]}</span>
    </li>
  );
}

/**
 * The five signal sources and their real state: the capture phase, the camera switch and the
 * latest cue the service returned. Nothing is simulated here beyond what the service reports, and
 * what this build cannot do (reading facial expressions) is shown as not available.
 */
export function SignalStrip({ ctl }: { ctl: Ctl }) {
  const services = useServices();
  const cues = useCues(ctl);
  const { phase, state, live } = ctl;
  const consent = state.session?.consent;
  const c = cues.data;
  const g = c?.gesture;
  const camLive = cues.on && !cues.isError && !!c;
  const camDetail = !cues.on ? (consent?.face_capture && !state.typedOnly ? "Camera is off" : "Needs face and hand consent") : cues.isError ? "Cues unavailable" : !c ? "Waiting for the camera" : c.stale ? "Last cue is old — ignored" : "";

  const speech: [string, Status] =
    phase === "recording"
      ? [`Listening to the ${state.speaker}`, "active"]
      : phase === "committing"
        ? ["Turning speech into text", "processing"]
        : !live
          ? ["Session not active", "off"]
          : state.typedOnly
            ? ["Typing only in this session", "off"]
            : !consent?.audio_recording
              ? ["Needs recording consent", "off"]
              : ["Press Record to start", "ready"];
  const lips: [string, Status] = !camLive ? [camDetail, cues.isError ? "unavailable" : "off"] : c!.stale ? [camDetail, "ready"] : [c!.mouthActivity ? "Mouth is moving (movement only, not words)" : "Mouth is still", c!.mouthActivity ? "active" : "ready"];
  const hands: [string, Status] = !camLive
    ? [camDetail, cues.isError ? "unavailable" : "off"]
    : g
      ? [`${gestureName(g.label)}, ${g.stable ? "steady" : "not yet steady"}${g.meaning ? ` — “${g.meaning}”` : ""}${c!.headNod ? " · nodding" : ""}`, g.stable && !c!.stale ? "active" : "ready"]
      : [c!.headNod ? "No hand gesture · nodding" : "No hand gesture seen", c!.headNod ? "active" : "ready"];
  const recent = Math.min(state.turns.length, 6);
  const context: [string, Status] = phase === "fusing" ? ["Being used for suggestions", "processing"] : recent ? [`${recent} recent turn${recent === 1 ? "" : "s"}`, "ready"] : ["No turns yet", "off"];

  return (
    <section className="signals" aria-labelledby="signals-h">
      <div className="signals__head">
        <h2 id="signals-h" className="signals__title">What the assistant can use</h2>
        {services.mode === "mock" && cues.on && <SimulatedTag>Simulated camera</SimulatedTag>}
      </div>
      <ul className="signals__list">
        <Signal icon={<Ear size={20} />} label="Speech" detail={speech[0]} status={speech[1]} />
        <Signal icon={<Smile size={20} />} label="Lip movement" detail={lips[0]} status={lips[1]} />
        <Signal icon={<ScanFace size={20} />} label="Facial expression" detail="Not read — the assistant never guesses feelings" status="unavailable" />
        <Signal icon={<Hand size={20} />} label="Hand gestures" detail={hands[0]} status={hands[1]} />
        <Signal icon={<MessagesSquare size={20} />} label="Conversation" detail={context[0]} status={context[1]} />
      </ul>
    </section>
  );
}

/** Local-only camera preview (HTTP mode). Frames are not stored. */
function LivePreview() {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      ?.getUserMedia({ video: true })
      .then((s) => {
        stream = s;
        if (ref.current) ref.current.srcObject = s;
      })
      .catch(() => undefined);
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);
  return <video ref={ref} className="cues__video" autoPlay muted playsInline aria-label="Your camera preview (stays on this device)" />;
}

export function CuesPanel({ ctl }: { ctl: Ctl }) {
  const services = useServices();
  const cues = useCues(ctl);
  const c = cues.data;
  const g = c?.gesture;

  return (
    <section className="panel cues" aria-labelledby="cues-h">
      <div className="panel__head">
        <h2 id="cues-h" className="h3">Camera and cues</h2>
        {cues.on && services.mode === "mock" && <SimulatedTag>Simulated camera</SimulatedTag>}
      </div>
      <p className="cues__rule">Cues can inform suggestions. They never confirm or speak a message.</p>
      {!cues.on ? (
        <div className="cues__off">
          <CameraOff size={28} aria-hidden />
          <p>Camera off. Cues are optional — everything works without them.</p>
        </div>
      ) : (
        <>
          <div className="cues__preview">
            {services.mode === "mock" ? (
              <GesturePortrait title="Simulated camera view: an illustrated person raising a hand. No real camera is used." className="cues__art" />
            ) : (
              <LivePreview />
            )}
          </div>
          {cues.isPending && <p className="muted" role="status">Waiting for cues…</p>}
          {cues.isError && <StatusBadge tone="warning">Cues unavailable right now</StatusBadge>}
          {cues.isSuccess && !c && <StatusBadge tone="neutral">No face or hand detected yet</StatusBadge>}
          {c && (
            <dl className="cue-list">
              <div>
                <dt>Hand gesture</dt>
                <dd>
                  {g ? (
                    <>
                      <span className="cue-list__value">{gestureName(g.label)}</span>{" "}
                      <StatusBadge tone={g.stable ? "success" : "neutral"}>{g.stable ? "stable" : "not yet stable"}</StatusBadge>{" "}
                      <span>{g.meaning ? `your meaning: “${g.meaning}”` : "no meaning set (unmapped)"}</span>
                    </>
                  ) : (
                    "none detected"
                  )}
                </dd>
              </div>
              <div>
                <dt>Mouth activity</dt>
                <dd>{c.mouthActivity ? "moving" : "not moving"}</dd>
              </div>
              <div>
                <dt>Head nod</dt>
                <dd>{c.headNod ? "nodding" : "no nod"}</dd>
              </div>
              <div>
                <dt>Freshness</dt>
                <dd>{c.stale ? <StatusBadge tone="warning">stale — ignored</StatusBadge> : "current"}</dd>
              </div>
            </dl>
          )}
          <p className="muted small">Only movement cues are derived: no emotions, no lip-reading, no diagnosis.</p>
        </>
      )}
    </section>
  );
}
