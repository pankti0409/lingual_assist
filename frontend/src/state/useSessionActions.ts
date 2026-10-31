import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useServices } from "@/api/ServicesProvider";
import type { ScenarioId } from "@/api/mock/scenarios";
import type { Consent, Language } from "@/api/types";
import { useJourney } from "./journey";
import { useSession } from "./session";

/** Session lifecycle: start (consent always starts off), update consent, end, delete. */
export function useSessionActions() {
  const services = useServices();
  const { state, dispatch } = useSession();
  const qc = useQueryClient();
  const { record } = useJourney();

  const start = useCallback(
    async (language: Language, consent: Omit<Consent, "recordedAt">, typedOnly: boolean) => {
      const created = await services.sessions.create(language);
      // A new session always begins with every consent off; only what the person chose is sent.
      const session = await services.sessions.setConsent(created.id, consent);
      dispatch({ type: "session/started", session, typedOnly, at: Date.now() });
      qc.removeQueries();
      record("session-started");
      return session;
    },
    [services, dispatch, qc, record],
  );

  const updateConsent = useCallback(
    async (consent: Omit<Consent, "recordedAt">) => {
      if (!state.session) return;
      const session = await services.sessions.setConsent(state.session.id, consent);
      dispatch({ type: "session/consent", consent: session.consent });
    },
    [services, state.session, dispatch],
  );

  const end = useCallback(async () => {
    if (!state.session) return;
    services.mock?.setCameraOn(false);
    await services.sessions.end(state.session.id);
    dispatch({ type: "session/ended" });
  }, [services, state.session, dispatch]);

  const remove = useCallback(async () => {
    if (state.session) {
      try {
        await services.sessions.delete(state.session.id);
      } catch {
        /* already gone on the server: still clear everything locally */
      }
    }
    services.mock?.setCameraOn(false);
    dispatch({ type: "session/deleted" });
    qc.removeQueries();
  }, [services, state.session, dispatch, qc]);

  /** Mock only: load a prepared end-state session (ended / deleted) for the prototype scenarios. */
  const loadScenarioEndState = useCallback(
    async (id: ScenarioId) => {
      if (!services.mock) return;
      const sessionId = await services.mock.prepareScenarioSession(id);
      try {
        const session = await services.sessions.get(sessionId);
        const turns = await services.conversation.history(sessionId);
        dispatch({ type: "session/started", session, typedOnly: false, at: Date.now() });
        dispatch({ type: "turns/loaded", turns });
        dispatch({ type: "session/ended" });
      } catch {
        dispatch({ type: "session/missing" });
      }
    },
    [services, dispatch],
  );

  return { start, updateConsent, end, remove, loadScenarioEndState };
}
