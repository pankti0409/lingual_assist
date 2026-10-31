import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, Camera, Keyboard, Mic, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useServices } from "@/api/ServicesProvider";
import { ApiError, LANGUAGE_LABELS, type Consent, type Language } from "@/api/types";
import { Button, ButtonLink } from "@/components/Button";
import { ConsentSwitch } from "@/components/ConsentSwitch";
import { ChoiceGroup } from "@/components/Field";
import { LiveRegion, Notice, SimulatedTag, StatusBadge, type Tone } from "@/components/Status";
import { checkDevice, DEVICE_MESSAGES, type DeviceCheck, type DeviceKind } from "@/lib/devices";
import { useDocumentTitle } from "@/lib/dom";
import { usePreferences } from "@/state/preferences";
import { useSession } from "@/state/session";
import { useSessionActions } from "@/state/useSessionActions";

type ConsentChoice = Omit<Consent, "recordedAt">;
const ALL_OFF: ConsentChoice = { audio_recording: false, face_capture: false, voice_cloning: false, demo_use: false };
type Simulation = "real" | "denied" | "unavailable";

const CHECK_TONE: Record<Exclude<DeviceCheck, "idle">, Tone> = {
  checking: "pending",
  ready: "success",
  denied: "warning",
  unavailable: "warning",
  unsupported: "warning",
};

function DeviceCard({ kind, consented, mock }: { kind: DeviceKind; consented: boolean; mock: boolean }) {
  const [status, setStatus] = useState<DeviceCheck>("idle");
  const [sim, setSim] = useState<Simulation>("real");
  const Icon = kind === "microphone" ? Mic : Camera;
  const label = kind === "microphone" ? "microphone" : "camera";

  async function run() {
    setStatus("checking");
    if (sim !== "real") {
      await new Promise((r) => setTimeout(r, 300));
      setStatus(sim);
      return;
    }
    setStatus(await checkDevice(kind));
  }

  const msg = status === "idle" ? null : DEVICE_MESSAGES[kind][status];
  return (
    <section className="device-card" aria-labelledby={`dev-${kind}`}>
      <div className="device-card__head">
        <span className="device-card__icon" aria-hidden><Icon size={26} /></span>
        <h3 id={`dev-${kind}`} className="h4">Check the {label}</h3>
      </div>
      <p className="muted">
        {kind === "microphone"
          ? "Needed only to speak turns aloud. Audio recording consent must also be on."
          : "Needed only for optional gesture and movement cues. Face and hand capture consent must also be on."}
      </p>
      {!consented && <p className="device-card__note">Consent for this is currently off, so it won’t be used even if the check passes.</p>}
      {mock && (
        <label className="mini-select">
          <span>Device check</span>
          <select value={sim} onChange={(e) => setSim(e.target.value as Simulation)}>
            <option value="real">Use this device’s real {label}</option>
            <option value="denied">Simulate: permission denied</option>
            <option value="unavailable">Simulate: no device available</option>
          </select>
        </label>
      )}
      <Button variant="secondary" onClick={() => void run()} loading={status === "checking"} icon={<Icon size={20} />}>
        Check {label}
      </Button>
      {msg && (
        <div className="device-card__result" role="status">
          <StatusBadge tone={CHECK_TONE[status as Exclude<DeviceCheck, "idle">]}>{msg.title}</StatusBadge>
          <p>{msg.body}</p>
          {sim !== "real" && status !== "checking" && <SimulatedTag>Simulated result</SimulatedTag>}
        </div>
      )}
    </section>
  );
}

export function SetupPage() {
  useDocumentTitle("Set up a session");
  const services = useServices();
  const { state } = useSession();
  const { start } = useSessionActions();
  const navigate = useNavigate();
  const { prefs } = usePreferences();
  const [language, setLanguage] = useState<Language>(prefs.defaultLanguage);
  const [consent, setConsent] = useState<ConsentChoice>(ALL_OFF);
  const [mode, setMode] = useState<"capture" | "typed">("typed");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [announce, setAnnounce] = useState("");

  const set = (k: keyof ConsentChoice) => (v: boolean) => {
    setConsent((c) => ({ ...c, [k]: v }));
    setAnnounce(`${k.replace(/_/g, " ")} consent ${v ? "on" : "off"}`);
  };

  async function begin() {
    setBusy(true);
    setError(null);
    try {
      await start(language, consent, mode === "typed");
      await navigate({ to: "/conversation" });
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError("network_error", "The service could not be reached."));
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    await services.connection.reconnect();
    await begin();
  }

  const captureWithoutConsent = mode === "capture" && !consent.audio_recording && !consent.face_capture;

  return (
    <div className="page setup">
      <header className="page-head">
        <p className="eyebrow">Session setup · about a minute</p>
        <h1 className="display-2">Choose how this conversation works.</h1>
        <p className="lede">
          Every choice here applies only to this session. Each consent starts off and is chosen on its own. You can change them later
          in Review, or end the session at any time.
        </p>
      </header>

      {state.status === "active" && (
        <Notice tone="info" title="A session is already active" action={<ButtonLink to="/conversation" variant="secondary">Continue it</ButtonLink>}>
          Starting a new session here replaces the current temporary session on this device.
        </Notice>
      )}

      <section className="setup__section setup-step" aria-labelledby="lang-h">
        <span className="setup-step__num" aria-hidden>1</span>
        <h2 id="lang-h" className="h3"><span className="sr-only">Step 1: </span>Language</h2>
        <ChoiceGroup
          legend="Language for transcripts and suggested replies"
          name="language"
          value={language}
          onChange={setLanguage}
          options={[
            { value: "en", label: "English" },
            { value: "hi", label: <span lang="hi">हिन्दी</span>, description: "Hindi" },
            { value: "mixed", label: "Hindi–English", description: <span lang="hi">मिली-जुली · mixed</span> },
          ]}
          hint={`Selected: ${LANGUAGE_LABELS[language]}. Support for Hindi and mixed speech depends on the speech and language services and is still being evaluated.`}
        />
      </section>

      <section className="setup__section setup-step" aria-labelledby="consent-h">
        <span className="setup-step__num" aria-hidden>2</span>
        <h2 id="consent-h" className="h3"><span className="sr-only">Step 2: </span>Consent for this session</h2>
        <p className="muted">There is no “accept all”. Leave anything off that you don’t want; typing still works with everything off.</p>
        <div className="consent-list">
          <ConsentSwitch
            title="Audio recording"
            description="Record speech from the patient and the partner so it can be transcribed. Audio is sent to the speech service for this session only."
            enables="speaking turns aloud"
            checked={consent.audio_recording}
            onChange={set("audio_recording")}
          />
          <ConsentSwitch
            title="Face and hand capture"
            description="Use the camera to notice a stable hand gesture, mouth activity and head movement. Only these derived cues are used; raw video is not kept. This does not read emotions or lip-read words."
            enables="visual cues"
            checked={consent.face_capture}
            onChange={set("face_capture")}
          />
          <ConsentSwitch
            title="Voice cloning"
            description="Create a personal voice from a recorded sample you provide. Without this, a designed voice or text-only output is used."
            enables="a personal voice clone"
            checked={consent.voice_cloning}
            onChange={set("voice_cloning")}
          />
          <ConsentSwitch
            title="Demo and evaluation use"
            description="Keep a log of this session’s transcripts, chosen replies and timings for demonstration and evaluation."
            enables="session logs for evaluation"
            checked={consent.demo_use}
            onChange={set("demo_use")}
          />
        </div>
      </section>

      <section className="setup__section setup-step" aria-labelledby="mode-h">
        <span className="setup-step__num" aria-hidden>3</span>
        <h2 id="mode-h" className="h3"><span className="sr-only">Step 3: </span>How will you take part?</h2>
        <ChoiceGroup
          legend="Input"
          name="mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: "typed", label: <span className="choice-icon"><Keyboard size={20} aria-hidden /> Type only</span>, description: "No microphone or camera needed." },
            { value: "capture", label: <span className="choice-icon"><Mic size={20} aria-hidden /> Speak, and optionally use the camera</span>, description: "Typing stays available too." },
          ]}
        />
        {mode === "capture" && (
          <div className="device-grid">
            <DeviceCard kind="microphone" consented={consent.audio_recording} mock={services.mode === "mock"} />
            <DeviceCard kind="camera" consented={consent.face_capture} mock={services.mode === "mock"} />
          </div>
        )}
        {captureWithoutConsent && (
          <Notice tone="info" title="Recording and camera consents are off">
            You can still start: speaking and the camera stay unavailable until you turn their consent on.
          </Notice>
        )}
      </section>

      {error && (
        <Notice
          tone="danger"
          title={error.code === "network_error" ? "The service is unavailable" : "The session could not be started"}
          action={<Button variant="secondary" icon={<RefreshCw size={18} />} onClick={() => void retry()}>Try again</Button>}
        >
          {error.message} Your choices on this page are kept.
        </Notice>
      )}

      <div className="setup__start">
        <Button size="lg" onClick={() => void begin()} loading={busy} iconEnd={<ArrowRight size={22} />}>
          Start the session
        </Button>
        <p className="muted">Nothing is spoken until the patient confirms it.</p>
      </div>
      <LiveRegion message={announce} />
    </div>
  );
}
