import { Link } from "@tanstack/react-router";
import { ArrowRight, Check } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { BadgeArt, JOURNEY_ICONS } from "@/art/Badge";
import { C, LINE } from "@/art/palette";
import { Button } from "@/components/Button";
import { ProgressRing } from "@/components/ProgressRing";
import { StatusBadge } from "@/components/Status";
import { useDocumentTitle } from "@/lib/dom";
import { popVariants, useCalm } from "@/lib/motion";
import { ACHIEVEMENTS, MILESTONES, useJourney } from "@/state/journey";
import { usePreferences } from "@/state/preferences";

/** Stop positions on the 1000 × 380 trail illustration. */
const STOPS = [
  [80, 280],
  [245, 165],
  [415, 262],
  [590, 128],
  [760, 238],
  [920, 112],
] as const;

function trailPath(points: readonly (readonly [number, number])[]) {
  return points.reduce((d, [x, y], i) => {
    if (!i) return `M${x},${y}`;
    const [px, py] = points[i - 1];
    const mx = (px + x) / 2;
    return `${d} C${mx},${py} ${mx},${y} ${x},${y}`;
  }, "");
}

function TrailArt({ doneCount }: { doneCount: number }) {
  const full = trailPath(STOPS);
  const reached = doneCount > 1 ? trailPath(STOPS.slice(0, doneCount)) : null;
  return (
    <svg className="trail__art" viewBox="0 0 1000 380" preserveAspectRatio="xMidYMid meet" aria-hidden>
      <rect width={1000} height={380} fill={C.cream100} />
      <path d="M0,300 C160,250 300,330 470,300 C640,270 780,330 1000,290 V380 H0 Z" fill={C.pistachio} />
      <path d="M0,340 C200,310 380,370 560,345 C740,320 860,360 1000,340 V380 H0 Z" fill={C.teal300} />
      <path d="M640,90 C700,40 820,40 880,80 C930,60 990,80 1000,100 V0 H600 Z" fill={C.coral100} opacity={0.7} />
      {/* small landmarks */}
      <g stroke={LINE} strokeWidth={2.5} strokeLinejoin="round">
        <path d="M150,300 l14,-40 l14,40 Z" fill={C.teal500} />
        <path d="M520,300 l10,-30 l10,30 Z" fill={C.teal500} />
        <circle cx={330} cy={95} r={22} fill={C.sand200} />
        <path d="M860,300 q8,-26 16,0" fill="none" />
      </g>
      <path d={full} fill="none" stroke={C.cream200} strokeWidth={14} strokeLinecap="round" />
      <path d={full} fill="none" stroke={C.white} strokeWidth={6} strokeLinecap="round" strokeDasharray="2 14" />
      {reached && <path d={reached} fill="none" stroke={C.teal700} strokeWidth={8} strokeLinecap="round" />}
    </svg>
  );
}

function Disabled() {
  const { set } = usePreferences();
  return (
    <div className="page journey">
      <header className="page-head">
        <p className="eyebrow">Journey</p>
        <h1 className="display-2">Your journey is switched off.</h1>
        <p className="lede">That’s completely fine. Nothing is being recorded. If you’d like milestones and badges for things you try, you can switch it on.</p>
      </header>
      <Button onClick={() => set({ journey: true }, "journey")}>Switch my journey on</Button>
    </div>
  );
}

export function JourneyPage() {
  useDocumentTitle("Your journey");
  const journey = useJourney();
  const calm = useCalm();
  const firstOpen = MILESTONES.findIndex((m) => !journey.done(m.id));
  const [selected, setSelected] = useState(firstOpen === -1 ? 0 : firstOpen);
  if (!journey.enabled) return <Disabled />;

  const m = MILESTONES[selected];
  const reachedCount = MILESTONES.filter((x) => journey.done(x.id)).length;
  // the solid line follows consecutive reached stops from the start
  let leading = 0;
  while (leading < MILESTONES.length && journey.done(MILESTONES[leading].id)) leading++;
  const earned = ACHIEVEMENTS.filter((a) => journey.earned(a.id)).length;
  const SelIcon = JOURNEY_ICONS[m.icon];

  return (
    <div className="page journey">
      <header className="page-head page-head--split">
        <div>
          <p className="eyebrow">Journey</p>
          <h1 className="display-2">Your communication journey.</h1>
          <p className="lede">Markers for things you’ve tried — at your own pace. No streaks, no scores, nothing to keep up with.</p>
        </div>
        <div className="journey-rings">
          <ProgressRing value={reachedCount} total={MILESTONES.length} label="Milestones reached" size={112} />
          <ProgressRing value={earned} total={ACHIEVEMENTS.length} label="Badges collected" size={112}>
            <span className="ring__value-text">{earned}</span>
            <span className="ring__of">badges</span>
          </ProgressRing>
        </div>
      </header>

      <section className="trail" aria-labelledby="trail-h">
        <h2 id="trail-h" className="sr-only">Milestones</h2>
        <div className="trail__map">
          <TrailArt doneCount={leading} />
          <ol className="trail__stops">
            {MILESTONES.map((x, i) => {
              const done = journey.done(x.id);
              const Icon = JOURNEY_ICONS[x.icon];
              const isNext = journey.next?.id === x.id;
              return (
                <li key={x.id} style={{ left: `${STOPS[i][0] / 10}%`, top: `${(STOPS[i][1] / 380) * 100}%` }}>
                  <motion.button
                    type="button"
                    className={`stop${done ? " is-done" : ""}${isNext ? " is-next" : ""}${selected === i ? " is-selected" : ""}`}
                    aria-pressed={selected === i}
                    aria-label={`Milestone ${i + 1} of ${MILESTONES.length}: ${x.title} — ${done ? "reached" : "not yet"}`}
                    onClick={() => setSelected(i)}
                    whileTap={calm ? undefined : { scale: 0.92 }}
                    whileHover={calm ? undefined : { y: -3 }}
                  >
                    {done ? <Check size={26} strokeWidth={3} aria-hidden /> : <Icon size={24} aria-hidden />}
                    <span className="stop__num" aria-hidden>{i + 1}</span>
                  </motion.button>
                </li>
              );
            })}
          </ol>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={m.id} className={`stop-detail${journey.done(m.id) ? " is-done" : ""}`} variants={popVariants} initial="hidden" animate="shown" exit="exit" aria-live="polite">
            <span className="stop-detail__icon" aria-hidden><SelIcon size={28} /></span>
            <div className="stop-detail__body">
              <p className="eyebrow">Milestone {selected + 1} of {MILESTONES.length}</p>
              <h3 className="h3">{m.title}</h3>
              <p>{m.text}</p>
              <p className="muted small">{m.how}</p>
            </div>
            <div className="stop-detail__side">
              {journey.done(m.id) ? <StatusBadge tone="success">Reached</StatusBadge> : <StatusBadge tone="neutral">Not yet</StatusBadge>}
              <Link to={m.to} className="text-link">Go there <ArrowRight size={16} aria-hidden /></Link>
            </div>
          </motion.div>
        </AnimatePresence>
      </section>

      <section className="shelf" aria-labelledby="shelf-h">
        <div className="section-head">
          <div>
            <p className="eyebrow">Collectible badges</p>
            <h2 id="shelf-h" className="h2">Your badge shelf</h2>
          </div>
        </div>
        <ul className="shelf__grid">
          {ACHIEVEMENTS.map((a) => {
            const got = journey.earned(a.id);
            const when = journey.unlocked[a.id];
            return (
              <li key={a.id} className={`shelf-item shelf-item--${a.tone}${got ? " is-earned" : ""}`}>
                <BadgeArt achievement={a} earned={got} size={92} />
                <h3 className="shelf-item__title">{a.title}</h3>
                <p className="shelf-item__text">{got ? a.text : a.hint}</p>
                <p className="shelf-item__meta">{got && when ? `Earned ${new Date(when).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : "Not yet"}</p>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
