/**
 * Backend service interfaces. Components only ever depend on these, so the mock adapter can be
 * swapped for the HTTP adapter (or a future one) without touching UI code.
 */
import type {
  ActionResult,
  Consent,
  EvalMode,
  EvalReportState,
  GestureMap,
  Language,
  PartialTranscript,
  Proposal,
  Session,
  SessionVoice,
  SpeakResult,
  Speaker,
  Turn,
  TurnMetrics,
  VisualCues,
  VoiceInfo,
} from "./types";
import type { ScenarioId } from "./mock/scenarios";

export interface SessionService {
  create(language: Language): Promise<Session>;
  /** Ends the session: the transcript stays readable, nothing new can be captured or spoken. */
  end(sessionId: string): Promise<void>;
  /** Replaces all four consent flags at once (each flag is still chosen separately in the UI). */
  setConsent(sessionId: string, consent: Omit<Consent, "recordedAt">): Promise<Session>;
  get(sessionId: string): Promise<Session>;
  delete(sessionId: string): Promise<void>;
}

export interface SpeechCapture {
  /** Stream of in-progress text; partials are display-only and never stored. */
  onPartial(cb: (p: PartialTranscript) => void): void;
  /** "Finish speaking": resolves with the committed turn, or null when nothing was heard. */
  finish(): Promise<Turn | null>;
  cancel(): void;
}

export interface ConversationService {
  history(sessionId: string): Promise<Turn[]>;
  addTypedTurn(sessionId: string, speaker: Speaker, text: string, language: Language): Promise<Turn>;
  startCapture(sessionId: string, speaker: Speaker, language: Language): Promise<SpeechCapture>;
  finishTurn(sessionId: string, opts: { includeVisualCues: boolean }): Promise<Proposal>;
  confirm(sessionId: string, proposalId: string, candidateIndex: number): Promise<ActionResult>;
  edit(sessionId: string, proposalId: string, text: string): Promise<ActionResult>;
  reject(sessionId: string, proposalId: string): Promise<ActionResult>;
  clarify(sessionId: string, proposalId: string): Promise<ActionResult>;
  /** Only accepts the id of a confirmed message; the text spoken comes from the server. */
  speak(sessionId: string, confirmedId: string): Promise<SpeakResult>;
  metrics(sessionId: string): Promise<TurnMetrics[]>;
}

export interface VisionService {
  cues(sessionId: string): Promise<VisualCues | null>;
  setGestureMap(sessionId: string, map: GestureMap): Promise<GestureMap>;
}

export interface VoiceService {
  list(): Promise<VoiceInfo[]>;
  design(sessionId: string, name: string, description: string): Promise<SessionVoice>;
  clone(sessionId: string, name: string, sample: File): Promise<SessionVoice>;
  preview(text: string, voice: SessionVoice | null): Promise<SpeakResult>;
}

export interface EvaluationService {
  run(mode: EvalMode): Promise<EvalReportState>;
  report(): Promise<EvalReportState>;
  csv(): Promise<string>;
}

/** What the connected service can do right now (from GET /health). */
export interface ServiceHealth {
  /** Suggested replies (LLM key configured). */
  suggestions: boolean;
  /** Speech-to-text and voice output (ElevenLabs key configured). */
  speech: boolean;
  /** Camera cues (vision model files present). */
  vision: boolean;
}

export interface ConnectionService {
  /** Health of the backend link; drives disconnected/reconnecting banners. */
  status(): "online" | "disconnected" | "reconnecting";
  subscribe(cb: (s: "online" | "disconnected" | "reconnecting") => void): () => void;
  reconnect(): Promise<void>;
  /** Which capabilities the service has configured. */
  health(): Promise<ServiceHealth>;
}

export type VoiceSimulation = "normal" | "unavailable" | "provider_error";

/** Controls that exist only in mock mode, for the prototype scenarios. */
export interface MockControl {
  scenario(): ScenarioId;
  setScenario(id: ScenarioId): void;
  /** Creates a session that already shows the chosen scenario's end state (ended / deleted). */
  prepareScenarioSession(id: ScenarioId): Promise<string>;
  cameraOn(): boolean;
  setCameraOn(on: boolean): void;
  voiceSimulation(): VoiceSimulation;
  setVoiceSimulation(v: VoiceSimulation): void;
  simulateDisconnect(): void;
}

export interface Services {
  mode: "mock" | "http";
  sessions: SessionService;
  conversation: ConversationService;
  vision: VisionService;
  voices: VoiceService;
  evaluation: EvaluationService;
  connection: ConnectionService;
  mock?: MockControl;
}
