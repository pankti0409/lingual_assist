import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { SCENARIOS, SCENARIO_IDS } from "@/api/mock/scenarios";
import { HeroFilm, FILM_MOMENTS } from "@/art/HeroFilm";
import { EmptyStateArt, GesturePortrait, UnavailableArt, Vignette, VoicePortrait } from "@/art/Scenes";
import { SimulatedTag } from "@/components/Status";
import { useDocumentTitle } from "@/lib/dom";

const ROUTES = [
  { to: "/", title: "Home", text: "Story of the six stages, privacy and consent, and the way in." },
  { to: "/setup", title: "Session setup", text: "Language, four separate consents, device checks, typed-only path." },
  { to: "/conversation", title: "Conversation", text: "Transcript, capture, suggested replies, confirmation and playback." },
  { to: "/voice", title: "Voice", text: "Designed voice, consent-gated personal voice, text-only fallback." },
  { to: "/gestures", title: "Gestures", text: "Personal meanings for eight gestures and a simulated test area." },
  { to: "/review", title: "Review", text: "Transcript, confirmed messages, counts, end and delete." },
  { to: "/evaluation", title: "Evaluation", text: "Mock and live runs, with and without visual cues." },
] as const;

const ART = [
  { key: "listen", title: "Listening to imperfect speech", node: <HeroFilm t={FILM_MOMENTS.listening} /> },
  { key: "ask", title: "The partner asks", node: <HeroFilm t={FILM_MOMENTS.partnerAsks} /> },
  { key: "gesture", title: "A stable gesture", node: <HeroFilm t={FILM_MOMENTS.gesture} /> },
  { key: "suggest", title: "Replies appear", node: <HeroFilm t={FILM_MOMENTS.suggest} /> },
  { key: "confirm", title: "Confirming one message", node: <HeroFilm t={FILM_MOMENTS.confirm} /> },
  { key: "speak", title: "Spoken with a subtitle", node: <HeroFilm t={FILM_MOMENTS.speak} /> },
  { key: "voice", title: "Voice settings portrait", node: <VoicePortrait /> },
  { key: "gestureP", title: "Gesture settings portrait", node: <GesturePortrait /> },
  { key: "empty", title: "Empty state", node: <EmptyStateArt /> },
  { key: "down", title: "Service unavailable", node: <UnavailableArt /> },
  { key: "family", title: "With family", node: <Vignette id="family" /> },
  { key: "clinic", title: "At an appointment", node: <Vignette id="appointment" /> },
];

export function ScreensPage() {
  useDocumentTitle("Screens and states");
  return (
    <div className="page screens">
      <header className="page-head">
        <p className="eyebrow">Screens</p>
        <h1 className="display-2">Every screen and state, one place.</h1>
        <p className="lede">A reference for reviewers: each link opens the real screen. Prototype scenarios load scripted, simulated data.</p>
      </header>

      <section aria-labelledby="routes-h">
        <h2 id="routes-h" className="h3">Screens</h2>
        <ul className="screen-grid">
          {ROUTES.map((r) => (
            <li key={r.to}>
              <Link to={r.to} className="screen-card">
                <span className="screen-card__title">{r.title} <ArrowUpRight size={18} aria-hidden /></span>
                <span className="muted">{r.text}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="scen-h">
        <h2 id="scen-h" className="h3">Conversation scenarios <SimulatedTag>Scripted</SimulatedTag></h2>
        <ul className="screen-grid">
          {SCENARIO_IDS.map((id) => (
            <li key={id}>
              <Link to="/conversation" search={{ scenario: id }} className="screen-card">
                <span className="screen-card__title">{SCENARIOS[id].title} <ArrowUpRight size={18} aria-hidden /></span>
                <span className="muted">{SCENARIOS[id].summary}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="art-h">
        <h2 id="art-h" className="h3">Illustrations</h2>
        <ul className="art-grid">
          {ART.map((a) => (
            <li key={a.key}>
              <figure>
                <div className="art-grid__frame">{a.node}</div>
                <figcaption>{a.title}</figcaption>
              </figure>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
