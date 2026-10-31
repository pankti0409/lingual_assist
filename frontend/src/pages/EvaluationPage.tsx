import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FlaskConical, Play } from "lucide-react";
import { useState } from "react";
import { useServices } from "@/api/ServicesProvider";
import { ApiError, type ArmSummary, type EvalMode, type EvalReport } from "@/api/types";
import { EmptyStateArt, UnavailableArt } from "@/art/Scenes";
import { Button } from "@/components/Button";
import { ChoiceGroup } from "@/components/Field";
import { Notice, SimulatedTag, StatusBadge } from "@/components/Status";
import { downloadText, formatMs, formatPct, useDocumentTitle } from "@/lib/dom";

export const MOCK_LABEL = "Illustrative mock results — not measurements.";

const GROUPS: { id: string; title: string; text: string }[] = [
  { id: "clear", title: "Clear speech", text: "Ordinary sentences: the baseline path." },
  { id: "atypical", title: "Simulated atypical speech", text: "Reduced, slurred or incomplete utterances — clearly labelled as simulated." },
  { id: "gesture", title: "Gesture support", text: "Ambiguous speech paired with a calibrated gesture." },
  { id: "context", title: "Conversation context", text: "Short answers that only make sense with the partner’s question." },
  { id: "language", title: "English, Hindi and mixed", text: "Each language is assessed separately." },
  { id: "negative", title: "Negative and ambiguous", text: "Conflicting cues, no gesture, noise, no speech: the system should ask, not guess." },
];

type View = "actual" | "empty" | "running" | "skipped" | "failed" | "unavailable";

function Latency({ l }: { l: ArmSummary["systemLatency"] }) {
  return (
    <>
      {formatMs(l.p50)} / {formatMs(l.p95)}
      {l.lowSample && <span className="muted small"> (few samples: p95 unreliable)</span>}
    </>
  );
}

function Results({ report }: { report: EvalReport }) {
  const mock = report.mode === "mock";
  const { A, B } = report.arms;
  const langs = Object.keys({ ...A.intentAccuracy.byLanguage, ...B.intentAccuracy.byLanguage });
  const groups = Object.keys({ ...A.intentAccuracy.byGroup, ...B.intentAccuracy.byGroup });
  const caption = (t: string) => (
    <caption>
      {t}
      {mock && <span className="table-mock"> — {MOCK_LABEL}</span>}
    </caption>
  );
  return (
    <div className="results">
      {mock && (
        <div className="mock-banner" role="note">
          <FlaskConical size={22} aria-hidden /> <strong>{MOCK_LABEL}</strong>
          <span>These numbers come from scripted mock behaviour, written to show the report layout.</span>
        </div>
      )}
      <p className="muted">
        {report.mode === "live" ? "Live run" : "Mock run"} · {new Date(report.generatedAt).toLocaleString()} · {report.nCases} cases
        {report.nSkipped ? ` · ${report.nSkipped} skipped` : ""}
      </p>
      {report.nSkipped > 0 && (
        <Notice tone="warning" title={`${report.nSkipped} case(s) skipped`}>
          Skipped cases had no usable recording and are not counted in any result:{" "}
          {[...new Set(report.cases.filter((c) => c.skipped).map((c) => c.caseId))].join(", ")}.
        </Notice>
      )}
      <div className="table-wrap">
        <table className="data-table">
          {caption("Comparison: without and with visual cues")}
          <thead>
            <tr>
              <th scope="col">Measure</th>
              <th scope="col">Transcript + conversation context</th>
              <th scope="col">Transcript + conversation context + visual cues</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Intent accuracy</th>
              <td>{formatPct(A.intentAccuracy.overall)}</td>
              <td>{formatPct(B.intentAccuracy.overall)}</td>
            </tr>
            <tr>
              <th scope="row">Raw-transcript word error rate</th>
              <td colSpan={2}>
                {formatPct(report.wer.overall)} for both — visual cues do not change transcripts, so no WER improvement is claimed.
              </td>
            </tr>
            <tr>
              <th scope="row">System latency p50 / p95</th>
              <td><Latency l={A.systemLatency} /></td>
              <td><Latency l={B.systemLatency} /></td>
            </tr>
            <tr>
              <th scope="row">Wall-clock latency p50 / p95</th>
              <td><Latency l={A.wallClock} /></td>
              <td><Latency l={B.wallClock} /></td>
            </tr>
            <tr>
              <th scope="row">Mean decision actions per successful message</th>
              <td>{A.effortMean?.toFixed(2) ?? "—"}</td>
              <td>{B.effortMean?.toFixed(2) ?? "—"}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="muted small">
        System latency covers “finish speaking” to suggestions plus “Play” to first audio, excluding decision time. Wall-clock latency
        includes it. Any 2-second target must be checked against live measurements on the demo device.
      </p>
      <div className="two-col">
        <div className="table-wrap">
          <table className="data-table">
            {caption("Intent accuracy by language")}
            <thead>
              <tr>
                <th scope="col">Language</th>
                <th scope="col">Without cues</th>
                <th scope="col">With cues</th>
              </tr>
            </thead>
            <tbody>
              {langs.map((l) => (
                <tr key={l}>
                  <th scope="row">{l === "en" ? "English" : l === "hi" ? "Hindi" : "Hindi–English mix"}</th>
                  <td>{formatPct(A.intentAccuracy.byLanguage[l])}</td>
                  <td>{formatPct(B.intentAccuracy.byLanguage[l])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            {caption("Intent accuracy by scenario group")}
            <thead>
              <tr>
                <th scope="col">Group</th>
                <th scope="col">Without cues</th>
                <th scope="col">With cues</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g}>
                  <th scope="row">{GROUPS.find((x) => x.id === g)?.title ?? g}</th>
                  <td>{formatPct(A.intentAccuracy.byGroup[g])}</td>
                  <td>{formatPct(B.intentAccuracy.byGroup[g])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function EvaluationPage() {
  useDocumentTitle("Evaluation");
  const services = useServices();
  const qc = useQueryClient();
  const [mode, setMode] = useState<EvalMode>("mock");
  const [view, setView] = useState<View>("actual");
  const report = useQuery({ queryKey: ["eval-report"], queryFn: () => services.evaluation.report(), retry: false });
  const run = useMutation({
    mutationFn: () => services.evaluation.run(mode),
    onSuccess: (r) => qc.setQueryData(["eval-report"], r),
  });
  const csv = useMutation({
    mutationFn: () => services.evaluation.csv(),
    onSuccess: (text) => downloadText("lingual-assist-evaluation.csv", text),
  });

  const data = report.data;
  const runError = run.error instanceof ApiError ? run.error : null;
  const effective: View =
    view !== "actual"
      ? view
      : run.isPending
        ? "running"
        : runError?.code === "not_configured"
          ? "unavailable"
          : run.isError
            ? "failed"
            : !data || data.status === "no_runs"
              ? "empty"
              : data.nSkipped > 0
                ? "skipped"
                : "actual";

  return (
    <div className="page evaluation">
      <header className="page-head">
        <p className="eyebrow">Evaluation · separate from patient conversations</p>
        <h1 className="display-2">Does combining signals help?</h1>
        <p className="lede">
          The same labelled scenarios run twice: once with the transcript and conversation context, once adding visual cues. Results are
          reported per language and per scenario group.
        </p>
      </header>

      <section className="panel" aria-labelledby="groups-h">
        <h2 id="groups-h" className="h3">Scenario groups</h2>
        <ul className="group-list">
          {GROUPS.map((g) => (
            <li key={g.id}>
              <strong>{g.title}</strong>
              {g.id === "atypical" && <SimulatedTag>Simulated speech</SimulatedTag>}
              <span className="muted">{g.text}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel" aria-labelledby="run-h">
        <h2 id="run-h" className="h3">Run</h2>
        <ChoiceGroup<EvalMode>
          legend="Mode"
          name="eval-mode"
          compact
          value={mode}
          onChange={setMode}
          options={[
            { value: "mock", label: "Mock", description: "Scripted; illustrative only" },
            { value: "live", label: "Live", description: "Real services and consented recordings" },
          ]}
        />
        <div className="actions">
          <Button icon={<Play size={20} />} onClick={() => { setView("actual"); run.mutate(); }} loading={run.isPending}>
            Run {mode} evaluation
          </Button>
          <Button variant="secondary" icon={<Download size={20} />} onClick={() => csv.mutate()} disabled={!data || data.status === "no_runs"} loading={csv.isPending}>
            Export CSV
          </Button>
        </div>
        {services.mode === "mock" && (
          <label className="mini-select">
            <span>Preview a state</span>
            <select value={view} onChange={(e) => setView(e.target.value as View)}>
              <option value="actual">Actual state</option>
              <option value="empty">Empty</option>
              <option value="running">Running</option>
              <option value="skipped">Skipped cases</option>
              <option value="failed">Failed</option>
              <option value="unavailable">Unavailable</option>
            </select>
          </label>
        )}
      </section>

      <section className="panel" aria-labelledby="res-h" aria-busy={effective === "running"}>
        <h2 id="res-h" className="h3">Results</h2>
        {effective === "empty" && (
          <div className="state-block state-block--compact">
            <EmptyStateArt className="state-block__art" />
            <p>No evaluation has run yet. Results appear here after a run — no placeholder numbers are shown.</p>
          </div>
        )}
        {effective === "running" && (
          <div role="status" className="replies__loading">
            <span className="skeleton" aria-hidden />
            <p>Running {mode} evaluation…</p>
          </div>
        )}
        {effective === "failed" && (
          <Notice tone="danger" title="The evaluation run failed" action={<Button variant="secondary" onClick={() => run.mutate()}>Try again</Button>}>
            {run.error?.message ?? "The run stopped before finishing. No partial numbers are reported."}
          </Notice>
        )}
        {effective === "unavailable" && (
          <div className="state-block state-block--compact">
            <UnavailableArt className="state-block__art" />
            <Notice tone="warning" title="Live evaluation is unavailable">
              {runError?.message ?? "Live mode needs the backend, its API keys and consented recordings."} Mock mode still shows the report layout.
            </Notice>
          </div>
        )}
        {effective === "skipped" && view === "actual" && data && data.status === "ok" && <Results report={data} />}
        {effective === "skipped" && view === "skipped" && (
          <Notice tone="warning" title="Some cases were skipped">
            In live mode, cases without a consented recording are reported as skipped, listed by id, and excluded from every number.
          </Notice>
        )}
        {effective === "actual" && data && data.status === "ok" && <Results report={data} />}
        {view === "skipped" && <StatusBadge tone="info">Previewing the skipped state</StatusBadge>}
      </section>
    </div>
  );
}
