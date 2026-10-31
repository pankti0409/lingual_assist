import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import {
  AudioLines,
  ClipboardList,
  FlaskConical,
  Hand,
  House,
  LayoutGrid,
  Menu,
  MessageCircle,
  Route as RouteIcon,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useServices } from "@/api/ServicesProvider";
import { LANGUAGE_LABELS } from "@/api/types";
import { Celebration } from "@/components/Celebration";
import { SimulatedTag } from "@/components/Status";
import { routeVariants, useCalm } from "@/lib/motion";
import { usePreferences } from "@/state/preferences";
import { useSession } from "@/state/session";
import { ConnectionBanner } from "./ConnectionBanner";

type To = "/" | "/conversation" | "/expressions" | "/voice" | "/journey" | "/settings" | "/gestures" | "/setup" | "/review" | "/evaluation" | "/screens";
interface NavItem {
  to: To;
  label: string;
  icon: LucideIcon;
  journey?: boolean;
  lab?: boolean;
}

const GROUPS: { title: string | null; items: NavItem[] }[] = [
  {
    title: null,
    items: [
      { to: "/", label: "Home", icon: House },
      { to: "/conversation", label: "Talk", icon: MessageCircle },
      { to: "/expressions", label: "Expressions", icon: LayoutGrid },
      { to: "/voice", label: "Voice Studio", icon: AudioLines },
      { to: "/journey", label: "Journey", icon: RouteIcon, journey: true },
    ],
  },
  {
    title: "Make it yours",
    items: [
      { to: "/settings", label: "Settings", icon: SlidersHorizontal },
      { to: "/gestures", label: "Gestures", icon: Hand },
    ],
  },
  {
    title: "Session",
    items: [
      { to: "/setup", label: "Session setup", icon: Settings2 },
      { to: "/review", label: "Review", icon: ClipboardList },
    ],
  },
  {
    title: "Prototype lab",
    items: [
      { to: "/evaluation", label: "Evaluation", icon: FlaskConical, lab: true },
      { to: "/screens", label: "Screens", icon: Sparkles, lab: true },
    ],
  },
];

const TABS: NavItem[] = [
  { to: "/", label: "Home", icon: House },
  { to: "/conversation", label: "Talk", icon: MessageCircle },
  { to: "/expressions", label: "Expressions", icon: LayoutGrid },
  { to: "/voice", label: "Voice", icon: AudioLines },
];

export function BrandMark({ size = 40 }: { size?: number }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden className="brand__mark">
      <path d="M8 22c0-9 7.5-15 16.5-15S41 13 41 22s-7.5 15-16.5 15c-2 0-4-.3-5.8-.9L11 40l1.8-7.2C9.8 30 8 26.3 8 22Z" fill="#BFDCD8" stroke="#344B50" strokeWidth={2.6} strokeLinejoin="round" />
      <path d="M17 22.5l5 5 9.5-10.5" fill="none" stroke="#344B50" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={38.5} cy={10.5} r={5} fill="#F7E9B8" stroke="#344B50" strokeWidth={2.2} />
    </svg>
  );
}

function Brand() {
  return (
    <Link to="/" className="brand" aria-label="Lingual Assist, home">
      <BrandMark />
      <span className="brand__name">Lingual<br />Assist</span>
    </Link>
  );
}

function SessionChip() {
  const { state } = useSession();
  const s = state.session;
  if (state.status === "active" && s)
    return (
      <Link to="/conversation" className="session-chip session-chip--on">
        <span className="session-chip__dot" aria-hidden />
        <span>
          <strong>Session active</strong>
          <span className="session-chip__sub">{LANGUAGE_LABELS[s.language]}{state.typedOnly ? " · typing" : ""}</span>
        </span>
      </Link>
    );
  return (
    <Link to="/setup" className="session-chip">
      <span className="session-chip__dot" aria-hidden />
      <span>
        <strong>{state.status === "ended" ? "Session ended" : "No session yet"}</strong>
        <span className="session-chip__sub">Set one up</span>
      </span>
    </Link>
  );
}

function NavList({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  return (
    <ul className="nav-list">
      {items.map((n) => (
        <li key={n.to}>
          <Link
            to={n.to}
            className="nav-link"
            activeOptions={{ exact: n.to === "/" }}
            activeProps={{ className: "is-active", "aria-current": "page" }}
            onClick={onNavigate}
          >
            <n.icon size={22} aria-hidden className="nav-link__icon" />
            <span>{n.label}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function AppShell() {
  const services = useServices();
  const { state } = useSession();
  const { prefs } = usePreferences();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const calm = useCalm();
  const mainRef = useRef<HTMLElement>(null);
  const first = useRef(true);
  const [menuOpen, setMenuOpen] = useState(false);

  // Move focus to <main> after client-side navigation so keyboard and screen-reader users land on
  // the new page (not on the link they activated). Skipped on first load.
  useEffect(() => {
    setMenuOpen(false);
    if (first.current) {
      first.current = false;
      return;
    }
    if (!location.hash) mainRef.current?.focus({ preventScroll: true });
  }, [pathname]);

  const groups = GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => !(i.journey && !prefs.journey) && !(i.lab && prefs.simplified)),
  })).filter((g) => g.items.length);

  return (
    <div className="app">
      <a href="#main" className="skip-link">Skip to main content</a>

      <aside className="rail" aria-label="Sidebar">
        <Brand />
        <SessionChip />
        <nav aria-label="Main" className="rail__nav">
          {groups.map((g) => (
            <div key={g.title ?? "primary"} className="nav-group">
              {g.title && <p className="nav-group__title">{g.title}</p>}
              <NavList items={g.items} />
            </div>
          ))}
        </nav>
        <p className="rail__promise">Nothing is spoken until you confirm it.</p>
      </aside>

      <header className="topbar">
        <Brand />
        <button type="button" className="icon-btn topbar__menu" aria-expanded={menuOpen} aria-controls="menu-sheet" onClick={() => setMenuOpen((o) => !o)}>
          {menuOpen ? <X aria-hidden /> : <Menu aria-hidden />}
          <span className="sr-only">{menuOpen ? "Close menu" : "Open menu"}</span>
        </button>
      </header>

      <AnimatePresence>
        {menuOpen && (
          <motion.div
            id="menu-sheet"
            className="menu-sheet"
            initial={calm ? false : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
          >
            <SessionChip />
            <nav aria-label="Menu">
              {groups.map((g) => (
                <div key={g.title ?? "primary"} className="nav-group">
                  {g.title && <p className="nav-group__title">{g.title}</p>}
                  <NavList items={g.items} onNavigate={() => setMenuOpen(false)} />
                </div>
              ))}
            </nav>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="stage">
        {services.mode === "mock" && (
          <div className="mode-strip" role="note">
            <SimulatedTag>Prototype mode</SimulatedTag>
            <span>Services, devices and results are simulated. Nothing is recorded, uploaded or stored.</span>
          </div>
        )}
        {state.status === "active" && <ConnectionBanner />}
        <motion.main
          key={pathname}
          id="main"
          ref={mainRef}
          tabIndex={-1}
          className="site-main"
          variants={calm ? undefined : routeVariants}
          initial={calm ? false : "initial"}
          animate="enter"
        >
          <Outlet />
        </motion.main>
        <footer className="site-footer">
          <p>
            <strong>Nothing is spoken until you confirm it.</strong> Lingual Assist is an assistive-communication prototype. It does not
            diagnose, give medical advice, read emotions or turn lip movements into words.
          </p>
        </footer>
      </div>

      <nav aria-label="Quick" className="tabbar">
        <ul>
          {TABS.map((t) => (
            <li key={t.to}>
              <Link to={t.to} className="tab" activeOptions={{ exact: t.to === "/" }} activeProps={{ className: "is-active", "aria-current": "page" }}>
                <t.icon size={24} aria-hidden />
                <span>{t.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <Celebration />
    </div>
  );
}
