import { CheckCircle2, Keyboard, Mic, PenLine, RotateCcw, Volume2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef } from "react";
import type { ConfirmedMessage, PartialTranscript, Proposal, Turn } from "@/api/types";
import { langFor } from "@/lib/dom";
import { useCalm } from "@/lib/motion";
import { usePlayback } from "@/state/usePlayback";

const SPEAKER: Record<Turn["speaker"], string> = { patient: "Patient", partner: "Partner" };

/** Committed turns only. The partial transcript is rendered separately and is never part of this list. */
export function TranscriptList({ turns, emptyText = "No turns yet." }: { turns: Turn[]; emptyText?: string }) {
  if (!turns.length) return <p className="transcript__empty">{emptyText}</p>;
  return (
    <ol className="transcript" aria-label="Conversation transcript">
      {turns.map((t) => (
        <li key={t.id} className={`turn turn--${t.speaker}`}>
          <span className="turn__who">
            <span className="turn__speaker">{SPEAKER[t.speaker]}</span>
            <span className="turn__src">
              {t.source === "typed" ? <Keyboard size={14} aria-hidden /> : <Mic size={14} aria-hidden />}
              {t.source === "typed" ? "typed" : "spoken"}
            </span>
          </span>
          <span className="turn__text" lang={langFor(t.text)}>{t.text}</span>
        </li>
      ))}
    </ol>
  );
}

function SaidAgain({ message }: { message: ConfirmedMessage }) {
  const { status, play, stop, speakable } = usePlayback(message);
  if (!speakable || (status !== "played" && status !== "stopped" && status !== "playing")) return null;
  return status === "playing" ? (
    <button type="button" className="bubble__action" onClick={stop}>Stop</button>
  ) : (
    <button type="button" className="bubble__action" onClick={() => void play()} aria-label={`Say again: ${message.text}`}>
      <RotateCcw size={15} aria-hidden /> Say again
    </button>
  );
}

function ConfirmedBubble({ message, playback }: { message: ConfirmedMessage; playback: string }) {
  const spoken = playback === "played" || playback === "playing" || playback === "stopped";
  return (
    <div className={`bubble bubble--confirmed${spoken ? " is-spoken" : ""}`}>
      <span className="bubble__meta">
        {spoken ? <Volume2 size={15} aria-hidden /> : <CheckCircle2 size={15} aria-hidden />}
        <span className="bubble__state">{spoken ? "Spoken" : "Confirmed"}</span>
        {message.how === "edited" && (
          <span className="bubble__how"><PenLine size={14} aria-hidden /> your words</span>
        )}
      </span>
      <span className="bubble__text" lang={langFor(message.text)}>{message.text}</span>
      <SaidAgain message={message} />
    </div>
  );
}

/**
 * The live conversation timeline: committed turns, with each confirmed reply placed right after the
 * turn it answers. Suggestions never appear here — only what someone said or confirmed.
 */
export function Timeline({
  turns,
  confirmed,
  proposals,
  playback,
  partial,
  emptyText,
}: {
  turns: Turn[];
  confirmed: ConfirmedMessage[];
  proposals: Proposal[];
  playback: Record<string, string>;
  partial: PartialTranscript | null;
  emptyText: string;
}) {
  const calm = useCalm();
  const boxRef = useRef<HTMLDivElement>(null);
  const byTurn = new Map<string, ConfirmedMessage[]>();
  for (const m of confirmed) {
    const turnId = proposals.find((p) => p.id === m.proposalId)?.turnId;
    if (!turnId) continue;
    byTurn.set(turnId, [...(byTurn.get(turnId) ?? []), m]);
  }

  // Keep the newest item in view inside the timeline itself (the page never jumps).
  useEffect(() => {
    const box = boxRef.current;
    if (box && box.scrollHeight > box.clientHeight) box.scrollTo?.({ top: box.scrollHeight, behavior: calm ? "auto" : "smooth" });
  }, [turns.length, confirmed.length, !!partial, calm]);

  return (
    <div className="timeline" ref={boxRef} tabIndex={0} role="region" aria-label="Conversation timeline">
      {turns.length ? (
        <ol className="timeline__list" aria-label="Conversation transcript">
          <AnimatePresence initial={false}>
            {turns.map((t) => {
              const replies = byTurn.get(t.id) ?? [];
              // A quick expression is typed and confirmed word for word: show it once, as confirmed.
              const merged = t.speaker === "patient" && t.source === "typed" && replies.length === 1 && replies[0].text === t.text;
              return (
                <motion.li
                  key={t.id}
                  className={`tl-item tl-item--${t.speaker}`}
                  initial={calm ? false : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                >
                  <span className="tl-item__who">
                    <span className={`avatar avatar--${t.speaker}`} aria-hidden>{t.speaker === "patient" ? "Pt" : "Pa"}</span>
                    <span className="turn__speaker">{SPEAKER[t.speaker]}</span>
                    <span className="turn__src">
                      {t.source === "typed" ? <Keyboard size={14} aria-hidden /> : <Mic size={14} aria-hidden />}
                      {t.source === "typed" ? "typed" : "spoken"}
                    </span>
                  </span>
                  {!merged && (
                    <span className={`bubble bubble--${t.speaker}`}>
                      <span className="bubble__text" lang={langFor(t.text)}>{t.text}</span>
                    </span>
                  )}
                  {replies.map((m) => (
                    <ConfirmedBubble key={m.id} message={m} playback={playback[m.id] ?? "idle"} />
                  ))}
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ol>
      ) : (
        !partial && <p className="timeline__empty">{emptyText}</p>
      )}
      <PartialLine partial={partial} />
    </div>
  );
}

export function PartialLine({ partial }: { partial: PartialTranscript | null }) {
  if (!partial) return null;
  return (
    <div className={`partial partial--${partial.speaker}`} aria-live="off">
      <span className="partial__label">
        <span className="partial__dots" aria-hidden><span /><span /><span /></span>
        {SPEAKER[partial.speaker]} · still listening (not saved)
      </span>
      <span className="partial__text" lang={langFor(partial.text)}>{partial.text}</span>
    </div>
  );
}
