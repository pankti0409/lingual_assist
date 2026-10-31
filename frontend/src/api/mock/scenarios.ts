/** Prototype scenarios for the mock adapter. Every value here is scripted, not measured. */
import type { GestureCue, Language } from "../types";

export type ScenarioId =
  | "water"
  | "ambiguous"
  | "edited"
  | "rejected-retry"
  | "devices-unavailable"
  | "disconnect"
  | "ended"
  | "deleted";

export interface Scenario {
  id: ScenarioId;
  title: string;
  summary: string;
  language: Language;
  /** Scripted speech per speaker: partial frames then the committed text. */
  partner: { partials: string[]; committed: string };
  patient: { partials: string[]; committed: string };
  /** Gesture the simulated camera reports while the patient answers. */
  gesture: GestureCue | null;
  mouthActivity: boolean;
  /** Candidate replies per fusion attempt (index = attempt number, last entry repeats). */
  attempts: { candidates: string[]; intent: string; clarify: boolean; reason: string }[];
  devicesUnavailable?: boolean;
  disconnectAfterFusion?: boolean;
  endedSession?: boolean;
  deletedSession?: boolean;
}

const WATER_REPLIES = ["I would like water, please.", "Could I have some water?", "Water, not tea, thank you."];

const thumbUp: GestureCue = { label: "Thumb_Up", score: 0.91, stable: true, meaning: "yes" };

const base = {
  partner: { partials: ["Would you", "Would you like water", "Would you like water or tea?"], committed: "Would you like water or tea?" },
  patient: { partials: ["wa…", "wa… wa-", "wa… water"], committed: "wa... water" },
  gesture: thumbUp,
  mouthActivity: true,
};

export const SCENARIOS: Record<ScenarioId, Scenario> = {
  water: {
    id: "water",
    title: "Successful water request",
    summary: "Partner offers water or tea; the patient answers “wa… water” with a thumbs-up and confirms a reply.",
    language: "en",
    ...base,
    attempts: [{ candidates: WATER_REPLIES, intent: "request_water", clarify: false, reason: "The answer and the recent question both point to water." }],
  },
  ambiguous: {
    id: "ambiguous",
    title: "Ambiguous input needs clarification",
    summary: "The patient’s words are unclear and no gesture is visible, so the assistant asks instead of guessing.",
    language: "en",
    ...base,
    patient: { partials: ["mm…", "mm… th-"], committed: "mm... th-" },
    gesture: null,
    attempts: [{ candidates: [], intent: "unclear", clarify: true, reason: "The transcript is too short and no cue resolves it." }],
  },
  edited: {
    id: "edited",
    title: "Edited reply (Hindi–English)",
    summary: "Suggestions are close but not exact; the patient edits one in Hindi and English before confirming.",
    language: "mixed",
    partner: { partials: ["पानी", "पानी या चाय?"], committed: "पानी या चाय? Water or tea?" },
    patient: { partials: ["मुझे…", "मुझे… wa-"], committed: "मुझे... water" },
    gesture: thumbUp,
    mouthActivity: true,
    attempts: [
      {
        candidates: ["मुझे पानी चाहिए।", "Please, थोड़ा पानी दीजिए।", "I would like water, please."],
        intent: "request_water",
        clarify: false,
        reason: "The answer mentions water and follows the partner’s question.",
      },
    ],
  },
  "rejected-retry": {
    id: "rejected-retry",
    title: "Rejected suggestions, then retry",
    summary: "The first suggestions are wrong; the patient rejects them and asks again.",
    language: "en",
    ...base,
    attempts: [
      { candidates: ["I would like tea, please.", "Tea, thank you."], intent: "request_tea", clarify: false, reason: "The partner mentioned tea last." },
      { candidates: WATER_REPLIES, intent: "request_water", clarify: false, reason: "The answer starts with “wa” and the gesture means yes." },
    ],
  },
  "devices-unavailable": {
    id: "devices-unavailable",
    title: "Microphone and camera unavailable",
    summary: "No capture devices are available; typing still lets the conversation continue.",
    language: "en",
    ...base,
    gesture: null,
    mouthActivity: false,
    devicesUnavailable: true,
    attempts: [{ candidates: WATER_REPLIES, intent: "request_water", clarify: false, reason: "The typed answer asks for water." }],
  },
  disconnect: {
    id: "disconnect",
    title: "Service disconnection and recovery",
    summary: "The connection drops after suggestions appear; drafts are kept and the session reconnects.",
    language: "en",
    ...base,
    disconnectAfterFusion: true,
    attempts: [{ candidates: WATER_REPLIES, intent: "request_water", clarify: false, reason: "The answer and the recent question both point to water." }],
  },
  ended: {
    id: "ended",
    title: "Ended session",
    summary: "The session has ended: the transcript is read-only and nothing new can be captured or spoken.",
    language: "en",
    ...base,
    endedSession: true,
    attempts: [{ candidates: WATER_REPLIES, intent: "request_water", clarify: false, reason: "" }],
  },
  deleted: {
    id: "deleted",
    title: "Deleted session",
    summary: "The session and its temporary data were deleted; nothing remains to show.",
    language: "en",
    ...base,
    deletedSession: true,
    attempts: [{ candidates: WATER_REPLIES, intent: "request_water", clarify: false, reason: "" }],
  },
};

export const SCENARIO_IDS = Object.keys(SCENARIOS) as ScenarioId[];

export function isScenarioId(v: unknown): v is ScenarioId {
  return typeof v === "string" && v in SCENARIOS;
}
