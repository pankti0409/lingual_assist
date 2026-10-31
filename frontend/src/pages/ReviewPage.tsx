import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Flag, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { useServices } from "@/api/ServicesProvider";
import { LANGUAGE_LABELS, type Consent } from "@/api/types";
import { EmptyStateArt } from "@/art/Scenes";
import { Button, ButtonLink } from "@/components/Button";
import { ConsentSwitch } from "@/components/ConsentSwitch";
import { Dialog } from "@/components/Dialog";
import { Metric, Notice, StatusBadge } from "@/components/Status";
import { TranscriptList } from "@/components/Transcript";
import { formatMs, langFor, useDocumentTitle } from "@/lib/dom";
import { useSession, type PlaybackStatus } from "@/state/session";
import { useSessionActions } from "@/state/useSessionActions";

const PLAYBACK: Record<PlaybackStatus, string> = {
  idle: "Not played",
  loading: "Preparing",
  playing: "Playing",
  stopped: "Stopped",
  played: "Played",
  text_only: "Shown as text",
  error: "Playback failed",
};

export function ReviewPage() {
  useDocumentTitle("Session review");
  const services = useServices();
  const { state } = useSession();
  const { end, remove, updateConsent } = useSessionActions();
  const navigate = useNavigate();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const s = state.session;
  const hasSession = (state.status === "active" || state.status === "ended") && !!s;

  const metrics = useQuery({
    queryKey: ["metrics", s?.id, state.confirmed.length, state.proposals.length],
    queryFn: () => services.conversation.metrics(s!.id),
    enabled: hasSession,
    retry: false,
  });

  if (!hasSession) {
    return (
      <div className="page review">
        <header className="page-head">
          <p className="eyebrow">Review</p>
          <h1 className="display-2">{state.status === "deleted" ? "The session was deleted." : "No session to review."}</h1>
          <p className="lede">
            {state.status === "deleted"
              ? "Its transcript, suggestions, confirmed messages and drafts were cleared."
              : "Sessions are temporary. Start one to see its transcript and confirmed messages here."}
          </p>
        </header>
        <EmptyStateArt className="state-page__art" />
        <ButtonLink to="/setup">Set up a session</ButtonLink>
      </div>
    );
  }

  const elapsed = state.startedAt ? Date.now() - state.startedAt : null;
  const sys = (metrics.data ?? []).map((m) => m.systemLatencyMs).filter((v): v is number => v !== null);
  const consentKeys: [keyof Omit<Consent, "recordedAt">, string][] = [
    ["audio_recording", "Audio recording"],
    ["face_capture", "Face and hand capture"],
    ["voice_cloning", "Voice cloning"],
    ["demo_use", "Demo and evaluation use"],
  ];

  async function doDelete() {
    await remove();
    setConfirmDelete(false);
    await navigate({ to: "/conversation" });
  }

  return (
    <div className="page review">
      <header className="page-head">
        <p className="eyebrow">Review</p>
        <h1 className="display-2">This session so far.</h1>
        <p className="lede">
          This session is temporary. The current backend specification keeps it only while it is in use; it does not define accounts or
          permanent history.
        </p>
        <StatusBadge tone={state.status === "active" ? "success" : "neutral"}>{state.status === "active" ? "Session active" : "Session ended"}</StatusBadge>
      </header>

      <dl className="metric-row">
        <Metric label="Language" value={<span lang={s.language === "hi" ? "hi" : undefined}>{LANGUAGE_LABELS[s.language]}</span>} />
        <Metric label="Turns" value={state.turns.length} />
        <Metric label="Confirmed messages" value={state.confirmed.length} />
        <Metric label="Decision actions" value={state.decisions} hint="Selections, edits, rejections and clarification requests." />
        <Metric label="Session time" value={formatMs(elapsed)} />
        <Metric
          label="Typical system time per message"
          value={sys.length ? formatMs(sys.sort((a, b) => a - b)[Math.floor(sys.length / 2)]) : "—"}
          hint="From “finish” to suggestions, plus from “Play” to first audio. Excludes time you spent deciding."
          simulated={services.mode === "mock" && sys.length > 0}
        />
      </dl>

      <section className="panel" aria-labelledby="confirmed-h">
        <h2 id="confirmed-h" className="h3">Confirmed messages</h2>
        {state.confirmed.length ? (
          <ol className="confirmed-list">
            {state.confirmed.map((m) => (
              <li key={m.id}>
                <span className="confirmed-list__text" lang={langFor(m.text)}>{m.text}</span>
                <span className="confirmed-list__meta">
                  <StatusBadge tone="neutral">{m.how === "edited" ? "Edited" : "Selected"}</StatusBadge>
                  <StatusBadge tone={state.playback[m.id] === "played" ? "success" : "neutral"}>{PLAYBACK[state.playback[m.id] ?? "idle"]}</StatusBadge>
                  <span className="muted small">{m.effortActions} decision{m.effortActions === 1 ? "" : "s"}</span>
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">No messages confirmed yet.</p>
        )}
      </section>

      <section className="panel" aria-labelledby="transcript-h">
        <h2 id="transcript-h" className="h3">Transcript</h2>
        <TranscriptList turns={state.turns} />
      </section>

      {state.status === "active" && (
        <section className="panel" aria-labelledby="consent-h">
          <h2 id="consent-h" className="h3">Consent for this session</h2>
          <p className="muted">Each choice is separate. Turning one off stops that use from now on.</p>
          <div className="consent-list">
            {consentKeys.map(([k, title]) => (
              <ConsentSwitch
                key={k}
                title={title}
                description={k === "demo_use" ? "Keep logs of this session for demonstration and evaluation." : `Allow ${title.toLowerCase()} in this session.`}
                checked={s.consent[k]}
                onChange={(v) => void updateConsent({ ...s.consent, [k]: v })}
              />
            ))}
          </div>
        </section>
      )}

      <section className="panel danger-zone" aria-labelledby="end-h">
        <h2 id="end-h" className="h3">End or delete</h2>
        <p className="muted">Ending keeps the transcript readable on this screen. Deleting clears everything about this session.</p>
        <div className="actions">
          {state.status === "active" && <Button variant="secondary" icon={<Flag size={20} />} onClick={() => void end()}>End session</Button>}
          <Button variant="danger" icon={<Trash2 size={20} />} onClick={() => setConfirmDelete(true)}>Delete session…</Button>
        </div>
      </section>

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this session?"
        tone="danger"
        initialFocusRef={cancelRef}
        description="This clears the transcript, suggestions, confirmed messages, drafts and voice choice for this session. It can’t be undone."
      >
        <Notice tone="warning" title="Nothing can be recovered after deleting." />
        <div className="actions">
          <Button ref={cancelRef} variant="secondary" onClick={() => setConfirmDelete(false)}>Keep the session</Button>
          <Button variant="danger" icon={<Trash2 size={20} />} onClick={() => void doDelete()}>Delete permanently</Button>
        </div>
      </Dialog>
    </div>
  );
}
