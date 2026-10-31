/**
 * The optional personal journey: milestones and collectible badges.
 *
 * Rules:
 *  - everything here is earned by something the person actually did on this device; nothing is
 *    pre-filled or simulated
 *  - no scores, streaks, leaderboards or volume targets: milestones mark things tried, never how
 *    much or how fast someone communicates
 *  - when the journey is switched off, nothing is recorded and nothing is celebrated
 *  - only event names and dates are stored (never message text), and only in this browser
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePreferences } from "./preferences";

export type JourneyEvent =
  | "session-started"
  | "confirmed-suggestion"
  | "confirmed-edit"
  | "confirmed-expression"
  | "voice-tried"
  | "gestures-saved"
  | "expression-saved"
  | "voice-saved";

export type JourneyIcon = "compass" | "message" | "sparkle" | "wave" | "hand" | "sliders" | "pen" | "heart";

export interface Milestone {
  id: string;
  title: string;
  text: string;
  how: string;
  to: "/setup" | "/conversation" | "/expressions" | "/voice" | "/gestures" | "/settings";
  /** Short friendly line shown once it is done. */
  doneText: string;
  icon: JourneyIcon;
}

export interface Achievement {
  id: string;
  title: string;
  text: string;
  hint: string;
  icon: JourneyIcon;
  shape: "seal" | "flower" | "shield" | "ticket" | "hex" | "drop" | "star";
  tone: "teal" | "butter" | "lilac" | "peach" | "pistachio";
}

/** An optional, gentle "getting started" checklist. Nothing here is required to use the app. */
export const MILESTONES: Milestone[] = [
  { id: "setup", title: "Start a session", text: "Choose a language and your privacy choices.", how: "Open Session setup and press Start — typing only is fine.", to: "/setup", icon: "compass", doneText: "Your communication space is ready." },
  { id: "first-message", title: "Confirm a first message", text: "Pick, edit or write a reply and confirm it.", how: "In Talk, add a message, then confirm the exact words.", to: "/conversation", icon: "message", doneText: "You confirmed your first message." },
  { id: "favourites", title: "Save favourite expressions", text: "Keep the phrases you use most on Home.", how: "On the Expressions board, press “Add to favourites” on a tile.", to: "/expressions", icon: "sparkle", doneText: "Your favourite expressions are saved." },
  { id: "voice", title: "Set your voice preferences", text: "Choose a comfortable speed and volume.", how: "In Voice Studio, adjust the sliders and press Save settings.", to: "/voice", icon: "wave", doneText: "Your voice preferences have been updated." },
  { id: "comfort", title: "Adjust comfort settings", text: "Make text and buttons the size you like.", how: "In Settings, change text size, button size or contrast.", to: "/settings", icon: "sliders", doneText: "Your comfort settings are in place." },
];

export const ACHIEVEMENTS: Achievement[] = [
  { id: "first-conversation", title: "First Conversation", text: "You confirmed your first message.", hint: "Confirm any message in Talk or from Expressions.", icon: "message", shape: "seal", tone: "teal" },
  { id: "voice-explorer", title: "Voice Explorer", text: "You listened to how a voice sounds.", hint: "Press Preview in Voice Studio.", icon: "wave", shape: "flower", tone: "lilac" },
  { id: "first-expression-saved", title: "First Expression Saved", text: "You saved an expression to use again.", hint: "Favourite a tile or create your own expression.", icon: "sparkle", shape: "star", tone: "butter" },
  { id: "own-words", title: "In Your Own Words", text: "You edited a suggestion before confirming it.", hint: "Edit a suggested reply, then confirm it.", icon: "pen", shape: "drop", tone: "peach" },
  { id: "gesture-guide", title: "Gesture Guide", text: "You gave your gestures their meanings.", hint: "Save gesture meanings for a session.", icon: "hand", shape: "hex", tone: "pistachio" },
  { id: "personalisation-complete", title: "Personalisation Complete", text: "Favourites, voice and comfort settings are all set up.", hint: "Save favourites, voice preferences and a comfort setting.", icon: "sliders", shape: "shield", tone: "teal" },
  { id: "communication-companion", title: "Communication Companion", text: "You confirmed messages three ways: a suggestion, your own edit and a quick expression.", hint: "Try a suggestion, an edit and a quick expression.", icon: "heart", shape: "ticket", tone: "lilac" },
];

type Events = Partial<Record<JourneyEvent, string>>;
interface Stored {
  events: Events;
  unlocked: Record<string, string>;
}

const KEY = "lingual-assist:journey:v1";
const EMPTY: Stored = { events: {}, unlocked: {} };

function load(): Stored {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Stored) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

function confirmedAny(e: Events) {
  return !!(e["confirmed-suggestion"] || e["confirmed-edit"] || e["confirmed-expression"]);
}

export function milestoneDone(id: string, e: Events, tuned: number): boolean {
  switch (id) {
    case "setup":
      return !!e["session-started"];
    case "first-message":
      return confirmedAny(e);
    case "favourites":
      return !!e["expression-saved"];
    case "voice":
      return !!e["voice-saved"];
    case "comfort":
      return tuned >= 1;
    default:
      return false;
  }
}

export function achievementEarned(id: string, e: Events, tuned: number): boolean {
  switch (id) {
    case "first-conversation":
      return confirmedAny(e);
    case "voice-explorer":
      return !!e["voice-tried"];
    case "first-expression-saved":
      return !!e["expression-saved"];
    case "own-words":
      return !!e["confirmed-edit"];
    case "gesture-guide":
      return !!e["gestures-saved"];
    case "personalisation-complete":
      return !!e["expression-saved"] && !!e["voice-saved"] && tuned >= 1;
    case "communication-companion":
      return !!(e["confirmed-suggestion"] && e["confirmed-edit"] && e["confirmed-expression"]);
    default:
      return false;
  }
}

interface Ctx {
  enabled: boolean;
  events: Events;
  unlocked: Record<string, string>;
  done: (milestoneId: string) => boolean;
  earned: (achievementId: string) => boolean;
  progress: { done: number; total: number };
  next: Milestone | null;
  record: (e: JourneyEvent) => void;
  /** Achievements unlocked during this visit and not yet acknowledged. */
  celebrations: Achievement[];
  dismissCelebration: (id: string) => void;
  clear: () => void;
}

const JourneyContext = createContext<Ctx | null>(null);

export function JourneyProvider({ children }: { children: ReactNode }) {
  const { prefs } = usePreferences();
  const [stored, setStored] = useState<Stored>(load);
  const [celebrations, setCelebrations] = useState<Achievement[]>([]);
  const enabled = prefs.journey;
  const tuned = prefs.tuned.length;

  useEffect(() => {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(stored));
    } catch {
      /* storage blocked: the journey still works for this visit */
    }
  }, [stored]);

  // Unlock newly earned achievements (only while the journey is on).
  useEffect(() => {
    if (!enabled) return;
    const fresh = ACHIEVEMENTS.filter((a) => !stored.unlocked[a.id] && achievementEarned(a.id, stored.events, tuned));
    if (!fresh.length) return;
    const now = new Date().toISOString();
    setStored((s) => ({ ...s, unlocked: { ...s.unlocked, ...Object.fromEntries(fresh.map((a) => [a.id, now])) } }));
    if (prefs.celebrations) setCelebrations((c) => [...c, ...fresh.filter((f) => !c.some((x) => x.id === f.id))]);
  }, [enabled, stored.events, stored.unlocked, tuned, prefs.celebrations]);

  const record = useCallback(
    (e: JourneyEvent) => {
      if (!enabled) return;
      setStored((s) => (s.events[e] ? s : { ...s, events: { ...s.events, [e]: new Date().toISOString() } }));
    },
    [enabled],
  );

  const dismissCelebration = useCallback((id: string) => setCelebrations((c) => c.filter((a) => a.id !== id)), []);
  const clear = useCallback(() => {
    setStored(EMPTY);
    setCelebrations([]);
  }, []);

  const value = useMemo<Ctx>(() => {
    const done = (id: string) => milestoneDone(id, stored.events, tuned);
    const count = MILESTONES.filter((m) => done(m.id)).length;
    return {
      enabled,
      events: stored.events,
      unlocked: stored.unlocked,
      done,
      earned: (id: string) => !!stored.unlocked[id],
      progress: { done: count, total: MILESTONES.length },
      next: MILESTONES.find((m) => !done(m.id)) ?? null,
      record,
      celebrations,
      dismissCelebration,
      clear,
    };
  }, [enabled, stored, tuned, record, celebrations, dismissCelebration, clear]);

  return <JourneyContext.Provider value={value}>{children}</JourneyContext.Provider>;
}

export function useJourney(): Ctx {
  const ctx = useContext(JourneyContext);
  if (!ctx) throw new Error("useJourney must be used inside <JourneyProvider>");
  return ctx;
}
