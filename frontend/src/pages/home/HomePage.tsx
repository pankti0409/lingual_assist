import { Link } from "@tanstack/react-router";
import { ArrowRight, AudioLines, Check, ChevronRight, Keyboard, LayoutGrid, MessageCircle, SlidersHorizontal } from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useState, type ReactNode } from "react";
import { BadgeArt } from "@/art/Badge";
import { Mascot } from "@/art/Mascot";
import { ButtonLink } from "@/components/Button";
import { ExpressionSheet } from "@/components/ExpressionSheet";
import { ExpressionTile } from "@/components/ExpressionTile";
import { ProgressBar } from "@/components/ProgressBar";
import { StatusBadge } from "@/components/Status";
import { allExpressions, type Expression } from "@/lib/expressions";
import { langFor, useDocumentTitle } from "@/lib/dom";
import { useCalm } from "@/lib/motion";
import { ACHIEVEMENTS, MILESTONES, useJourney } from "@/state/journey";
import { usePreferences } from "@/state/preferences";
import { useSession } from "@/state/session";
import { PLAYBACK_TEXT } from "@/state/usePlayback";

function greeting(d = new Date()) {
  const h = d.getHours();
  if (h < 5) return "Hello";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/** A short, gentle entrance for each section; content is fully present without motion. */
function Section({ className, children, delay = 0, label }: { className: string; children: ReactNode; delay?: number; label: string }) {
  const calm = useCalm();
  return (
    <motion.section
      className={className}
      aria-labelledby={label}
      initial={calm ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1], delay }}
    >
      {children}
    </motion.section>
  );
}

function StartCard() {
  const { state } = useSession();
  const active = state.status === "active";
  return (
    <div className="start-card">
      <div className="start-card__copy">
        <p className="start-card__eyebrow">{active ? "Your session is open" : "Ready when you are"}</p>
        <h2 id="start-h" className="start-card__title">{active ? "Carry on talking" : "Start a conversation"}</h2>
        <p className="start-card__text">
          {active
            ? `${state.turns.length} turn${state.turns.length === 1 ? "" : "s"} so far. Pick up where you left off.`
            : "Speak, type or use a gesture. You check every word before anything is said aloud."}
        </p>
        <div className="actions">
          {active ? (
            <ButtonLink to="/conversation" variant="confirm" size="lg" iconEnd={<ArrowRight size={22} />}>Continue conversation</ButtonLink>
          ) : (
            <>
              <ButtonLink to="/setup" variant="confirm" size="lg" iconEnd={<ArrowRight size={22} />}>Start Conversation</ButtonLink>
              <ButtonLink to="/conversation" search={{ scenario: "water" }} variant="ghost-light" icon={<Keyboard size={20} />}>Try a sample</ButtonLink>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const SHORTCUTS = [
  { to: "/expressions", title: "Communication board", text: "Ready-made phrases, one tap away", icon: LayoutGrid, tone: "butter" },
  { to: "/voice", title: "Voice settings", text: "How your messages sound", icon: AudioLines, tone: "lilac" },
  { to: "/settings", title: "Text size & comfort", text: "Bigger text, bigger buttons", icon: SlidersHorizontal, tone: "peach" },
] as const;

function RecentCard() {
  const { state } = useSession();
  const recent = [...state.confirmed].reverse().slice(0, 3);
  return (
    <div className="recent-card">
      <div className="card-head">
        <h2 id="recent-h" className="h3"><MessageCircle size={22} aria-hidden /> Recent conversation</h2>
        {(state.status === "active" || state.status === "ended") && <Link to="/review" className="text-link">See all</Link>}
      </div>
      {recent.length ? (
        <ol className="recent-list">
          {recent.map((m) => (
            <li key={m.id}>
              <span className="recent-list__text" lang={langFor(m.text)}>{m.text}</span>
              <span className="recent-list__meta">
                <StatusBadge tone="success">{m.how === "edited" ? "Confirmed · your words" : "Confirmed"}</StatusBadge>
                <span className="muted small">{PLAYBACK_TEXT[state.playback[m.id] ?? "idle"]}</span>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="empty-note">Messages you confirm will appear here. They are kept only for the current session.</p>
      )}
    </div>
  );
}

function ProgressCard() {
  const journey = useJourney();
  const earned = ACHIEVEMENTS.filter((a) => journey.earned(a.id));
  const latest = [...earned].sort((a, b) => (journey.unlocked[b.id] ?? "").localeCompare(journey.unlocked[a.id] ?? ""))[0];
  return (
    <div className="progress-card">
      <div className="card-head">
        <h2 id="progress-h" className="h3">Getting started</h2>
        <Link to="/journey" className="text-link">Badges</Link>
      </div>
      <ProgressBar value={journey.progress.done} total={journey.progress.total} label="Optional steps done" />
      <ul className="step-list">
        {MILESTONES.map((m) => {
          const done = journey.done(m.id);
          return (
            <li key={m.id} className={done ? "is-done" : undefined}>
              <span className="step-list__mark" aria-hidden>{done ? <Check size={16} strokeWidth={3} /> : null}</span>
              {done ? (
                <span><span className="sr-only">Done: </span>{m.title}</span>
              ) : (
                <Link to={m.to} className="step-list__link">
                  <span className="sr-only">Not done yet: </span>{m.title} <ChevronRight size={16} aria-hidden />
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      {latest ? (
        <div className="latest-badge">
          <BadgeArt achievement={latest} earned size={52} />
          <p><span className="muted small">Latest badge</span><br /><strong>{latest.title}</strong></p>
        </div>
      ) : (
        <p className="muted small">All optional — everything works without these.</p>
      )}
    </div>
  );
}

export function HomePage() {
  useDocumentTitle("");
  const { prefs } = usePreferences();
  const { state } = useSession();
  const journey = useJourney();
  const [sheet, setSheet] = useState<Expression | null>(null);
  const all = useMemo(() => allExpressions(prefs.customExpressions), [prefs.customExpressions]);
  const pick = (ids: string[]) => ids.map((id) => all.find((e) => e.id === id)).filter((e): e is Expression => !!e);
  const favourites = pick(prefs.favourites).slice(0, 8);
  const recentlyUsed = pick(prefs.recentExpressions).slice(0, 4);
  const now = new Date();
  const name = prefs.name.trim();
  const showProgress = journey.enabled && !prefs.simplified;

  return (
    <div className="page home">
      <div className="home-top">
        <Section className="greeting" label="greet-h">
          <Mascot size={112} />
          <p className="greeting__date">{now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</p>
          <h1 id="greet-h" className="display-1">
            {greeting(now)}
            {name ? <>, <span className="greeting__name">{name}</span></> : null}.
          </h1>
          <p className="lede">{state.status === "active" ? "Your communication space is ready." : "What would you like to say today? Take your time."}</p>
          <p className="promise-pill" role="note">
            <Check size={18} aria-hidden /> Nothing is spoken until you confirm it.
          </p>
          {!name && <Link to="/settings" className="text-link small">Add your name for a personal greeting</Link>}
        </Section>
        <Section className="home-start" label="start-h" delay={0.05}>
          <StartCard />
        </Section>
      </div>

      <nav className="shortcuts" aria-label="Shortcuts">
        <ul>
          {SHORTCUTS.map((s) => (
            <li key={s.to}>
              <Link to={s.to} className={`shortcut shortcut--${s.tone}`}>
                <span className="shortcut__icon" aria-hidden><s.icon size={26} /></span>
                <span className="shortcut__text">
                  <span className="shortcut__title">{s.title}</span>
                  <span className="shortcut__sub">{s.text}</span>
                </span>
                <ChevronRight size={22} aria-hidden className="shortcut__chev" />
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <Section className="home-quick" label="quick-h" delay={0.1}>
        <div className="section-head">
          <div>
            <p className="eyebrow">Tap, check, then confirm</p>
            <h2 id="quick-h" className="h2">Your favourite expressions</h2>
          </div>
          <ButtonLink to="/expressions" variant="secondary" icon={<LayoutGrid size={20} />}>Open the board</ButtonLink>
        </div>
        {favourites.length ? (
          <ul className="quick-row">
            {favourites.map((e) => (
              <li key={e.id}>
                <ExpressionTile expression={e} compact onSay={setSheet} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-note">Press “Add to favourites” on the board to keep expressions here.</p>
        )}
        {recentlyUsed.length > 0 && (
          <div className="recently-used">
            <h3 className="h4">Recently used</h3>
            <ul className="quick-row">
              {recentlyUsed.map((e) => (
                <li key={e.id}>
                  <ExpressionTile expression={e} compact onSay={setSheet} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <div className={`home-mosaic${showProgress && prefs.showRecent ? "" : " home-mosaic--one"}`}>
        {prefs.showRecent && (
          <Section className="mosaic-recent" label="recent-h" delay={0.15}>
            <RecentCard />
          </Section>
        )}
        {showProgress && (
          <Section className="mosaic-progress" label="progress-h" delay={0.2}>
            <ProgressCard />
          </Section>
        )}
      </div>

      <ExpressionSheet expression={sheet} onClose={() => setSheet(null)} />
    </div>
  );
}
