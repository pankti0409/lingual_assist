import { useQuery } from "@tanstack/react-query";
import { Camera, CameraOff, Ear, Hand, MessagesSquare, ScanFace, Smile } from "lucide-react";
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

type Level = "active" | "ready" | "off";

function Signal({ icon, label, value, level }: { icon: ReactNode; label: string; value: string; level: Level }) {
  return (
    <li className={`signal signal--${level}`}>
      <span className="signal__icon" aria-hidden>{icon}</span>
      <span className="signal__text">
        <span className="signal__label">{label}</span>
        <span className="signal__value">{value}</span>
      </span>
      <span className="signal__dot" aria-hidden />
    </li>
  );
}

/**
 * Multimodal signal indicators. Each one reflects real state: the capture phase, the camera
 * switch, and the latest cue the service returned. When something is off, it says "off".
 */
export function SignalStrip({ ctl }: { ctl: Ctl }) {
  const services = useServices();
  const cues = useCues(ctl);
  const { phase, state, live } = ctl;
  const consent = state.session?.consent;
  const c = cues.data;
  const g = c?.gesture;
  const speech: [string, Level] =
    phase === "recording"
      ? [`Listening to the ${state.speaker}`, "active"]
      : phase === "committing"
        ? ["Saving the turn", "active"]
        : !live
          ? ["Session not active", "off"]
          : state.typedOnly
            ? ["Off — typing only", "off"]
            : !consent?.audio_recording
              ? ["Off — no recording consent", "off"]
              : ["Ready", "ready"];
  const cam: [string, Level] = !cues.on ? ["Off", "off"] : cues.isError ? ["Unavailable", "off"] : c ? (c.stale ? ["On — cue is stale", "ready"] : ["On", "active"]) : ["On — waiting", "ready"];
  const gesture: [string, Level] = !cues.on || !c ? ["—", "off"] : g ? [`${gestureName(g.label)}, ${g.stable ? "steady" : "not yet steady"}`, g.stable && !c.stale ? "active" : "ready"] : ["None seen", "ready"];
  const recent = Math.min(state.turns.length, 6);

  return (
    <section className="signals" aria-labelledby="signals-h">
      <div className="signals__head">
        <h2 id="signals-h" className="signals__title">Signals</h2>
        {services.mode === "mock" && cues.on && <SimulatedTag>Simulated camera</SimulatedTag>}
      </div>
      <ul className="signals__list">
        <Signal icon={<Ear size={20} />} label="Speech" value={speech[0]} level={speech[1]} />
        <Signal icon={cues.on ? <Camera size={20} /> : <CameraOff size={20} />} label="Camera" value={cam[0]} level={cam[1]} />
        <Signal icon={<Hand size={20} />} label="Gesture" value={gesture[0]} level={gesture[1]} />
        <Signal icon={<Smile size={20} />} label="Mouth" value={!cues.on || !c ? "—" : c.mouthActivity ? "Moving" : "Still"} level={!cues.on || !c ? "off" : c.mouthActivity ? "active" : "ready"} />
        <Signal icon={<ScanFace size={20} />} label="Head nod" value={!cues.on || !c ? "—" : c.headNod ? "Nodding" : "No nod"} level={!cues.on || !c ? "off" : c.headNod ? "active" : "ready"} />
        <Signal icon={<MessagesSquare size={20} />} label="Context" value={recent ? `${recent} recent turn${recent === 1 ? "" : "s"}` : "None yet"} level={recent ? "active" : "off"} />
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
