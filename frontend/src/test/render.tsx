import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "@/App";
import type { Services } from "@/api/contracts";
import { createMockServices } from "@/api/mock/mockServices";
import type { ScenarioId } from "@/api/mock/scenarios";
import type { Consent, Language } from "@/api/types";
import { createTestRouter } from "@/router";
import type { Preferences } from "@/state/preferences";
import { initialSessionState, sessionReducer, type SessionState } from "@/state/session";

export function mockServices(scenario: ScenarioId = "water") {
  return createMockServices({ delayMs: 0, partialIntervalMs: 60_000, scenario });
}

/** Renders the whole app at `path` with zero-latency mock services. */
export async function renderApp(path: string, opts: { services?: Services; session?: SessionState; preferences?: Partial<Preferences> } = {}) {
  const services = opts.services ?? mockServices();
  const router = createTestRouter(path);
  const user = userEvent.setup();
  await act(async () => {
    render(<App services={services} router={router} initialSession={opts.session} initialPreferences={opts.preferences} />);
    await router.load();
  });
  await screen.findByRole("main");
  return { services, router, user };
}

/** An active session created through the service, with only the given consents switched on. */
export async function activeSession(
  services: Services,
  consent: Partial<Omit<Consent, "recordedAt">> = {},
  { language = "en" as Language, typedOnly = false } = {},
): Promise<SessionState> {
  const created = await services.sessions.create(language);
  const session = await services.sessions.setConsent(created.id, {
    audio_recording: false,
    face_capture: false,
    voice_cloning: false,
    demo_use: false,
    ...consent,
  });
  return sessionReducer(initialSessionState, { type: "session/started", session, typedOnly, at: Date.now() });
}
