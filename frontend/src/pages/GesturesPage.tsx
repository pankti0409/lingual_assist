import { useMutation } from "@tanstack/react-query";
import { RotateCcw, Save } from "lucide-react";
import { useState } from "react";
import { useServices } from "@/api/ServicesProvider";
import { DEMO_GESTURE_MAP, GESTURE_LABELS, MAX_MEANING_CHARS, type GestureLabel, type GestureMap } from "@/api/types";
import { GestureGlyph, GesturePortrait } from "@/art/Scenes";
import { Button, ButtonLink } from "@/components/Button";
import { ChoiceGroup, TextField } from "@/components/Field";
import { LiveRegion, Notice, SimulatedTag, StatusBadge, type Tone } from "@/components/Status";
import { useDocumentTitle } from "@/lib/dom";
import { useJourney } from "@/state/journey";
import { useSession } from "@/state/session";

const NAMES: Record<GestureLabel, string> = {
  Closed_Fist: "Closed fist",
  Open_Palm: "Open palm",
  Pointing_Up: "Pointing up",
  Thumb_Down: "Thumb down",
  Thumb_Up: "Thumb up",
  Victory: "Victory (two fingers)",
  ILoveYou: "“I love you” hand",
  None: "No gesture",
};

type TestState = "unstable" | "stable" | "low" | "stale" | "unavailable" | "unmapped";

const TEST_RESULT: Record<TestState, { tone: Tone; title: string; body: (meaning: string | undefined, name: string) => string }> = {
  unstable: { tone: "neutral", title: "Detected but not yet stable", body: (_m, n) => `${n} was seen in only a frame or two. It is ignored until it holds steady for a few frames.` },
  stable: { tone: "success", title: "Stable and fresh", body: (m, n) => (m ? `${n} is steady and recent. It can inform suggestions as “${m}” — it still cannot confirm or speak anything.` : `${n} is steady, but has no meaning set, so it adds nothing.`) },
  low: { tone: "warning", title: "Low confidence", body: (_m, n) => `${n} was detected with low confidence, so it is ignored rather than guessed.` },
  stale: { tone: "warning", title: "Stale", body: (_m, n) => `${n} was seen more than about 1.5 seconds before the patient finished. Old cues are ignored.` },
  unavailable: { tone: "warning", title: "Cues unavailable", body: () => "The camera or gesture service isn’t available. Suggestions use the transcript and conversation only." },
  unmapped: { tone: "neutral", title: "Unmapped", body: (_m, n) => `${n} was recognised, but you haven’t given it a meaning, so it is not used.` },
};

export function GesturesPage() {
  useDocumentTitle("Gesture settings");
  const services = useServices();
  const { state } = useSession();
  const { record } = useJourney();
  const [map, setMap] = useState<GestureMap>({ ...DEMO_GESTURE_MAP });
  const [testGesture, setTestGesture] = useState<GestureLabel>("Thumb_Up");
  const [testState, setTestState] = useState<TestState>("stable");
  const [announce, setAnnounce] = useState("");
  const active = state.status === "active" && !!state.session;

  const errors = Object.fromEntries(
    GESTURE_LABELS.map((g) => [g, (map[g] ?? "").length > MAX_MEANING_CHARS ? `Up to ${MAX_MEANING_CHARS} characters.` : null]),
  ) as Record<GestureLabel, string | null>;
  const invalid = Object.values(errors).some(Boolean);

  const save = useMutation({
    mutationFn: () => services.vision.setGestureMap(state.session!.id, map),
    onSuccess: (saved) => {
      setMap(saved);
      record("gestures-saved");
      setAnnounce("Gesture meanings saved for this session.");
    },
  });

  const meaning = testState === "unmapped" ? undefined : map[testGesture]?.trim() || undefined;
  const result = TEST_RESULT[testState === "stable" && !meaning ? "unmapped" : testState];

  return (
    <div className="page gestures">
      <header className="page-head page-head--art">
        <div>
          <p className="eyebrow">Gestures</p>
          <h1 className="display-2">Gestures mean what you decide.</h1>
          <p className="lede">
            A gesture’s meaning is personal. Give each one a short meaning, or leave it blank so it is ignored. A gesture can help the
            assistant suggest a reply, but it can never approve or speak a message — you always confirm.
          </p>
        </div>
        <GesturePortrait className="page-head__art" title="Illustration: a person raising an open palm, with small gesture icons nearby." />
      </header>

      <Notice tone="info" title="“Pointing up” is a hand shape, not pointing at things">
        It does not detect which object someone is pointing at. Give it a meaning only if that hand shape means something to you.
      </Notice>

      {!active && (
        <Notice tone="info" title="Meanings are saved per session" action={<ButtonLink to="/setup" variant="secondary">Set up a session</ButtonLink>}>
          You can try meanings here now; saving them needs an active session.
        </Notice>
      )}

      <section className="panel" aria-labelledby="map-h">
        <h2 id="map-h" className="h3">Your gesture meanings</h2>
        <p className="muted">Example defaults for a demo: Thumb up = yes, Open palm = pause, Thumb down = no. Change them freely.</p>
        <ul className="gesture-grid">
          {GESTURE_LABELS.map((g) => (
            <li key={g} className={`gesture-row${(map[g] ?? "").trim() ? " has-meaning" : ""}`}>
              <GestureGlyph label={g} />
              <TextField
                label={`${NAMES[g]} — meaning`}
                placeholder="No meaning (ignored)"
                value={map[g] ?? ""}
                maxChars={MAX_MEANING_CHARS}
                error={errors[g]}
                onChange={(e) => setMap((m) => ({ ...m, [g]: e.target.value }))}
              />
            </li>
          ))}
        </ul>
        <div className="actions">
          <Button icon={<Save size={20} />} onClick={() => save.mutate()} loading={save.isPending} disabled={!active || invalid}>
            Save meanings
          </Button>
          <Button variant="secondary" icon={<RotateCcw size={20} />} onClick={() => setMap({ ...DEMO_GESTURE_MAP })}>
            Reset to demo defaults
          </Button>
        </div>
        {save.isError && <Notice tone="danger" title="Couldn’t save">{save.error.message}</Notice>}
        {save.isSuccess && <Notice tone="success" title="Saved for this session" />}
      </section>

      <section className="panel" aria-labelledby="test-h">
        <div className="panel__head">
          <h2 id="test-h" className="h3">Test how a gesture is treated</h2>
          <SimulatedTag>Simulated — no camera used</SimulatedTag>
        </div>
        <div className="test-grid">
          <label className="mini-select">
            <span>Gesture</span>
            <select value={testGesture} onChange={(e) => setTestGesture(e.target.value as GestureLabel)}>
              {GESTURE_LABELS.filter((g) => g !== "None").map((g) => (
                <option key={g} value={g}>{NAMES[g]}</option>
              ))}
            </select>
          </label>
          <ChoiceGroup<TestState>
            legend="Detection state"
            name="test-state"
            compact
            value={testState}
            onChange={setTestState}
            options={[
              { value: "unstable", label: "Detected, unstable" },
              { value: "stable", label: "Stable and fresh" },
              { value: "low", label: "Low confidence" },
              { value: "stale", label: "Stale" },
              { value: "unavailable", label: "Unavailable" },
              { value: "unmapped", label: "Unmapped" },
            ]}
          />
        </div>
        <div className="test-result" role="status" aria-label="Test result">
          <GestureGlyph label={testGesture} size={72} />
          <div>
            <StatusBadge tone={result.tone}>{result.title}</StatusBadge>
            <p>{result.body(meaning, NAMES[testGesture])}</p>
          </div>
        </div>
      </section>
      <LiveRegion message={announce} />
    </div>
  );
}
