/**
 * Temporary, in-memory session store. Nothing is persisted: the backend specification only defines
 * temporary sessions, with no accounts and no permanent history.
 *
 * Invariants kept here (and tested):
 *  - a partial transcript is never a turn
 *  - drafts survive errors and disconnection
 *  - deleting the session clears every piece of state
 */
import { createContext, useContext, useMemo, useReducer, type Dispatch, type ReactNode } from "react";
import type {
  ConfirmedMessage,
  Consent,
  Language,
  PartialTranscript,
  Proposal,
  Session,
  SessionVoice,
  Speaker,
  Turn,
} from "@/api/types";

export type SessionStatus = "none" | "active" | "ended" | "deleted";
export type PlaybackStatus = "idle" | "loading" | "playing" | "stopped" | "played" | "text_only" | "error";

export interface SessionState {
  status: SessionStatus;
  session: Session | null;
  turns: Turn[];
  partial: PartialTranscript | null;
  proposals: Proposal[];
  activeProposalId: string | null;
  confirmed: ConfirmedMessage[];
  decisions: number;
  drafts: { typed: string; edit: string };
  playback: Record<string, PlaybackStatus>;
  speaker: Speaker;
  startedAt: number | null;
  typedOnly: boolean;
}

export const initialSessionState: SessionState = {
  status: "none",
  session: null,
  turns: [],
  partial: null,
  proposals: [],
  activeProposalId: null,
  confirmed: [],
  decisions: 0,
  drafts: { typed: "", edit: "" },
  playback: {},
  speaker: "partner",
  startedAt: null,
  typedOnly: false,
};

export type SessionAction =
  | { type: "session/started"; session: Session; typedOnly: boolean; at: number }
  | { type: "session/updated"; session: Session }
  | { type: "session/consent"; consent: Consent }
  | { type: "session/voice"; voice: SessionVoice | null }
  | { type: "session/language"; language: Language }
  | { type: "session/ended" }
  | { type: "session/deleted" }
  | { type: "session/missing" }
  | { type: "turns/loaded"; turns: Turn[] }
  | { type: "turn/added"; turn: Turn }
  | { type: "partial/set"; partial: PartialTranscript | null }
  | { type: "proposal/added"; proposal: Proposal }
  | { type: "proposal/updated"; proposal: Proposal }
  | { type: "confirmed/added"; message: ConfirmedMessage }
  | { type: "decision/counted" }
  | { type: "draft/typed"; text: string }
  | { type: "draft/edit"; text: string }
  | { type: "playback/set"; confirmedId: string; status: PlaybackStatus }
  | { type: "speaker/set"; speaker: Speaker };

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case "session/started":
      return { ...initialSessionState, status: "active", session: action.session, typedOnly: action.typedOnly, startedAt: action.at };
    case "session/updated":
      return { ...state, session: action.session };
    case "session/consent":
      return state.session ? { ...state, session: { ...state.session, consent: action.consent } } : state;
    case "session/voice":
      return state.session ? { ...state, session: { ...state.session, voice: action.voice } } : state;
    case "session/language":
      return state.session ? { ...state, session: { ...state.session, language: action.language } } : state;
    case "session/ended":
      return { ...state, status: state.status === "none" ? "none" : "ended", partial: null };
    case "session/deleted":
      // Every piece of temporary state goes, including drafts.
      return { ...initialSessionState, status: "deleted" };
    case "session/missing":
      return { ...initialSessionState, status: "deleted" };
    case "turns/loaded":
      return { ...state, turns: action.turns };
    case "turn/added":
      // A committed turn replaces the partial for that speaker; it never merges with it.
      return {
        ...state,
        turns: state.turns.some((t) => t.id === action.turn.id) ? state.turns : [...state.turns, action.turn],
        partial: null,
      };
    case "partial/set":
      return { ...state, partial: action.partial };
    case "proposal/added":
      return { ...state, proposals: [...state.proposals, action.proposal], activeProposalId: action.proposal.id };
    case "proposal/updated":
      return { ...state, proposals: state.proposals.map((p) => (p.id === action.proposal.id ? { ...p, ...action.proposal, evidence: p.evidence ?? action.proposal.evidence } : p)) };
    case "confirmed/added":
      return state.confirmed.some((m) => m.id === action.message.id)
        ? state
        : { ...state, confirmed: [...state.confirmed, action.message], playback: { ...state.playback, [action.message.id]: "idle" } };
    case "decision/counted":
      return { ...state, decisions: state.decisions + 1 };
    case "draft/typed":
      return { ...state, drafts: { ...state.drafts, typed: action.text } };
    case "draft/edit":
      return { ...state, drafts: { ...state.drafts, edit: action.text } };
    case "playback/set":
      return { ...state, playback: { ...state.playback, [action.confirmedId]: action.status } };
    case "speaker/set":
      return { ...state, speaker: action.speaker };
  }
}

/** Speech may only ever be requested for an id present in `confirmed`. */
export function isSpeakable(state: SessionState, confirmedId: string | null | undefined): boolean {
  return !!confirmedId && state.status === "active" && state.confirmed.some((m) => m.id === confirmedId);
}

export function activeProposal(state: SessionState): Proposal | null {
  return state.proposals.find((p) => p.id === state.activeProposalId) ?? null;
}

interface Ctx {
  state: SessionState;
  dispatch: Dispatch<SessionAction>;
}
const SessionContext = createContext<Ctx | null>(null);

export function SessionProvider({ children, initial }: { children: ReactNode; initial?: SessionState }) {
  const [state, dispatch] = useReducer(sessionReducer, initial ?? initialSessionState);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Ctx {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>");
  return ctx;
}
