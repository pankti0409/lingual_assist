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
  | "expression-created";

export type JourneyIcon = "compass" | "message" | "sparkle" | "wave" | "hand" | "sliders" | "pen" | "heart";

export interface Milestone {
  id: string;
  title: string;
  text: string;
  how: string;
  to: "/setup" | "/conversation" | "/expressions" | "/voice" | "/gestures" | "/settings";
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

export const MILESTONES: Milestone[] = [
  { id: "setup", title: "Set up a session", text: "Pick a language and decide on each consent.", how: "Open Session setup and start a session — typing only is fine.", to: "/setup", icon: "compass" },
  { id: "first-message", title: "Say a first message", text: "Choose, edit or write a reply and confirm it.", how: "In Talk, add a message and confirm the exact words you want.", to: "/conversation", icon: "message" },
  { id: "expression", title: "Use a quick expression", text: "Say something from your expression board.", how: "Open Expressions, tap a tile and confirm it.", to: "/expressions", icon: "sparkle" },
  { id: "voice", title: "Hear a voice", text: "Preview how your messages can sound.", how: "Open Voice Studio and press Preview.", to: "/voice", icon: "wave" },
  { id: "gesture", title: "Give a gesture meaning", text: "Decide what a hand shape means to you.", how: "Open Gestures, write a meaning and save it.", to: "/gestures", icon: "hand" },
  { id: "yours", title: "Make it yours", text: "Adjust three settings to suit you.", how: "In Settings, change text size, button size or anything else.", to: "/settings", icon: "sliders" },
];

export const ACHIEVEMENTS: Achievement[] = [
  { id: "first-conversation", title: "First Conversation", text: "You confirmed your first message.", hint: "Confirm any message in Talk or from Expressions.", icon: "message", shape: "seal", tone: "teal" },
  { id: "voice-explorer", title: "Voice Explorer", text: "You listened to how a voice sounds.", hint: "Preview or create a voice in Voice Studio.", icon: "wave", shape: "flower", tone: "lilac" },
  { id: "expression-creator", title: "Expression Creator", text: "You added an expression of your own.", hint: "Create a custom expression on the board.", icon: "sparkle", shape: "star", tone: "butter" },
  { id: "own-words", title: "In Your Own Words", text: "You edited a suggestion before confirming it.", hint: "Edit a suggested reply, then confirm it.", icon: "pen", shape: "drop", tone: "peach" },
  { id: "gesture-guide", title: "Gesture Guide", text: "You gave your gestures their meanings.", hint: "Save gesture meanings for a session.", icon: "hand", shape: "hex", tone: "pistachio" },
  { id: "personalisation-pro", title: "Personalisation Pro", text: "You tuned three different settings.", hint: "Change any three settings to suit you.", icon: "sliders", shape: "shield", tone: "teal" },
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
    case "expression":
      return !!e["confirmed-expression"];
    case "voice":
      return !!e["voice-tried"];
    case "gesture":
      return !!e["gestures-saved"];
    case "yours":
      return tuned >= 3;
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
    case "expression-creator":
      return !!e["expression-created"];
    case "own-words":
      return !!e["confirmed-edit"];
    case "gesture-guide":
      return !!e["gestures-saved"];
    case "personalisation-pro":
      return tuned >= 3;
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
