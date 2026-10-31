import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { Flag, Keyboard, LayoutGrid, Settings2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { SCENARIOS, SCENARIO_IDS, type ScenarioId } from "@/api/mock/scenarios";
import { useServices } from "@/api/ServicesProvider";
import { LANGUAGE_LABELS } from "@/api/types";
import { EmptyStateArt, UnavailableArt } from "@/art/Scenes";
import { Button, ButtonLink } from "@/components/Button";
import { ExpressionSheet } from "@/components/ExpressionSheet";
import { ExpressionTile } from "@/components/ExpressionTile";
import { LiveRegion, Notice, SimulatedTag } from "@/components/Status";
import { Timeline } from "@/components/Transcript";
import { allExpressions, type Expression } from "@/lib/expressions";
import { useDocumentTitle } from "@/lib/dom";
import { usePreferences } from "@/state/preferences";
import { useSessionActions } from "@/state/useSessionActions";
import { CapturePanel } from "./CapturePanel";
import { CuesPanel, SignalStrip } from "./CuesPanel";
import { ProposalPanel } from "./ProposalPanel";
import { useConversation } from "./useConversation";

function ScenarioPicker({ value, onChange }: { value: ScenarioId; onChange: (id: ScenarioId) => void }) {
  return (
    <details className="scenario-picker">
      <summary>
        <SimulatedTag>Scripted scenario</SimulatedTag> <span className="scenario-picker__current">{SCENARIOS[value].title}</span>
      </summary>
      <div className="scenario-picker__body">
        <label className="mini-select">
          <span>Prototype scenario</span>
          <select value={value} onChange={(e) => onChange(e.target.value as ScenarioId)}>
            {SCENARIO_IDS.map((id) => (
              <option key={id} value={id}>{SCENARIOS[id].title}</option>
            ))}
          </select>
        </label>
        <p className="muted small">{SCENARIOS[value].summary}</p>
      </div>
    </details>
  );
}

function QuickStrip({ onSay }: { onSay: (e: Expression) => void }) {
  const { prefs } = usePreferences();
  const all = useMemo(() => allExpressions(prefs.customExpressions), [prefs.customExpressions]);
  const favs = prefs.favourites.map((id) => all.find((e) => e.id === id)).filter((e): e is Expression => !!e).slice(0, 6);
  return (
    <section className="quick-strip" aria-labelledby="qs-h">
      <div className="quick-strip__head">
        <h2 id="qs-h" className="h4">Quick expressions</h2>
        <Link to="/expressions" className="text-link small"><LayoutGrid size={16} aria-hidden /> Board</Link>
      </div>
      {favs.length ? (
        <ul className="quick-strip__list">
          {favs.map((e) => (
            <li key={e.id}>
              <ExpressionTile expression={e} compact onSay={onSay} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">Star expressions on the board to keep them here.</p>
      )}
    </section>
  );
}

export function ConversationPage() {
  useDocumentTitle("Conversation");
  const services = useServices();
  const search = useSearch({ from: "/conversation" });
  const navigate = useNavigate({ from: "/conversation" });
  const ctl = useConversation();
  const { start, end, loadScenarioEndState } = useSessionActions();
  const typedRef = useRef<HTMLTextAreaElement>(null);
  const [scenario, setScenario] = useState<ScenarioId>(() => search.scenario ?? services.mock?.scenario() ?? "water");
  const [starting, setStarting] = useState(false);
  const [sheet, setSheet] = useState<Expression | null>(null);
  const { state, dispatch } = ctl;

  useEffect(() => {
    if (!services.mock) return;
    services.mock.setScenario(scenario);
    if (SCENARIOS[scenario].endedSession || SCENARIOS[scenario].deletedSession) void loadScenarioEndState(scenario);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario]);

  function pickScenario(id: ScenarioId) {
    setScenario(id);
    void navigate({ search: { scenario: id }, replace: true });
  }

  /** Sample path: a typed-only session with every consent off, seeded with the scenario's partner question. */
  async function startSample() {
    setStarting(true);
    try {
      const sc = SCENARIOS[scenario];
      const session = await start(sc.language, { audio_recording: false, face_capture: false, voice_cloning: false, demo_use: false }, true);
      const partnerTurn = await services.conversation.addTypedTurn(session.id, "partner", sc.partner.committed, sc.language);
      dispatch({ type: "turn/added", turn: partnerTurn });
      dispatch({ type: "speaker/set", speaker: "patient" });
      dispatch({ type: "draft/typed", text: sc.patient.committed });
      ctl.setAnnounce("Sample started. The patient’s answer is ready in the text box — add it to see suggestions.");
    } finally {
      setStarting(false);
    }
  }

  const header = (
    <header className="page-head page-head--row ws-head">
      <div>
        <p className="eyebrow">Talk</p>
        <h1 className="display-3">Talk, review, then speak.</h1>
        {state.session && (state.status === "active" || state.status === "ended") && (
          <p className="ws-head__meta">
            {LANGUAGE_LABELS[state.session.language]} · {state.typedOnly ? "typing only" : "speech and typing"} · {state.confirmed.length} confirmed
          </p>
        )}
      </div>
      <div className="ws-head__tools">
        {services.mode === "mock" && <ScenarioPicker value={scenario} onChange={pickScenario} />}
        {state.status === "active" && (
          <Button variant="quiet" icon={<Flag size={18} />} onClick={() => void end()}>End session</Button>
        )}
      </div>
    </header>
  );

  if (state.status === "none") {
    return (
      <div className="page conversation">
        {header}
        <section className="state-block" aria-labelledby="no-session">
          <EmptyStateArt className="state-block__art" />
          <div>
            <h2 id="no-session" className="h2">No active session</h2>
            <p className="lede">Set up a session to choose a language and each consent. Or try the sample with typing only — no microphone, camera or consent needed.</p>
            <div className="actions">
              <ButtonLink to="/setup" icon={<Settings2 size={20} />}>Set up a session</ButtonLink>
              <Button variant="secondary" icon={<Keyboard size={20} />} onClick={() => void startSample()} loading={starting}>
                Try the sample by typing
              </Button>
            </div>
          </div>
        </section>
      </div>
    );
  }

  if (state.status === "deleted") {
    return (
      <div className="page conversation">
        {header}
        <section className="state-block" aria-labelledby="deleted">
          <UnavailableArt className="state-block__art" />
          <div>
            <h2 id="deleted" className="h2">This session was deleted</h2>
            <p className="lede">Its transcript, suggestions, confirmed messages and drafts were cleared from this device and the service. Nothing remains to show.</p>
            <div className="actions">
              <ButtonLink to="/setup">Start a new session</ButtonLink>
            </div>
          </div>
        </section>
      </div>
    );
  }

  const ended = state.status === "ended";

  return (
    <div className="page conversation">
      {header}
      {ended && (
        <Notice tone="neutral" title="This session has ended" action={<ButtonLink to="/review" variant="secondary">Open review</ButtonLink>}>
          The transcript stays readable here. Nothing new can be captured, confirmed or spoken.
        </Notice>
      )}
      {ctl.error && (
        <Notice
          tone={ctl.error.code === "network_error" ? "warning" : "danger"}
          title={
            ctl.error.code === "consent_required"
              ? "Consent is off for that"
              : ctl.error.code === "not_configured"
                ? "That device or service isn’t available"
                : ctl.error.code === "network_error"
                  ? "Couldn’t reach the service"
                  : "That didn’t work"
          }
          action={<Button variant="quiet" onClick={ctl.clearError}>Dismiss</Button>}
        >
          {ctl.error.message} {ctl.error.code !== "consent_required" && "Your draft is kept."}
        </Notice>
      )}

      {!ended && <SignalStrip ctl={ctl} />}

      <div className="workspace">
        <section className="ws-convo" aria-labelledby="t-h">
          <div className="ws-convo__head">
            <h2 id="t-h" className="h3">Conversation</h2>
            <span className="muted small">{state.turns.length} turn{state.turns.length === 1 ? "" : "s"}</span>
          </div>
          <Timeline
            turns={state.turns}
            confirmed={state.confirmed}
            proposals={state.proposals}
            playback={state.playback}
            partial={state.partial}
            emptyText="No turns yet. Choose who is speaking, then record or type."
          />
          {!ended && <CapturePanel ctl={ctl} ref={typedRef} />}
        </section>

        <div className="ws-side">
          <ProposalPanel ctl={ctl} onRepeat={() => void ctl.startRecording()} onTypeInstead={() => typedRef.current?.focus()} />
          {!ended && <QuickStrip onSay={setSheet} />}
          <CuesPanel ctl={ctl} />
        </div>
      </div>
      <ExpressionSheet expression={sheet} onClose={() => setSheet(null)} />
      <LiveRegion message={ctl.announce} />
    </div>
  );
}
