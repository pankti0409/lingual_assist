import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { BadgeArt } from "@/art/Badge";
import { useCalm } from "@/lib/motion";
import { useJourney } from "@/state/journey";

const PIECES = Array.from({ length: 14 }, (_, i) => ({
  angle: (i / 14) * Math.PI * 2 + (i % 2) * 0.2,
  dist: 70 + (i % 3) * 22,
  tone: ["teal", "butter", "lilac", "peach", "pistachio"][i % 5],
  shape: i % 3,
}));

/**
 * A small, optional celebration when a badge is earned. It never takes focus, never blocks the
 * screen and stays until closed. Turned off entirely by the "Celebrations" setting.
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
              {!calm && (
                <span className="burst" aria-hidden>
                  {PIECES.map((p, i) => (
                    <motion.span
                      key={i}
                      className={`burst__piece burst__piece--${p.tone} burst__piece--s${p.shape}`}
                      initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
                      animate={{ x: Math.cos(p.angle) * p.dist, y: Math.sin(p.angle) * p.dist, opacity: 0, rotate: 180 }}
                      transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
                    />
                  ))}
                </span>
              )}
              <motion.span initial={calm ? false : { rotate: -12, scale: 0.6 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: "spring", stiffness: 300, damping: 14 }}>
                <BadgeArt achievement={current} earned size={76} />
              </motion.span>
            </div>
            <div className="celebrate__text">
              <p className="celebrate__eyebrow">New badge</p>
              <p className="celebrate__title">{current.title}</p>
              <p className="celebrate__body">{current.text}</p>
              <Link to="/journey" className="celebrate__link" onClick={() => dismissCelebration(current.id)}>See your journey</Link>
            </div>
            <button type="button" className="icon-btn celebrate__close" aria-label={`Close: ${current.title} badge`} onClick={() => dismissCelebration(current.id)}>
              <X size={20} aria-hidden />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
