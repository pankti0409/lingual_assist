import { Link } from "@tanstack/react-router";
import { ArrowRight, Check } from "lucide-react";
import { BadgeArt, JOURNEY_ICONS } from "@/art/Badge";
import { Mascot } from "@/art/Mascot";
import { Button } from "@/components/Button";
import { ProgressBar } from "@/components/ProgressBar";
import { StatusBadge } from "@/components/Status";
import { useDocumentTitle } from "@/lib/dom";
import { ACHIEVEMENTS, MILESTONES, useJourney } from "@/state/journey";
import { usePreferences } from "@/state/preferences";

function Disabled() {
  const { set } = usePreferences();
  return (
    <div className="page journey">
      <header className="page-head">
        <p className="eyebrow">Progress</p>
        <h1 className="display-2">Progress and badges are switched off.</h1>
        <p className="lede">That’s completely fine. Nothing is being recorded, and every feature works the same.</p>
      </header>
      <Button onClick={() => set({ journey: true }, "journey")}>Switch them on</Button>
    </div>
  );
}

export function JourneyPage() {
  useDocumentTitle("Progress and badges");
  const journey = useJourney();
  if (!journey.enabled) return <Disabled />;
  const earned = ACHIEVEMENTS.filter((a) => journey.earned(a.id)).length;

  return (
    <div className="page journey">
      <header className="page-head page-head--split">
        <div>
          <p className="eyebrow">Progress</p>
          <h1 className="display-2">Your progress and badges.</h1>
          <p className="lede">A few optional steps and small badges for things you’ve tried. No points, no streaks, nothing to keep up with.</p>
        </div>
        <Mascot size={120} />
      </header>

      <section className="panel steps" aria-labelledby="steps-h">
        <h2 id="steps-h" className="h3">Getting started</h2>
        <ProgressBar value={journey.progress.done} total={journey.progress.total} label="Optional steps done" />
        <ol className="step-cards">
          {MILESTONES.map((m, i) => {
            const done = journey.done(m.id);
            const Icon = JOURNEY_ICONS[m.icon];
            return (
              <li key={m.id}>
                <details className={`step-card${done ? " is-done" : ""}`} open={!done && journey.next?.id === m.id}>
                  <summary className="step-card__summary">
                    <span className="step-card__icon" aria-hidden>{done ? <Check size={22} strokeWidth={3} /> : <Icon size={22} />}</span>
                    <span className="step-card__title">
                      <span className="step-card__num">Step {i + 1}</span>
                      {m.title}
                    </span>
                    {done ? <StatusBadge tone="success">Done</StatusBadge> : <StatusBadge tone="neutral">Not yet</StatusBadge>}
                  </summary>
                  <div className="step-card__body">
                    <p>{done ? m.doneText : m.text}</p>
                    {!done && <p className="muted small">{m.how}</p>}
                    <Link to={m.to} className="text-link">{done ? "Open again" : "Show me"} <ArrowRight size={16} aria-hidden /></Link>
                  </div>
                </details>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="shelf" aria-labelledby="shelf-h">
        <div className="section-head">
          <div>
            <p className="eyebrow">{earned} of {ACHIEVEMENTS.length} collected</p>
            <h2 id="shelf-h" className="h2">Your badges</h2>
          </div>
        </div>
        <ul className="shelf__grid">
          {ACHIEVEMENTS.map((a) => {
            const got = journey.earned(a.id);
            const when = journey.unlocked[a.id];
            return (
              <li key={a.id} className={`shelf-item${got ? " is-earned" : ""}`}>
                <BadgeArt achievement={a} earned={got} size={84} />
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
