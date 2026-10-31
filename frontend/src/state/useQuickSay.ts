/**
 * Saying a quick expression. It runs only after the person has pressed "Confirm" on the exact
 * words, and it goes through the same server-side path as every other message:
 *
 *   patient turn (typed) -> proposal -> edit-confirm with exactly these words -> confirmed message
 *
 * so the service still only ever speaks a confirmed message, and the expression appears in the
 * conversation like anything else the person said.
 */
import { useCallback, useState } from "react";
import { useServices } from "@/api/ServicesProvider";
import { ApiError, type ConfirmedMessage } from "@/api/types";
import { useJourney } from "./journey";
import { useSession } from "./session";

export function useQuickSay() {
  const services = useServices();
  const { state, dispatch } = useSession();
  const { record } = useJourney();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const live = state.status === "active" && !!state.session;

  const confirm = useCallback(
    async (text: string): Promise<ConfirmedMessage | null> => {
      const session = state.session;
      if (!session || state.status !== "active") return null;
      setBusy(true);
      setError(null);
      try {
        const turn = await services.conversation.addTypedTurn(session.id, "patient", text, session.language);
        dispatch({ type: "turn/added", turn });
        const proposal = await services.conversation.finishTurn(session.id, { includeVisualCues: false });
        dispatch({ type: "proposal/added", proposal });
        const res = await services.conversation.edit(session.id, proposal.id, text);
        dispatch({
          type: "proposal/updated",
          proposal: { ...res.proposal, evidence: proposal.evidence, clarificationMessage: proposal.clarificationMessage, stageMs: proposal.stageMs },
        });
        dispatch({ type: "decision/counted" });
        if (!res.confirmed) throw new ApiError("invalid_state", "The expression could not be confirmed.");
        dispatch({ type: "confirmed/added", message: res.confirmed });
        record("confirmed-expression");
        return res.confirmed;
      } catch (e) {
        setError(e instanceof ApiError ? e : new ApiError("internal_error", "Something went wrong."));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [state.session, state.status, services, dispatch, record],
  );

  return { live, busy, error, clearError: () => setError(null), confirm };
}
