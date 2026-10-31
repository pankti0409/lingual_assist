import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { BadgeArt } from "@/art/Badge";
import { useCalm } from "@/lib/motion";
import { useJourney } from "@/state/journey";

/**
 * A small, optional note when a badge is earned — no confetti, no sound. It never takes focus,
 * never blocks the screen and stays until closed. Turned off entirely by the "Celebrations" setting.
 */
export function Celebration() {
  const { celebrations, dismissCelebration } = useJourney();
  const calm = useCalm();
  const current = celebrations[0] ?? null;

  return (
    <div className="celebrate-layer" role="status" aria-live="polite">
      <AnimatePresence>
        {current && (
          <motion.div
            key={current.id}
            className="celebrate"
            initial={calm ? false : { opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, transition: { duration: 0.12 } }}
            transition={{ type: "spring", stiffness: 420, damping: 30 }}
          >
            <div className="celebrate__badge">
              <motion.span initial={calm ? false : { rotate: -12, scale: 0.6 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 20 }}>
                <BadgeArt achievement={current} earned size={76} />
              </motion.span>
            </div>
            <div className="celebrate__text">
              <p className="celebrate__eyebrow">Nice — a new badge</p>
              <p className="celebrate__title">{current.title}</p>
              <p className="celebrate__body">{current.text}</p>
              <Link to="/journey" className="celebrate__link" onClick={() => dismissCelebration(current.id)}>See your badges</Link>
            </div>
            <button type="button" className="btn btn--secondary btn--md celebrate__close" onClick={() => dismissCelebration(current.id)}>
              <X size={18} aria-hidden /> <span>Close</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
