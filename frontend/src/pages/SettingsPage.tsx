import { AudioLines, ClipboardList, Hand, Keyboard, RotateCcw, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import type { Language } from "@/api/types";
import { Button, ButtonLink } from "@/components/Button";
import { ConsentSwitch } from "@/components/ConsentSwitch";
import { Dialog } from "@/components/Dialog";
import { ChoiceGroup, TextField } from "@/components/Field";
import { LiveRegion, Notice } from "@/components/Status";
import { useDocumentTitle } from "@/lib/dom";
import { useJourney } from "@/state/journey";
import { usePreferences, type MotionPref, type TargetSize, type TextScale } from "@/state/preferences";

const SCALES: { value: TextScale; label: string }[] = [
  { value: 1, label: "Standard" },
  { value: 1.15, label: "Larger" },
  { value: 1.3, label: "Large" },
  { value: 1.5, label: "Largest" },
];

function Group({ id, title, text, children }: { id: string; title: string; text?: string; children: React.ReactNode }) {
  return (
    <section className="settings-group" aria-labelledby={id}>
      <div className="settings-group__intro">
        <h2 id={id} className="h3">{title}</h2>
        {text && <p className="muted">{text}</p>}
      </div>
      <div className="settings-group__body">{children}</div>
    </section>
  );
}

export function SettingsPage() {
  useDocumentTitle("Settings");
  const { prefs, set, reset } = usePreferences();
  const journey = useJourney();
  const [announce, setAnnounce] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const keepRef = useRef<HTMLButtonElement>(null);

  const toggle = (key: "simplified" | "highContrast" | "strongFocus" | "showRecent" | "journey" | "celebrations" | "playAfterExpressionConfirm", label: string) => (v: boolean) => {
    set({ [key]: v }, key);
    setAnnounce(`${label} ${v ? "on" : "off"}.`);
  };

  return (
    <div className="page settings">
      <header className="page-head">
        <p className="eyebrow">Settings</p>
        <h1 className="display-2">Make it yours.</h1>
        <p className="lede">
          Change anything here, any time. These choices are saved only in this browser, never sent to the service, and they don’t assume
          anything about you.
        </p>
      </header>

      <Group id="you-h" title="About you" text="Used only for your greeting on Home.">
        <TextField label="What should we call you?" hint="Optional." value={prefs.name} maxChars={40} onChange={(e) => set({ name: e.target.value.slice(0, 40) }, "name")} placeholder="Your name" />
      </Group>

      <Group id="read-h" title="Reading" text="Text size changes everywhere, including messages shown to your partner.">
        <ChoiceGroup<string>
          legend="Text size"
          name="text-size"
          value={String(prefs.textScale)}
          onChange={(v) => {
            set({ textScale: Number(v) as TextScale }, "textScale");
            setAnnounce(`Text size ${SCALES.find((s) => String(s.value) === v)?.label}.`);
          }}
          options={SCALES.map((s) => ({ value: String(s.value), label: <span className="scale-option" style={{ fontSize: `${s.value * 1.05}rem` }}>Aa</span>, description: s.label }))}
        />
      </Group>

      <Group id="touch-h" title="Touch and pointing" text="Bigger buttons are easier to press with a finger, a head pointer or an eye-gaze cursor.">
        <ChoiceGroup<TargetSize>
          legend="Button size"
          name="targets"
          value={prefs.targets}
          onChange={(v) => {
            set({ targets: v }, "targets");
            setAnnounce(`Button size ${v === "xl" ? "extra large" : v}.`);
          }}
          options={[
            { value: "standard", label: "Standard", description: "52 px targets" },
            { value: "large", label: "Large", description: "60 px targets" },
            { value: "xl", label: "Extra large", description: "70 px targets" },
          ]}
        />
      </Group>

      <Group id="display-h" title="Display and motion">
        <div className="consent-list">
          <ConsentSwitch title="Simplified interface" description="Shows only the essentials. Hides progress, badges and the prototype lab." checked={prefs.simplified} onChange={toggle("simplified", "Simplified interface")} />
          <ConsentSwitch title="High contrast" description="Stronger text, borders and focus outlines." checked={prefs.highContrast} onChange={toggle("highContrast", "High contrast")} />
          <ConsentSwitch title="Extra-visible focus" description="A thicker outline around whatever is selected — helpful with a keyboard or switch." checked={prefs.strongFocus} onChange={toggle("strongFocus", "Extra-visible focus")} />
        </div>
        <ChoiceGroup<MotionPref>
          legend="Motion"
          name="motion"
          value={prefs.motion}
          onChange={(v) => {
            set({ motion: v }, "motion");
            setAnnounce(`Motion: ${v === "system" ? "follow my device" : v === "reduced" ? "reduce" : "allow"}.`);
          }}
          options={[
            { value: "system", label: "Follow my device" },
            { value: "reduced", label: "Reduce motion", description: "No movement or celebrations" },
            { value: "full", label: "Allow gentle motion" },
          ]}
        />
      </Group>

      <Group id="comm-h" title="Communication" text="Nothing here can make the app speak without your confirmation.">
        <ChoiceGroup<Language>
          legend="Language for new sessions"
          name="default-language"
          value={prefs.defaultLanguage}
          onChange={(v) => set({ defaultLanguage: v }, "defaultLanguage")}
          options={[
            { value: "en", label: "English" },
            { value: "hi", label: <span lang="hi">हिन्दी</span>, description: "Hindi" },
            { value: "mixed", label: "Hindi–English", description: "mixed" },
          ]}
        />
        <div className="consent-list">
          <ConsentSwitch
            title="Play quick expressions after I confirm"
            description="Saves one press. You still review and confirm the exact words first; this never applies to suggested replies."
            checked={prefs.playAfterExpressionConfirm}
            onChange={toggle("playAfterExpressionConfirm", "Play quick expressions after confirming")}
          />
          <ConsentSwitch title="Show “Recently said” on Home" description="Lists this session’s confirmed messages. Nothing is kept after the session is deleted." checked={prefs.showRecent} onChange={toggle("showRecent", "Recently said")} />
        </div>
      </Group>

      <Group id="voice-set-h" title="Voice" text="Speed, volume and the voice used for confirmed messages.">
        <p>
          Speed {prefs.voice.rate.toFixed(2)}× · Volume {Math.round(prefs.voice.volume * 100)}%
        </p>
        <div className="actions">
          <ButtonLink to="/voice" variant="secondary" icon={<AudioLines size={20} />}>Open Voice Studio</ButtonLink>
          <ButtonLink to="/gestures" variant="secondary" icon={<Hand size={20} />}>Gesture meanings</ButtonLink>
        </div>
        <p className="muted small">
          Gesture sensitivity (how long a gesture must be held) is set by the service and can’t be changed from this app yet.
        </p>
      </Group>

      <Group id="privacy-h" title="Privacy and conversation history" text="Conversations are temporary and belong to one session.">
        <ul className="plain-list">
          <li>Each session asks separately about recording, camera, voice cloning and demo use — all start off.</li>
          <li>The transcript and confirmed messages are kept only while the session exists. There is no permanent history.</li>
          <li>You can see, change consent for, end or delete the current session in Review.</li>
        </ul>
        <div className="actions">
          <ButtonLink to="/review" variant="secondary" icon={<ClipboardList size={20} />}>Review this session</ButtonLink>
        </div>
      </Group>

      <Group id="journey-h" title="Progress and badges" text="Entirely optional. No points, streaks or targets — and nothing is ever locked.">
        <div className="consent-list">
          <ConsentSwitch title="Show progress and badges" description="A short getting-started list and small badges. When off, nothing is recorded." checked={prefs.journey} onChange={toggle("journey", "Progress and badges")} />
          <ConsentSwitch title="Badge messages" description="A small note when you earn a badge. Never blocks the screen." checked={prefs.celebrations} onChange={toggle("celebrations", "Badge messages")} disabled={!prefs.journey} />
        </div>
      </Group>

      <Group id="kbd-h" title="Keyboard and switch access" text="Every action works without a mouse and without time limits.">
        <ul className="key-list">
          <li><kbd>Tab</kbd> / <kbd>Shift</kbd> + <kbd>Tab</kbd> <span>move between controls (switch “next” / “previous”)</span></li>
          <li><kbd>Enter</kbd> or <kbd>Space</kbd> <span>press the selected control (switch “select”)</span></li>
          <li><kbd>←</kbd> <kbd>→</kbd> <span>move within a group of choices</span></li>
          <li><kbd>Esc</kbd> <span>close a dialog without doing anything</span></li>
          <li><kbd>Ctrl</kbd> + <kbd>Enter</kbd> <span>add a typed message in Talk</span></li>
        </ul>
        <p className="muted small"><Keyboard size={16} aria-hidden /> The first Tab on every page offers “Skip to main content”.</p>
      </Group>

      <Group id="data-h" title="Saved on this device" text="Preferences, favourites, your own expressions and badge dates live only in this browser.">
        <div className="actions">
          <Button variant="secondary" icon={<RotateCcw size={20} />} onClick={() => setConfirmReset(true)}>Reset preferences…</Button>
          <Button
            variant="secondary"
            icon={<Trash2 size={20} />}
            onClick={() => {
              journey.clear();
              setAnnounce("Progress cleared.");
            }}
          >
            Clear progress and badges
          </Button>
        </div>
        {announce.startsWith("Progress cleared") && <Notice tone="success" title="Progress and badges cleared" />}
      </Group>

      <Dialog open={confirmReset} onClose={() => setConfirmReset(false)} title="Reset all preferences?" tone="danger" initialFocusRef={keepRef} description="Text size, buttons, motion, your name, favourites and your own expressions go back to the defaults.">
        <div className="actions">
          <Button ref={keepRef} variant="secondary" onClick={() => setConfirmReset(false)}>Keep my settings</Button>
          <Button
            variant="danger"
            icon={<RotateCcw size={20} />}
            onClick={() => {
              reset();
              setConfirmReset(false);
              setAnnounce("Preferences reset.");
            }}
          >
            Reset
          </Button>
        </div>
      </Dialog>
      <LiveRegion message={announce} />
    </div>
  );
}
