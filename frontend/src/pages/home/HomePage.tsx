import { Link } from "@tanstack/react-router";
import { useServices } from "@/api/ServicesProvider";
import { ArrowRight, AudioLines, Check, Gauge, Hand, Keyboard, LayoutGrid, MessageCircle, Play, Plus, Square, Type } from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { GesturePortrait, Vignette } from "@/art/Scenes";
import { JOURNEY_ICONS } from "@/art/Badge";
import { ButtonLink, Button } from "@/components/Button";
import { ExpressionSheet } from "@/components/ExpressionSheet";
import { ExpressionTile } from "@/components/ExpressionTile";
import { ProgressRing } from "@/components/ProgressRing";
import { StatusBadge } from "@/components/Status";
import { Waveform } from "@/components/Waveform";
import { allExpressions, type Expression } from "@/lib/expressions";
import { langFor, useDocumentTitle } from "@/lib/dom";
import { useCalm } from "@/lib/motion";
import { useJourney } from "@/state/journey";
import { usePreferences } from "@/state/preferences";
import { useSession } from "@/state/session";
import { PLAYBACK_TEXT } from "@/state/usePlayback";
import { PREVIEW_SOURCE_TEXT, useVoicePreview } from "@/state/useVoicePreview";

function greeting(d = new Date()) {
  const h = d.getHours();
  if (h < 5) return "Hello";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/** Staggered entrance for dashboard sections; content is fully present without motion. */
function Section({ className, children, delay = 0, label }: { className: string; children: React.ReactNode; delay?: number; label: string }) {
  const calm = useCalm();
  return (
    <motion.section
      className={className}
      aria-labelledby={label}
      initial={calm ? false : { opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay }}
    >
      {children}
    </motion.section>
  );
}

function StartCard() {
  const services = useServices();
  const { state } = useSession();
  const active = state.status === "active";
  return (
    <div className="start-card">
      <div className="start-card__copy">
        <p className="start-card__eyebrow">{active ? "Your session is open" : "Ready when you are"}</p>
        <h2 id="start-h" className="start-card__title">{active ? "Carry on the conversation" : <>Your words.<br /><em>At your pace.</em></>}</h2>
        <p className="start-card__text">
          {active
            ? `${state.turns.length} turn${state.turns.length === 1 ? "" : "s"} so far. Pick up where you left off.`
            : "A little space to find the words. Type or speak, review your choices, and say exactly what you mean."}
        </p>
        <div className="actions">
          {active ? (
            <ButtonLink to="/conversation" variant="confirm" size="lg" iconEnd={<ArrowRight size={22} />}>Open Talk</ButtonLink>
          ) : (
            <>
              <ButtonLink to="/setup" size="lg" iconEnd={<ArrowRight size={22} />}>Start communicating</ButtonLink>
              {services.mode === "mock" && <ButtonLink to="/conversation" search={{ scenario: "water" }} variant="secondary" icon={<Keyboard size={20} />}>Try a sample</ButtonLink>}
            </>
          )}
        </div>
      </div>
      <div className="start-card__art">
        <Vignette id="friends" title="Illustration: two friends chatting at a table; one uses a tablet to reply." />
      </div>
    </div>
  );
}

function VoiceShortcut() {
  const { state } = useSession();
  const { prefs, setVoice } = usePreferences();
  const { preview, stop, playing, loading, source, error } = useVoicePreview();
  const voice = state.session?.voice ?? null;
  const speeds = [
    { label: "Gentle", value: 0.8 },
    { label: "Natural", value: 1 },
    { label: "Brisk", value: 1.2 },
  ];
  return (
    <div className="voice-shortcut">
      <div className="card-head">
        <h2 id="voice-h" className="h3"><AudioLines size={22} aria-hidden /> Your voice</h2>
        <Link to="/voice" className="text-link">Voice Studio</Link>
      </div>
      <p className="voice-shortcut__name">{voice ? voice.name : "Device voice"}</p>
      <p className="muted small">{voice ? (voice.persona === "cloned_voice" ? "Personal voice" : "Designed voice — not a clone") : "No session voice chosen yet"}</p>
      <Waveform active={playing === "home"} bars={26} className="voice-shortcut__wave" rate={prefs.voice.rate} />
      <div className="chip-row" role="group" aria-label="Speaking speed">
        <Gauge size={18} aria-hidden className="muted" />
        {speeds.map((s) => (
          <button key={s.label} type="button" className={`chip${prefs.voice.rate === s.value ? " is-on" : ""}`} aria-pressed={prefs.voice.rate === s.value} onClick={() => setVoice({ rate: s.value })}>
            {s.label}
          </button>
        ))}
      </div>
      {playing === "home" ? (
        <Button variant="secondary" icon={<Square size={18} />} onClick={stop}>Stop preview</Button>
      ) : (
        <Button variant="secondary" icon={<Play size={18} />} loading={loading === "home"} onClick={() => void preview("home", prefs.voice.previewText, voice)}>
          Preview my voice
        </Button>
      )}
      {source && playing === "home" && <p className="muted small" role="status">{PREVIEW_SOURCE_TEXT[source]}</p>}
      {error && <p className="field__error" role="alert">{error}</p>}
    </div>
  );
}

function JourneyCard() {
  const { progress, next } = useJourney();
  const Icon = next ? JOURNEY_ICONS[next.icon] : Check;
  return (
    <div className="journey-card">
      <div className="card-head">
        <h2 id="journey-h" className="h3">Your journey</h2>
        <Link to="/journey" className="text-link">See all</Link>
      </div>
      <div className="journey-card__body">
        <ProgressRing value={progress.done} total={progress.total} label="Milestones reached" size={104} />
        <div>
          {next ? (
            <>
              <p className="eyebrow">Next, if you like</p>
              <p className="journey-card__next"><Icon size={20} aria-hidden /> {next.title}</p>
              <p className="muted small">{next.text}</p>
              <Link to={next.to} className="text-link">Show me</Link>
            </>
          ) : (
            <p className="journey-card__next">Every milestone reached. Lovely.</p>
          )}
        </div>
      </div>
      <p className="muted small">No streaks, no scores — just things you might enjoy trying.</p>
    </div>
  );
}

function RecentCard() {
  const { state } = useSession();
  const recent = [...state.confirmed].reverse().slice(0, 3);
  return (
    <div className="recent-card">
      <div className="card-head">
        <h2 id="recent-h" className="h3"><MessageCircle size={22} aria-hidden /> Recently said</h2>
        {state.status !== "none" && state.status !== "deleted" && <Link to="/review" className="text-link">Review</Link>}
      </div>
      {recent.length ? (
        <ol className="recent-list">
          {recent.map((m) => (
            <li key={m.id}>
              <span className="recent-list__text" lang={langFor(m.text)}>{m.text}</span>
              <span className="recent-list__meta">
                <StatusBadge tone="success">{m.how === "edited" ? "Confirmed · edited" : "Confirmed"}</StatusBadge>
                <span className="muted small">{PLAYBACK_TEXT[state.playback[m.id] ?? "idle"]}</span>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="empty-note">Messages you confirm in this session will appear here. Nothing is kept after a session is deleted.</p>
      )}
    </div>
  );
}

const DISCOVER = [
  { to: "/gestures", title: "Teach a gesture what it means", text: "A thumbs-up can mean “yes” — or anything you decide.", icon: Hand, art: "gesture" },
  { to: "/settings", title: "Make everything bigger", text: "Larger text, larger buttons, calmer motion.", icon: Type, art: "settings" },
  { to: "/expressions", title: "Add your own expression", text: "Phrases you use every day, one tap away.", icon: Plus, art: "family" },
] as const;

export function HomePage() {
  useDocumentTitle("");
  const { prefs, toggleFavourite } = usePreferences();
  const { enabled: journeyOn } = useJourney();
  const [sheet, setSheet] = useState<Expression | null>(null);
  const all = useMemo(() => allExpressions(prefs.customExpressions), [prefs.customExpressions]);
  const favourites = prefs.favourites.map((id) => all.find((e) => e.id === id)).filter((e): e is Expression => !!e).slice(0, 8);
  const now = new Date();
  const name = prefs.name.trim();

  return (
    <div className="page home">
      <div className="home-top">
        <Section className="greeting" label="greet-h">
          <p className="greeting__date">{now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</p>
          <h1 id="greet-h" className="display-1">
            {greeting(now)}
            {name ? <>, <span className="greeting__name">{name}</span></> : null}.
          </h1>
          <p className="lede">What would you like to say today? Take your time.</p>
          <p className="promise-pill" role="note">
            <Check size={18} aria-hidden /> Nothing is spoken until you confirm it.
          </p>
          {!name && (
            <Link to="/settings" className="text-link small">Add your name for a personal greeting</Link>
          )}
        </Section>
        <Section className="home-start" label="start-h" delay={0.06}>
          <StartCard />
        </Section>
      </div>

      <Section className="home-quick" label="quick-h" delay={0.12}>
        <div className="section-head">
          <div>
            <p className="eyebrow">One tap, then confirm</p>
            <h2 id="quick-h" className="h2">Quick expressions</h2>
          </div>
          <ButtonLink to="/expressions" variant="secondary" icon={<LayoutGrid size={20} />}>Open the board</ButtonLink>
        </div>
        {favourites.length ? (
          <ul className="quick-row">
            {favourites.map((e) => (
              <li key={e.id}>
                <ExpressionTile expression={e} compact favourite onSay={setSheet} onFavourite={(x) => toggleFavourite(x.id)} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-note">Star expressions on the board to keep them here.</p>
        )}
      </Section>

      <div className={`home-mosaic${!journeyOn || prefs.simplified ? " home-mosaic--two" : ""}`}>
        <Section className="mosaic-voice" label="voice-h" delay={0.18}>
          <VoiceShortcut />
        </Section>
        {journeyOn && !prefs.simplified && (
          <Section className="mosaic-journey" label="journey-h" delay={0.22}>
            <JourneyCard />
          </Section>
        )}
        {prefs.showRecent && (
          <Section className="mosaic-recent" label="recent-h" delay={0.26}>
            <RecentCard />
          </Section>
        )}
      </div>

      {!prefs.simplified && (
        <Section className="discover" label="discover-h" delay={0.3}>
          <h2 id="discover-h" className="h2 discover__title">
            Little things <em>worth trying</em>
          </h2>
          <ul className="discover__list">
            {DISCOVER.map((d) => (
              <li key={d.to}>
                <Link to={d.to} className={`discover-card discover-card--${d.art}`}>
                  <span className="discover-card__art" aria-hidden>
                    {d.art === "gesture" ? <GesturePortrait /> : d.art === "family" ? <Vignette id="family" /> : <SettingsArt />}
                  </span>
                  <span className="discover-card__title"><d.icon size={20} aria-hidden /> {d.title}</span>
                  <span className="discover-card__text">{d.text}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <ExpressionSheet expression={sheet} onClose={() => setSheet(null)} />
    </div>
  );
}

/** Small illustration: text-size letters on a card, in the palette. */
function SettingsArt() {
  return (
    <svg viewBox="0 0 320 220" aria-hidden>
      <rect width={320} height={220} fill="#FFF9E8" />
      <rect x={40} y={40} width={240} height={140} rx={22} fill="#FFFFFF" stroke="#344B50" strokeWidth={3} />
      <text x={78} y={142} fontFamily="Fraunces Variable, Georgia, serif" fontSize={74} fill="#344B50">A</text>
      <text x={140} y={142} fontFamily="Fraunces Variable, Georgia, serif" fontSize={52} fill="#397F83">a</text>
      <text x={186} y={142} fontFamily="Fraunces Variable, Georgia, serif" fontSize={34} fill="#718184">a</text>
      <rect x={70} y={156} width={180} height={8} rx={4} fill="#E2F1EF" />
      <rect x={70} y={156} width={110} height={8} rx={4} fill="#83BDB7" />
      <circle cx={180} cy={160} r={11} fill="#F7E9B8" stroke="#344B50" strokeWidth={3} />
      <circle cx={268} cy={52} r={16} fill="#E5DFF2" stroke="#344B50" strokeWidth={3} />
    </svg>
  );
}
