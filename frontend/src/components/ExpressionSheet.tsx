import { Check, Expand, Play, RotateCcw, Settings2, Square } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useServices } from "@/api/ServicesProvider";
import type { ConfirmedMessage } from "@/api/types";
import { categoryOf, type Expression } from "@/lib/expressions";
import { langFor } from "@/lib/dom";
import { popVariants, useCalm } from "@/lib/motion";
import { usePreferences } from "@/state/preferences";
import { usePlayback } from "@/state/usePlayback";
import { useQuickSay } from "@/state/useQuickSay";
import { Button, ButtonLink } from "./Button";
import { Dialog } from "./Dialog";
import { Pictogram } from "./ExpressionTile";
import { Notice, SimulatedTag, StatusBadge } from "./Status";
import { Waveform } from "./Waveform";

/** Animated tick drawn once when a message is confirmed (static under reduced motion). */
export function ConfirmTick() {
  const calm = useCalm();
  return (
    <svg className="confirm-tick" viewBox="0 0 48 48" width={48} height={48} aria-hidden>
      <motion.circle cx={24} cy={24} r={21} initial={calm ? false : { scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 380, damping: 18 }} />
      <motion.path d="M14 25 l7 7 l13 -15" initial={calm ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.35, delay: 0.12 }} />
    </svg>
  );
}

function Confirmed({ message, autoPlay }: { message: ConfirmedMessage; autoPlay: boolean }) {
  const services = useServices();
  const { status, subtitle, error, speakable, play, stop, statusText } = usePlayback(message);
  const playRef = useRef<HTMLButtonElement>(null);
  const started = useRef(false);
  const shown = subtitle ?? message.text;

  useEffect(() => playRef.current?.focus({ preventScroll: true }), []);
  useEffect(() => {
    // Only when the person chose this in Settings — and only after their own confirm press.
    if (autoPlay && !started.current) {
      started.current = true;
      void play();
    }
  }, [autoPlay, play]);

  return (
    <motion.div className="sheet-confirmed" variants={popVariants} initial="hidden" animate="shown">
      <div className="sheet-confirmed__head">
        <ConfirmTick />
        <StatusBadge tone="success">Confirmed by you</StatusBadge>
        {services.mode === "mock" && <SimulatedTag>Simulated voice (browser)</SimulatedTag>}
      </div>
      <p className={`subtitle${status === "playing" ? " is-playing" : ""}`} lang={langFor(shown)}>{shown}</p>
      <Waveform active={status === "playing"} bars={28} className="sheet-confirmed__wave" />
      <div className="actions">
        {status === "playing" ? (
          <Button size="lg" icon={<Square size={20} />} onClick={stop}>Stop</Button>
        ) : (
          <Button
            ref={playRef}
            variant="confirm"
            size="lg"
            icon={status === "played" || status === "stopped" ? <RotateCcw size={22} /> : <Play size={22} />}
            loading={status === "loading"}
            disabled={!speakable}
            onClick={() => void play()}
            aria-label={status === "played" || status === "stopped" ? `Replay: ${message.text}` : `Play: ${message.text}`}
          >
            {status === "played" || status === "stopped" ? "Replay" : "Play"}
          </Button>
        )}
        <span className="playback__status" role="status">{statusText}</span>
      </div>
      {error && <p className="field__error" role="alert">{error}</p>}
    </motion.div>
  );
}

/** Review → confirm → play, for one quick expression. Nothing is spoken before "Confirm". */
export function ExpressionSheet({ expression, onClose }: { expression: Expression | null; onClose: () => void }) {
  const { prefs, addRecent } = usePreferences();
  const quick = useQuickSay();
  const [confirmed, setConfirmed] = useState<ConfirmedMessage | null>(null);
  const [large, setLarge] = useState(false);
  const last = useRef<Expression | null>(null);
  if (expression) last.current = expression;
  const ex = expression ?? last.current;

  useEffect(() => {
    setConfirmed(null);
    setLarge(false);
    quick.clearError();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expression?.id]);

  if (!ex) return null;
  const cat = categoryOf(ex.category);

  async function onConfirm() {
    const res = await quick.confirm(ex!.text);
    if (res) {
      setConfirmed(res);
      addRecent(ex!.id);
    }
  }

  return (
    <Dialog open={!!expression} onClose={onClose} title={confirmed ? "Ready to say" : "Say this?"}>
      <AnimatePresence mode="wait" initial={false}>
        {large ? (
          <motion.div key="large" variants={popVariants} initial="hidden" animate="shown" exit="exit">
            <p className="subtitle subtitle--huge" lang={langFor(ex.text)}>{ex.text}</p>
            <Button variant="secondary" onClick={() => setLarge(false)}>Back</Button>
          </motion.div>
        ) : confirmed ? (
          <Confirmed key="done" message={confirmed} autoPlay={prefs.playAfterExpressionConfirm} />
        ) : (
          <motion.div key="review" className="sheet-review" variants={popVariants} initial="hidden" animate="shown" exit="exit">
            <div className="sheet-review__who">
              <Pictogram icon={ex.icon} accent={cat.accent} size="lg" />
              <span className="eyebrow">{ex.custom ? "Your expression" : cat.label}</span>
            </div>
            <p className="review-card__label">You will say exactly:</p>
            <blockquote className="exact" lang={langFor(ex.text)}>{ex.text}</blockquote>
            {ex.category === "emergency" && (
              <Notice tone="warning" title="This speaks the words aloud. It does not call anyone.">
                Lingual Assist cannot contact emergency services or a carer. Use your usual alarm or phone for that.
              </Notice>
            )}
            {quick.error && <Notice tone="danger" title="That didn’t work">{quick.error.message} Nothing was spoken.</Notice>}
            {quick.live ? (
              <>
                <p className="muted small">
                  {prefs.playAfterExpressionConfirm
                    ? "After you confirm, it plays straight away (you chose this in Settings)."
                    : "After you confirm, press Play to say it."}
                </p>
                <div className="actions">
                  <Button variant="confirm" size="lg" icon={<Check size={22} />} loading={quick.busy} onClick={() => void onConfirm()}>
                    Confirm these exact words
                  </Button>
                  <Button variant="secondary" icon={<Expand size={20} />} onClick={() => setLarge(true)}>Show large</Button>
                </div>
              </>
            ) : (
              <>
                <Notice tone="info" title="Start a session to say this aloud">
                  You can still show it large on screen to the person you’re talking with.
                </Notice>
                <div className="actions">
                  <Button icon={<Expand size={20} />} onClick={() => setLarge(true)}>Show large</Button>
                  <ButtonLink to="/setup" variant="secondary" icon={<Settings2 size={20} />} onClick={onClose}>Set up a session</ButtonLink>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </Dialog>
  );
}
