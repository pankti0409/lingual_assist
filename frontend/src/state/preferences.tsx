/**
 * Personal preferences, kept only in this browser (localStorage). They are conveniences for the
 * person using this device — never sent to the service, never part of a session.
 *
 * Nothing here can change the confirmation rules: there is no preference that speaks without a
 * confirmation, and no preference that confirms on someone's behalf.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, type ReactNode } from "react";
import type { Language } from "@/api/types";

export type TextScale = 1 | 1.15 | 1.3 | 1.5;
export type TargetSize = "standard" | "large" | "xl";
export type MotionPref = "system" | "reduced" | "full";

export interface CustomExpression {
  id: string;
  text: string;
  category: string;
  icon: string;
}

export interface Preferences {
  name: string;
  textScale: TextScale;
  targets: TargetSize;
  simplified: boolean;
  motion: MotionPref;
  highContrast: boolean;
  strongFocus: boolean;
  defaultLanguage: Language;
  showRecent: boolean;
  journey: boolean;
  celebrations: boolean;
  /** Play a quick expression straight after it is confirmed (the confirm press is still required). */
  playAfterExpressionConfirm: boolean;
  voice: { rate: number; pitch: number; volume: number; favouriteVoiceId: string | null; previewText: string };
  favourites: string[];
  customExpressions: CustomExpression[];
  /** How many distinct settings have been changed (for the "Personalisation Pro" milestone). */
  tuned: string[];
}

export const DEFAULT_PREFERENCES: Preferences = {
  name: "",
  textScale: 1,
  targets: "standard",
  simplified: false,
  motion: "system",
  highContrast: false,
  strongFocus: false,
  defaultLanguage: "en",
  showRecent: true,
  journey: true,
  celebrations: true,
  playAfterExpressionConfirm: false,
  voice: { rate: 1, pitch: 1, volume: 1, favouriteVoiceId: null, previewText: "Hello! This is how my confirmed messages will sound." },
  favourites: ["greet-hello", "yes", "no", "needs-water", "comfort-thank-you", "q-repeat"],
  customExpressions: [],
  tuned: [],
};

const KEY = "lingual-assist:preferences:v1";

function load(): Preferences {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return { ...DEFAULT_PREFERENCES, ...parsed, voice: { ...DEFAULT_PREFERENCES.voice, ...parsed.voice } };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function save(p: Preferences) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage blocked (private window, policy): preferences still apply for this visit */
  }
}

type Action =
  | { type: "set"; patch: Partial<Preferences>; tuned?: string }
  | { type: "voice"; patch: Partial<Preferences["voice"]> }
  | { type: "favourite"; id: string }
  | { type: "custom/add"; expression: CustomExpression }
  | { type: "custom/remove"; id: string }
  | { type: "reset" };

function reducer(state: Preferences, action: Action): Preferences {
  switch (action.type) {
    case "set": {
      const tuned = action.tuned && !state.tuned.includes(action.tuned) ? [...state.tuned, action.tuned] : state.tuned;
      return { ...state, ...action.patch, tuned };
    }
    case "voice":
      return { ...state, voice: { ...state.voice, ...action.patch } };
    case "favourite":
      return {
        ...state,
        favourites: state.favourites.includes(action.id) ? state.favourites.filter((f) => f !== action.id) : [...state.favourites, action.id],
      };
    case "custom/add":
      return { ...state, customExpressions: [...state.customExpressions, action.expression] };
    case "custom/remove":
      return {
        ...state,
        customExpressions: state.customExpressions.filter((e) => e.id !== action.id),
        favourites: state.favourites.filter((f) => f !== action.id),
      };
    case "reset":
      return DEFAULT_PREFERENCES;
  }
}

interface Ctx {
  prefs: Preferences;
  /** `tuned` names the setting, so changing several different settings can be recognised. */
  set: (patch: Partial<Preferences>, tuned?: string) => void;
  setVoice: (patch: Partial<Preferences["voice"]>) => void;
  toggleFavourite: (id: string) => void;
  addCustom: (e: Omit<CustomExpression, "id">) => CustomExpression;
  removeCustom: (id: string) => void;
  reset: () => void;
}

const PreferencesContext = createContext<Ctx | null>(null);

export function PreferencesProvider({ children, initial }: { children: ReactNode; initial?: Partial<Preferences> }) {
  const [prefs, dispatch] = useReducer(reducer, undefined, () => (initial ? { ...DEFAULT_PREFERENCES, ...initial } : load()));

  useEffect(() => save(prefs), [prefs]);

  // Apply display preferences to the document so plain CSS can respond to them.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--font-scale", String(prefs.textScale));
    root.dataset.targets = prefs.targets;
    root.dataset.contrast = prefs.highContrast ? "high" : "standard";
    root.dataset.motion = prefs.motion;
    root.dataset.simple = prefs.simplified ? "true" : "false";
    root.dataset.focus = prefs.strongFocus ? "strong" : "standard";
  }, [prefs.textScale, prefs.targets, prefs.highContrast, prefs.motion, prefs.simplified, prefs.strongFocus]);

  const set = useCallback((patch: Partial<Preferences>, tuned?: string) => dispatch({ type: "set", patch, tuned }), []);
  const setVoice = useCallback((patch: Partial<Preferences["voice"]>) => dispatch({ type: "voice", patch }), []);
  const toggleFavourite = useCallback((id: string) => dispatch({ type: "favourite", id }), []);
  const addCustom = useCallback((e: Omit<CustomExpression, "id">) => {
    const expression = { ...e, id: `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}` };
    dispatch({ type: "custom/add", expression });
    return expression;
  }, []);
  const removeCustom = useCallback((id: string) => dispatch({ type: "custom/remove", id }), []);
  const reset = useCallback(() => dispatch({ type: "reset" }), []);

  const value = useMemo(() => ({ prefs, set, setVoice, toggleFavourite, addCustom, removeCustom, reset }), [prefs, set, setVoice, toggleFavourite, addCustom, removeCustom, reset]);
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): Ctx {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error("usePreferences must be used inside <PreferencesProvider>");
  return ctx;
}

/** True when decorative motion is allowed by both the system and the personal preference. */
export function motionAllowed(pref: MotionPref, systemReduced: boolean | null): boolean {
  if (pref === "reduced") return false;
  if (pref === "full") return true;
  return !systemReduced;
}
