import { useMutation, useQuery } from "@tanstack/react-query";
import { Gauge, Music2, Play, RotateCcw, Save, Sparkles, Square, Star, Upload, Volume2 } from "lucide-react";
import { useState } from "react";
import type { VoiceSimulation } from "@/api/contracts";
import { useServices } from "@/api/ServicesProvider";
import { ApiError, LANGUAGE_LABELS, type Language, type SessionVoice } from "@/api/types";
import { VoicePortrait } from "@/art/Scenes";
import { Button, ButtonLink } from "@/components/Button";
import { ConsentSwitch } from "@/components/ConsentSwitch";
import { ChoiceGroup, TextArea, TextField } from "@/components/Field";
import { LiveRegion, Notice, SimulatedTag, StatusBadge } from "@/components/Status";
import { Slider } from "@/components/Slider";
import { Waveform } from "@/components/Waveform";
import { useDocumentTitle } from "@/lib/dom";
import { playbackMode, pitchSupported, type PlaybackSettings } from "@/lib/player";
import { useJourney } from "@/state/journey";
import { usePreferences } from "@/state/preferences";
import { useSession } from "@/state/session";
import { useSessionActions } from "@/state/useSessionActions";
import { PREVIEW_SOURCE_TEXT, useVoicePreview } from "@/state/useVoicePreview";

const SAMPLES = [
  "Hello! This is how my confirmed messages will sound.",
  "Could I have a cup of tea, please?",
  "Thank you — that made my day.",
];

function errorTitle(e: unknown) {
  if (e instanceof ApiError && e.code === "not_configured") return "The voice service is unavailable";
  if (e instanceof ApiError && e.code === "upstream_error") return "The voice provider returned an error";
  if (e instanceof ApiError && e.code === "consent_required") return "Voice cloning consent is off";
  return "That didn’t work";
}

function personaLabel(v: SessionVoice) {
  return v.persona === "cloned_voice" ? "Personal voice (clone)" : v.persona === "designed_voice" ? "Designed voice — not a clone" : "Default voice";
}

export function VoicePage() {
  useDocumentTitle("Voice Studio");
  const services = useServices();
  const { state, dispatch } = useSession();
  const { prefs, setVoice, set } = usePreferences();
  const { record } = useJourney();
  const { updateConsent } = useSessionActions();
  const pv = useVoicePreview();
  const [sim, setSim] = useState<VoiceSimulation>(services.mock?.voiceSimulation() ?? "normal");
  const [draft, setDraft] = useState<PlaybackSettings>({ rate: prefs.voice.rate, pitch: prefs.voice.pitch, volume: prefs.voice.volume });
  const [saved, setSaved] = useState(false);
  const [sample, setSampleText] = useState(prefs.voice.previewText);
  const [designName, setDesignName] = useState("My designed voice");
  const [description, setDescription] = useState("");
  const [cloneName, setCloneName] = useState("My voice");
  const [file, setFile] = useState<File | null>(null);
  const [announce, setAnnounce] = useState("");
  const session = state.session;
  const active = state.status === "active" && !!session;
  const mock = services.mode === "mock";
  const voice = session?.voice ?? null;
  const browserVoice = playbackMode(null) === "browser_voice";
  const canPitch = pitchSupported(playbackMode(null));
  const dirty = draft.rate !== prefs.voice.rate || draft.pitch !== prefs.voice.pitch || draft.volume !== prefs.voice.volume;

  const voices = useQuery({ queryKey: ["voices", sim], queryFn: () => services.voices.list(), retry: false });

  const design = useMutation({
    mutationFn: () => services.voices.design(session!.id, designName, description),
    onSuccess: (v) => {
      dispatch({ type: "session/voice", voice: v });
      record("voice-tried");
      setAnnounce(`Designed voice “${v.name}” selected for this session.`);
    },
  });
  const clone = useMutation({
    mutationFn: () => services.voices.clone(session!.id, cloneName, file!),
    onSuccess: (v) => {
      dispatch({ type: "session/voice", voice: v });
      record("voice-tried");
      setAnnounce(`Personal voice “${v.name}” selected for this session.`);
    },
  });

  function changeSim(v: VoiceSimulation) {
    services.mock?.setVoiceSimulation(v);
    setSim(v);
  }

  function edit(patch: Partial<PlaybackSettings>) {
    setDraft((d) => ({ ...d, ...patch }));
    setSaved(false);
  }

  function saveSettings() {
    setVoice({ ...draft, previewText: sample.trim() || SAMPLES[0] });
    record("voice-saved");
    setSaved(true);
    setAnnounce("Voice settings saved on this device.");
  }

  // Pitch is shown only when confirmed messages are played by an engine that can change it: the
  // browser voice used in prototype mode. Provider audio (HTTP mode) keeps its natural pitch.
  const showPitch = canPitch && mock;
  const pitchNote = !browserVoice
    ? "Pitch can’t be changed here: this browser has no built-in voice."
    : "Pitch can’t be changed for the voice service — it keeps its natural pitch.";

  return (
    <div className="page voice">
      <header className="page-head page-head--art">
        <div>
          <p className="eyebrow">Voice Studio</p>
          <h1 className="display-2">Find a voice that feels like you.</h1>
          <p className="lede">
            Listen, adjust the pace and volume, and choose how confirmed messages sound. A <strong>designed voice</strong> is a new persona
            described in words; a <strong>personal voice</strong> is cloned from your own recording and needs its own consent.
          </p>
        </div>
        <VoicePortrait className="page-head__art" title="Illustration: a person at a table next to a small speaker with soft sound waves." />
      </header>

      {mock && (
        <div className="sim-row">
          <SimulatedTag>Prototype mode — voices are simulated</SimulatedTag>
          <label className="mini-select">
            <span>Voice service</span>
            <select value={sim} onChange={(e) => changeSim(e.target.value as VoiceSimulation)}>
              <option value="normal">Simulate: available</option>
              <option value="unavailable">Simulate: unavailable</option>
              <option value="provider_error">Simulate: provider error</option>
            </select>
          </label>
        </div>
      )}

      {!active && (
        <Notice tone="info" title="Voice choices apply to an active session" action={<ButtonLink to="/setup" variant="secondary">Set up a session</ButtonLink>}>
          You can listen and adjust playback now. Designing or cloning a voice needs a session.
        </Notice>
      )}

      <div className="studio">
        <section className="studio-stage" aria-labelledby="selected-h">
          <p className="eyebrow">Now speaking with</p>
          <h2 id="selected-h" className="studio-stage__name">{voice ? voice.name : "Device voice"}</h2>
          <div className="studio-stage__tags">
            {voice ? <StatusBadge tone="success">{personaLabel(voice)}</StatusBadge> : <StatusBadge tone="neutral">No voice — text-only</StatusBadge>}
            {mock && <SimulatedTag>Simulated</SimulatedTag>}
          </div>
          {!voice && (
            <p className="muted small">
              Without a session voice, confirmed messages are shown as large text for your partner.{mock ? " In this prototype, a simulated browser voice can still play them." : ""}
            </p>
          )}
          <Waveform active={pv.playing === "stage"} bars={40} rate={draft.rate} className="studio-stage__wave" />
          <fieldset className="sample-pick">
            <legend className="field__label">Preview phrase</legend>
            <div className="chip-row">
              {SAMPLES.map((s) => (
                <button key={s} type="button" className={`chip${sample === s ? " is-on" : ""}`} aria-pressed={sample === s} onClick={() => setSampleText(s)}>
                  {s.length > 30 ? `${s.slice(0, 28)}…` : s}
                </button>
              ))}
            </div>
            <TextField label="Or type your own preview phrase" value={sample} maxChars={160} onChange={(e) => setSampleText(e.target.value.slice(0, 160))} />
          </fieldset>
          <div className="actions">
            {pv.playing === "stage" ? (
              <Button size="lg" icon={<Square size={20} />} onClick={pv.stop}>Stop</Button>
            ) : (
              <Button size="lg" variant="confirm" icon={<Play size={22} />} loading={pv.loading === "stage"} disabled={!sample.trim()} onClick={() => void pv.preview("stage", sample.trim(), voice, draft)}>
                Preview
              </Button>
            )}
            {pv.source && pv.playing && <span className="muted small" role="status">{PREVIEW_SOURCE_TEXT[pv.source]}</span>}
          </div>
          {pv.error && <Notice tone="warning" title="The preview didn’t play">{pv.error} Messages can still be shown as text.</Notice>}
          <p className="muted small">A preview is only a sample. It never becomes a message and is never added to the conversation.</p>
        </section>

        <section className="studio-controls" aria-labelledby="controls-h">
          <h2 id="controls-h" className="h3">How it plays on this device</h2>
          <Slider
            label="Speaking speed"
            icon={<Gauge size={20} />}
            value={draft.rate}
            min={0.5}
            max={1.75}
            step={0.05}
            format={(v) => `${v.toFixed(2)}×`}
            onChange={(v) => edit({ rate: v })}
            presets={[
              { label: "Gentle", value: 0.8 },
              { label: "Natural", value: 1 },
              { label: "Brisk", value: 1.2 },
            ]}
          />
          <Slider label="Volume" icon={<Volume2 size={20} />} value={draft.volume} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => edit({ volume: v })} presets={[{ label: "Soft", value: 0.5 }, { label: "Full", value: 1 }]} />
          {showPitch ? (
            <Slider label="Pitch" icon={<Music2 size={20} />} hint="Applies to the browser voice used in this prototype." value={draft.pitch} min={0.5} max={1.5} step={0.05} format={(v) => (v === 1 ? "Natural" : v < 1 ? `Lower (${v.toFixed(2)})` : `Higher (${v.toFixed(2)})`)} onChange={(v) => edit({ pitch: v })} />
          ) : (
            <p className="muted small"><Music2 size={16} aria-hidden /> {pitchNote}</p>
          )}
          <div className="actions">
            <Button icon={<Save size={20} />} onClick={saveSettings} disabled={!dirty && saved}>Save settings</Button>
            <Button variant="quiet" icon={<RotateCcw size={18} />} onClick={() => edit({ rate: 1, pitch: 1, volume: 1 })}>Reset</Button>
          </div>
          {saved && !dirty && <p className="saved-note" role="status">Saved on this device.</p>}
          {dirty && <p className="muted small">Unsaved changes — previews already use them.</p>}

          <ChoiceGroup<Language>
            legend="Language for previews and new sessions"
            name="voice-language"
            compact
            value={prefs.defaultLanguage}
            onChange={(v) => set({ defaultLanguage: v }, "defaultLanguage")}
            options={[
              { value: "en", label: "English" },
              { value: "hi", label: <span lang="hi">हिन्दी</span> },
              { value: "mixed", label: "Hindi–English" },
            ]}
            hint={session ? `This session uses ${LANGUAGE_LABELS[session.language]}; a session’s language is chosen when it starts.` : undefined}
          />
        </section>
      </div>

      <section className="panel" aria-labelledby="avail-h">
        <div className="panel__head">
          <h2 id="avail-h" className="h3">Voice gallery</h2>
          <span className="muted small">Your favourite is remembered on this device.</span>
        </div>
        {voices.isPending && (
          <div className="voice-gallery" role="status" aria-label="Loading voices">
            <span className="skeleton skeleton--card" />
            <span className="skeleton skeleton--card" />
            <span className="skeleton skeleton--card" />
          </div>
        )}
        {voices.isError && (
          <Notice tone="warning" title={errorTitle(voices.error)} action={<Button variant="secondary" onClick={() => void voices.refetch()}>Try again</Button>}>
            {voices.error.message} Messages can still be shown as text.
          </Notice>
        )}
        {voices.data && !voices.data.length && <p className="empty-note">No voices are available from the service yet.</p>}
        {voices.data && voices.data.length > 0 && (
          <ul className="voice-gallery">
            {voices.data.map((v, i) => {
              const fav = prefs.voice.favouriteVoiceId === v.voiceId;
              const key = `v-${v.voiceId}`;
              return (
                <li key={v.voiceId} className={`voice-card voice-card--${["lilac", "butter", "peach", "pistachio"][i % 4]}`}>
                  <div className="voice-card__top">
                    <span className="voice-card__avatar" aria-hidden>{v.name.slice(0, 1)}</span>
                    <button type="button" className={`xtile__fav${fav ? " is-on" : ""}`} aria-pressed={fav} aria-label={fav ? `Favourite voice: ${v.name} — press to remove` : `Make favourite: ${v.name}`} onClick={() => setVoice({ favouriteVoiceId: fav ? null : v.voiceId })}>
                      <Star size={18} aria-hidden fill={fav ? "currentColor" : "none"} />
                      <span aria-hidden>{fav ? "Favourite voice" : "Make favourite"}</span>
                    </button>
                  </div>
                  <p className="voice-card__name">{v.name}</p>
                  {v.category && <p className="muted small">{v.category}</p>}
                  <Waveform active={pv.playing === key} bars={18} className="voice-card__wave" />
                  {pv.playing === key ? (
                    <Button variant="secondary" icon={<Square size={18} />} onClick={pv.stop}>Stop</Button>
                  ) : (
                    <Button variant="secondary" icon={<Play size={18} />} loading={pv.loading === key} onClick={() => void pv.preview(key, sample.trim() || SAMPLES[0], { voiceId: v.voiceId, name: v.name, persona: "default_voice" }, draft)}>
                      Preview
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="two-col">
        <section className="panel panel--lilac" aria-labelledby="design-h">
          <h2 id="design-h" className="h3"><Sparkles size={22} aria-hidden /> Designed voice</h2>
          <p className="muted">A new persona generated from a description. It is never presented as anyone’s real voice.</p>
          <TextField label="Name for this voice" value={designName} maxChars={60} onChange={(e) => setDesignName(e.target.value)} />
          <TextArea label="Describe the voice" hint="For example: a calm, warm adult voice with a gentle pace." value={description} maxChars={1000} rows={3} onChange={(e) => setDescription(e.target.value)} />
          <Button onClick={() => design.mutate()} loading={design.isPending} disabled={!active || !description.trim() || description.length > 1000}>
            Create designed voice
          </Button>
          {design.isError && <Notice tone="danger" title={errorTitle(design.error)}>{design.error.message}</Notice>}
          {design.isSuccess && <Notice tone="success" title="Designed voice selected">Labelled as a designed voice, not a clone.</Notice>}
        </section>

        <section className="panel panel--peach" aria-labelledby="clone-h">
          <h2 id="clone-h" className="h3"><Upload size={22} aria-hidden /> Personal voice (clone)</h2>
          <p className="muted">Made from a recording of your own voice, with your consent for this session.</p>
          {active && (
            <ConsentSwitch
              title="Voice cloning consent"
              description="Allow a recorded voice sample to be used to create a personal voice for this session."
              checked={!!session?.consent.voice_cloning}
              onChange={(v) => void updateConsent({ ...session!.consent, voice_cloning: v })}
            />
          )}
          {session?.consent.voice_cloning ? (
            <>
              <TextField label="Name for this voice" value={cloneName} maxChars={60} onChange={(e) => setCloneName(e.target.value)} />
              <div className="field">
                <label htmlFor="sample" className="field__label">Voice sample (audio file)</label>
                <p className="field__hint" id="sample-hint">
                  {mock ? "Prototype mode: the file is not read, uploaded or stored. Only its name is shown." : "The sample is sent to the voice provider to create the voice; it is not kept by this app."}
                </p>
                <input id="sample" type="file" accept="audio/*" className="file-input" aria-describedby="sample-hint" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                {file && <p className="small">Selected: {file.name}</p>}
              </div>
              <Button onClick={() => clone.mutate()} loading={clone.isPending} disabled={!active || !file || !cloneName.trim()}>
                Create personal voice
              </Button>
              {clone.isError && <Notice tone="danger" title={errorTitle(clone.error)}>{clone.error.message}</Notice>}
              {clone.isSuccess && (
                <Notice tone="success" title="Personal voice selected">
                  {mock ? "Simulated: no audio was uploaded or stored." : "Your personal voice is used for confirmed messages in this session."}
                </Notice>
              )}
            </>
          ) : (
            <p className="consent-gate">Voice cloning consent is off, so no sample can be added.</p>
          )}
        </section>
      </div>
      <LiveRegion message={announce} />
    </div>
  );
}
