import { Check, ChevronLeft, Ear, Expand, HelpCircle, Lightbulb, Pencil, PenLine, Play, RefreshCw, RotateCcw, Sparkles, Square, ThumbsDown, Volume2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useServices } from "@/api/ServicesProvider";
import type { ConfirmedMessage, Proposal } from "@/api/types";
import { Button } from "@/components/Button";
import { Dialog } from "@/components/Dialog";
import { ConfirmTick } from "@/components/ExpressionSheet";
import { TextArea } from "@/components/Field";
import { Disclosure, Notice, SimulatedTag, StatusBadge } from "@/components/Status";
import { Waveform } from "@/components/Waveform";
import { formatMs, langFor } from "@/lib/dom";
import { DUR, EASE_OUT, popVariants, useCalm } from "@/lib/motion";
import { playbackMode } from "@/lib/player";
import { usePlayback } from "@/state/usePlayback";
import type { useConversation } from "./useConversation";

type Ctl = ReturnType<typeof useConversation>;
type Review = { kind: "candidate"; index: number } | { kind: "edit" } | { kind: "edit-review" } | null;

const MAX_EDIT = 300;
const surface = { layout: true, transition: { duration: DUR.dialog, ease: EASE_OUT } } as const;

function ExactText({ text }: { text: string }) {
  return (
    <blockquote className="exact" lang={langFor(text)}>
      {text}
    </blockquote>
  );
}

/** A label that says which kind of message this is — never colour alone. */
function Kind({ kind }: { kind: "suggested" | "edited" | "confirmed" }) {
  const map = {
    suggested: [<Sparkles size={15} key="i" />, "Suggested · not spoken"],
    edited: [<PenLine size={15} key="i" />, "Edited by you · not spoken"],
    confirmed: [<Check size={15} key="i" />, "Confirmed by you"],
  } as const;
  return (
    <span className={`kind kind--${kind}`}>
      <span aria-hidden>{map[kind][0]}</span>
      {map[kind][1]}
    </span>
  );
}

const humanIntent = (intent: string) => intent.replace(/[_-]+/g, " ").trim();

export function ProposalPanel({ ctl, onRepeat, onTypeInstead }: { ctl: Ctl; onRepeat: () => void; onTypeInstead: () => void }) {
  const { proposal, phase, state, dispatch, decide, fuse, live } = ctl;
  const calm = useCalm();
  const [review, setReview] = useState<Review>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const busy = phase === "acting" || phase === "fusing";

  // A new proposal resets any review in progress.
  useEffect(() => setReview(null), [proposal?.id]);

  const confirmed = proposal ? state.confirmed.find((m) => m.proposalId === proposal.id) ?? null : null;
  const editText = state.drafts.edit;

  async function confirmCandidate(p: Proposal, index: number) {
    const res = await decide("confirm", p, index);
    if (res) setReview(null);
  }
  async function confirmEdit(p: Proposal) {
    const res = await decide("edit", p, editText);
    if (res) setReview(null);
  }
  /** Regenerate: these suggestions are recorded as rejected (nothing spoken), then new ones are requested. */
  async function regenerate(p: Proposal) {
    const res = await decide("reject", p);
    if (res) await fuse();
  }
  function startEdit(p: Proposal, seed?: string) {
    if (!editText) dispatch({ type: "draft/edit", text: seed ?? p.fusion.candidateReplies[0] ?? "" });
    setReview({ kind: "edit" });
  }
  function reviewEdit() {
    const t = editText.trim();
    if (!t) return setEditError("Write the message you want to say.");
    if (t.length > MAX_EDIT) return setEditError(`Keep it to ${MAX_EDIT} characters or fewer.`);
    setEditError(null);
    setReview({ kind: "edit-review" });
  }

  const heard = proposal?.evidence?.transcript;

  return (
    <section className={`studio-panel${confirmed ? " is-confirmed" : ""}`} aria-labelledby="replies-h">
      <div className="studio-panel__head">
        <h2 id="replies-h" ref={headingRef} tabIndex={-1} className="h3">
          {confirmed ? "Confirmed message" : "Suggested replies"}
        </h2>
        {proposal && !confirmed && <ProposalState proposal={proposal} />}
      </div>

      {phase === "fusing" && (
        <div className="replies__loading" role="status">
          <span className="skeleton" aria-hidden />
          <span className="skeleton" aria-hidden />
          <span className="skeleton skeleton--short" aria-hidden />
          <p>Finding likely replies from what was said, the recent conversation and any cues. Nothing will be spoken.</p>
        </div>
      )}

      {!proposal && phase !== "fusing" && (
        <div className="replies__empty">
          <svg viewBox="0 0 120 80" width={120} height={80} aria-hidden className="replies__empty-art">
            <rect x={8} y={14} width={64} height={38} rx={14} fill="#E5DFF2" stroke="#344B50" strokeWidth={2.5} />
            <path d="M24 52 l-6 12 l16 -12" fill="#E5DFF2" stroke="#344B50" strokeWidth={2.5} strokeLinejoin="round" />
            <rect x={50} y={30} width={62} height={36} rx={14} fill="#DCE8CE" stroke="#344B50" strokeWidth={2.5} />
            <path d="M68 48 l6 6 l12 -13" fill="none" stroke="#344B50" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <p className="replies__empty-title">Your reply options will appear here.</p>
          <p className="muted">After the patient speaks or types, you’ll see two or three suggestions to choose, edit or refuse. A gesture can inform them but cannot approve them.</p>
        </div>
      )}

      {proposal && phase !== "fusing" && !confirmed && (heard || proposal.fusion.intent) && proposal.state === "pending" && (
        <div className="inferred">
          {heard && (
            <p className="inferred__row">
              <Ear size={18} aria-hidden /> <span className="inferred__label">Heard</span> <span className="inferred__value" lang={langFor(heard)}>“{heard}”</span>
            </p>
          )}
          {proposal.fusion.intent && !proposal.fusion.clarificationRequired && (
            <p className="inferred__row">
              <Lightbulb size={18} aria-hidden /> <span className="inferred__label">Suggested meaning</span> <span className="inferred__value">{humanIntent(proposal.fusion.intent)}</span>
            </p>
          )}
        </div>
      )}

      {proposal && phase !== "fusing" && (
        <AnimatePresence mode="popLayout" initial={false}>
          {confirmed ? (
            <ConfirmedCard key={`c-${confirmed.id}`} message={confirmed} ctl={ctl} />
          ) : proposal.state === "rejected" ? (
            <motion.div key="rejected" variants={popVariants} initial="hidden" animate="shown" exit="exit">
              <Notice tone="neutral" title="Suggestions rejected. Nothing was spoken.">
                Ask for new suggestions, repeat the answer, or type the exact words.
              </Notice>
              <div className="actions">
                <Button icon={<RotateCcw size={20} />} onClick={() => void fuse()} disabled={!live || busy}>Try again with new suggestions</Button>
                <Button variant="secondary" onClick={onRepeat} disabled={!live}>Repeat the answer</Button>
                <Button variant="secondary" onClick={onTypeInstead} disabled={!live}>Type instead</Button>
              </div>
            </motion.div>
          ) : proposal.state === "clarification_requested" ? (
            <motion.div key="clar" variants={popVariants} initial="hidden" animate="shown" exit="exit">
              <Notice tone="info" title="Clarification requested. Nothing was spoken.">
                Ask the patient to repeat or show what they mean, or type it.
              </Notice>
              <div className="actions">
                <Button onClick={onRepeat} disabled={!live}>Repeat the answer</Button>
                <Button variant="secondary" onClick={onTypeInstead} disabled={!live}>Type instead</Button>
                <Button variant="secondary" icon={<RotateCcw size={20} />} onClick={() => void fuse()} disabled={!live || busy}>Try again</Button>
              </div>
            </motion.div>
          ) : review?.kind === "candidate" ? (
            <motion.div key="review" className="review-card review-card--suggested" layoutId="message-surface" {...surface}>
              <Kind kind="suggested" />
              <p className="review-card__label">You will say exactly:</p>
              <ExactText text={proposal.fusion.candidateReplies[review.index]} />
              <p className="muted small">It will not play until you press Play on the next step.</p>
              <div className="actions">
                <Button variant="confirm" size="lg" icon={<Check size={22} />} loading={busy} disabled={!live} onClick={() => void confirmCandidate(proposal, review.index)}>
                  Confirm these exact words
                </Button>
                <Button variant="secondary" icon={<Pencil size={20} />} disabled={!live} onClick={() => startEdit(proposal, proposal.fusion.candidateReplies[review.index])}>
                  Edit first
                </Button>
                <Button variant="quiet" icon={<ChevronLeft size={20} />} onClick={() => setReview(null)}>Back to suggestions</Button>
              </div>
            </motion.div>
          ) : review?.kind === "edit" ? (
            <motion.div key="edit" className="review-card review-card--edited" variants={popVariants} initial="hidden" animate="shown" exit="exit">
              <Kind kind="edited" />
              <TextArea
                label="Edit the message"
                hint="Write exactly what should be said. You’ll see a preview before confirming."
                value={editText}
                maxChars={MAX_EDIT}
                error={editError}
                rows={3}
                onChange={(e) => dispatch({ type: "draft/edit", text: e.target.value })}
                autoFocus
              />
              <div className="actions">
                <Button onClick={reviewEdit} disabled={!live}>Review edited message</Button>
                <Button variant="quiet" icon={<ChevronLeft size={20} />} onClick={() => setReview(null)}>Back to suggestions</Button>
              </div>
            </motion.div>
          ) : review?.kind === "edit-review" ? (
            <motion.div key="edit-review" className="review-card review-card--edited" layoutId="message-surface" {...surface}>
              <Kind kind="edited" />
              <p className="review-card__label">You will say exactly (edited):</p>
              <ExactText text={editText.trim()} />
              <div className="actions">
                <Button variant="confirm" size="lg" icon={<Check size={22} />} loading={busy} disabled={!live} onClick={() => void confirmEdit(proposal)}>
                  Confirm these exact words
                </Button>
                <Button variant="secondary" icon={<Pencil size={20} />} onClick={() => setReview({ kind: "edit" })}>Keep editing</Button>
              </div>
            </motion.div>
          ) : (
            <motion.div key="choices" variants={popVariants} initial="hidden" animate="shown" exit="exit">
              {proposal.fusion.clarificationRequired && (
                <Notice tone="info" title={proposal.clarificationMessage ?? "I did not understand - please choose, repeat or clarify."}>
                  The assistant did not guess. {proposal.fusion.candidateReplies.length ? "You can still choose one of these, or" : "You can"} repeat, type, or ask to clarify.
                </Notice>
              )}
              {proposal.fusion.candidateReplies.length > 0 && (
                <ol className="reply-list" aria-label="Suggested replies. Choosing one shows a review step; nothing is spoken yet.">
                  {proposal.fusion.candidateReplies.map((text, i) => (
                    <motion.li
                      key={`${proposal.id}-${i}`}
                      initial={calm ? false : { opacity: 0, x: 12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.3, delay: calm ? 0 : i * 0.07, ease: [0.22, 1, 0.36, 1] }}
                    >
                      <button type="button" className="reply" disabled={!live} onClick={() => setReview({ kind: "candidate", index: i })}>
                        <span className="reply__num" aria-hidden>{i + 1}</span>
                        <span className="reply__text" lang={langFor(text)}>{text}</span>
                        <span className="reply__hint" aria-hidden>Review</span>
                      </button>
                    </motion.li>
                  ))}
                </ol>
              )}
              <div className="reply-tools">
                <Button variant="secondary" icon={<Pencil size={20} />} disabled={!live} onClick={() => startEdit(proposal)}>
                  {proposal.fusion.candidateReplies.length ? "Edit a reply" : "Write my own"}
                </Button>
                <Button variant="secondary" icon={<ThumbsDown size={20} />} disabled={!live || busy} onClick={() => void decide("reject", proposal)}>
                  None of these
                </Button>
                {proposal.fusion.candidateReplies.length > 0 && (
                  <Button variant="secondary" icon={<RefreshCw size={20} />} disabled={!live || busy} onClick={() => void regenerate(proposal)}>
                    Suggest different replies
                  </Button>
                )}
                <Button variant="secondary" icon={<HelpCircle size={20} />} disabled={!live || busy} onClick={() => void decide("clarify", proposal)}>
                  Ask to clarify
                </Button>
                <Button variant="quiet" onClick={onRepeat} disabled={!live}>Repeat</Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}

      {proposal && <EvidenceDetails proposal={proposal} />}
    </section>
  );
}

function ProposalState({ proposal }: { proposal: Proposal }) {
  const map: Record<Proposal["state"], [Parameters<typeof StatusBadge>[0]["tone"], string]> = {
    pending: ["pending", proposal.fusion.clarificationRequired ? "Needs clarification · not spoken" : "Waiting for your choice · not spoken"],
    confirmed: ["success", "Confirmed (selected)"],
    edited_confirmed: ["success", "Confirmed (edited)"],
    rejected: ["neutral", "Rejected · not spoken"],
    clarification_requested: ["info", "Clarification requested · not spoken"],
  };
  const [tone, text] = map[proposal.state];
  return <StatusBadge tone={tone === "pending" ? "neutral" : tone}>{text}</StatusBadge>;
}

function EvidenceDetails({ proposal }: { proposal: Proposal }) {
  const services = useServices();
  const ev = proposal.evidence;
  return (
    <Disclosure summary="Why these suggestions? Evidence and timing">
      <dl className="evidence">
        <div>
          <dt>Patient transcript (as heard)</dt>
          <dd lang={langFor(ev?.transcript)}>{ev?.transcript || "— (nothing heard)"}</dd>
        </div>
        <div>
          <dt>Recent conversation used</dt>
          <dd>
            {ev?.conversation_context?.length ? (
              <ul className="evidence__context">
                {ev.conversation_context.map((c, i) => (
                  <li key={i}>
                    <strong>{c.speaker === "patient" ? "Patient" : "Partner"}:</strong> <span lang={langFor(c.text)}>{c.text}</span>
                  </li>
                ))}
              </ul>
            ) : (
              "None"
            )}
          </dd>
        </div>
        <div>
          <dt>Visual cues used</dt>
          <dd>
            {ev?.visual_cues?.gesture
              ? `Stable gesture ${ev.visual_cues.gesture.label.replace(/_/g, " ")}${ev.visual_cues.gesture.meaning ? ` (your meaning: “${ev.visual_cues.gesture.meaning}”)` : " (no meaning set)"}`
              : "No stable gesture"}
            {" · "}Mouth activity: {ev?.visual_cues?.mouth_activity ? "yes" : "no"} · Head nod: {ev?.visual_cues?.head_nod ? "yes" : "no"}
          </dd>
        </div>
        <div>
          <dt>Interpretation</dt>
          <dd>
            {proposal.fusion.reasoningSummary || "—"} <span className="muted">(intent label: {proposal.fusion.intent})</span>
          </dd>
        </div>
        <div>
          <dt>Suggestion time</dt>
          <dd>
            {formatMs(proposal.stageMs)} {services.mode === "mock" && <SimulatedTag>Simulated delay</SimulatedTag>}
          </dd>
        </div>
      </dl>
      <p className="muted small">The assistant’s choice of suggestions is not a measure of certainty. It never diagnoses, reads emotions or lip-reads words.</p>
    </Disclosure>
  );
}

// ------------------------------------------------------------------------------------------------
function ConfirmedCard({ message, ctl }: { message: ConfirmedMessage; ctl: Ctl }) {
  const services = useServices();
  const { state } = ctl;
  const { status, subtitle, error, speakable, play, stop, statusText } = usePlayback(message);
  const playRef = useRef<HTMLButtonElement>(null);
  const [large, setLarge] = useState(false);
  const voice = state.session?.voice ?? null;
  const textOnly = !voice && services.mode !== "mock";
  const simulatedVoice = !voice && services.mode === "mock";

  // Focus the Play control after confirming: playback still waits for the person to press it.
  useEffect(() => playRef.current?.focus({ preventScroll: true }), []);

  const shown = subtitle ?? message.text;

  return (
    <motion.div className={`confirmed-card${status === "playing" ? " is-playing" : ""}`} layoutId="message-surface" {...surface}>
      <div className="confirmed-card__meta">
        <ConfirmTick />
        <StatusBadge tone="success">{message.how === "edited" ? "Confirmed by you · edited" : "Confirmed by you · selected"}</StatusBadge>
        {simulatedVoice && <SimulatedTag>Simulated voice (browser)</SimulatedTag>}
        {voice && <span className="muted small">Voice: {voice.persona === "designed_voice" ? "designed voice (not a clone)" : voice.persona === "cloned_voice" ? "your personal voice" : "default voice"}</span>}
      </div>
      <p className={`subtitle${status === "playing" ? " is-playing" : ""}`} lang={langFor(shown)}>
        {shown}
      </p>
      {textOnly ? (
        <>
          <Notice tone="info" title="No voice is set up, so this is shown as text.">Show it to your partner, or set up a voice for future messages.</Notice>
          <div className="actions">
            <Button icon={<Expand size={20} />} onClick={() => setLarge(true)} ref={playRef}>Show large to partner</Button>
          </div>
        </>
      ) : (
        <>
          <Waveform active={status === "playing"} bars={30} className="confirmed-card__wave" />
          <div className="playback" role="group" aria-label="Playback">
            {status === "playing" ? (
              <Button variant="primary" size="lg" icon={<Square size={20} />} onClick={stop} aria-label="Stop playback">Stop</Button>
            ) : (
              <Button
                ref={playRef}
                variant="confirm"
                size="lg"
                icon={status === "played" || status === "stopped" ? <RotateCcw size={22} /> : <Play size={22} />}
                loading={status === "loading"}
                onClick={() => void play()}
                disabled={!speakable}
                aria-label={status === "played" || status === "stopped" ? `Replay: ${message.text}` : `Play: ${message.text}`}
              >
                {status === "played" || status === "stopped" ? "Replay" : "Play"}
              </Button>
            )}
            <Button variant="secondary" icon={<Expand size={20} />} onClick={() => setLarge(true)}>Show large</Button>
            <span className="playback__status" role="status">
              <Volume2 size={18} aria-hidden /> {statusText}
            </span>
          </div>
        </>
      )}
      {error && <p className="field__error" role="alert">{error}</p>}
      {playbackMode(null) === "simulated" && simulatedVoice && <p className="muted small">No speech engine in this browser: playback is timed silently.</p>}
      <Dialog open={large} onClose={() => setLarge(false)} title="Message for your partner">
        <p className="subtitle subtitle--huge" lang={langFor(shown)}>{shown}</p>
      </Dialog>
    </motion.div>
  );
}
