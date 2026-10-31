import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/types";
import { activeSession, mockServices, renderApp } from "./render";

const transcript = () => screen.getByRole("list", { name: /conversation transcript/i });

async function typePatient(user: ReturnType<typeof import("@testing-library/user-event").default.setup>, text: string) {
  await user.click(screen.getByRole("radio", { name: "Patient" }));
  const box = screen.getByLabelText(/type the patient’s message/i);
  await user.clear(box);
  await user.type(box, text);
  await user.click(screen.getByRole("button", { name: /add patient message/i }));
}

describe("conversation: patient control", () => {
  it("typed-only path: suggestions → exact-text review → confirm; playback is never automatic", async () => {
    const services = mockServices("water");
    const speak = vi.spyOn(services.conversation, "speak");
    const session = await activeSession(services, {}, { typedOnly: true });
    const { user } = await renderApp("/conversation", { services, session });

    await typePatient(user, "water please");
    const list = await screen.findByRole("list", { name: /suggested replies/i });
    const replies = within(list).getAllByRole("button");
    expect(replies.length).toBeGreaterThanOrEqual(2);
    expect(replies.length).toBeLessThanOrEqual(3);
    expect(screen.queryByRole("button", { name: /^play/i })).toBeNull(); // pending: nothing playable

    await user.click(within(list).getByRole("button", { name: /i would like water, please/i }));
    expect(screen.getByText(/you will say exactly/i)).toBeInTheDocument();
    expect(screen.getByText("I would like water, please.", { selector: "blockquote" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^play/i })).toBeNull(); // still not confirmed

    await user.click(screen.getByRole("button", { name: /confirm these exact words/i }));
    const play = await screen.findByRole("button", { name: /play: i would like water, please\./i });
    expect(screen.getByText("Not played yet")).toBeInTheDocument();
    expect(speak).not.toHaveBeenCalled(); // no autoplay after confirmation

    await user.click(play);
    await waitFor(() => expect(speak).toHaveBeenCalledTimes(1));
    const confirmedId = speak.mock.calls[0][1];
    expect(confirmedId).toMatch(/^confirmed-/);
  });

  it("rejected and clarification proposals cannot be played", async () => {
    const services = mockServices("rejected-retry");
    const speak = vi.spyOn(services.conversation, "speak");
    const session = await activeSession(services, {}, { typedOnly: true });
    const { user } = await renderApp("/conversation", { services, session });

    await typePatient(user, "wa... water");
    await screen.findByRole("list", { name: /suggested replies/i });
    await user.click(screen.getByRole("button", { name: /none of these/i }));
    expect(await screen.findByText(/suggestions rejected\. nothing was spoken/i, { selector: ".notice__title" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^play/i })).toBeNull();

    await user.click(screen.getByRole("button", { name: /try again/i }));
    const list = await screen.findByRole("list", { name: /suggested replies/i });
    expect(within(list).getByRole("button", { name: /could i have some water/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /ask to clarify/i }));
    expect(await screen.findByText(/clarification requested\. nothing was spoken/i, { selector: ".notice__title" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^play/i })).toBeNull();
    expect(speak).not.toHaveBeenCalled();
  });

  it("an ambiguous turn asks for clarification instead of guessing", async () => {
    const services = mockServices("ambiguous");
    const session = await activeSession(services, { audio_recording: true });
    const { user } = await renderApp("/conversation", { services, session });
    await user.click(screen.getByRole("radio", { name: "Patient" }));
    await user.click(screen.getByRole("button", { name: /record the patient/i }));
    await user.click(await screen.findByRole("button", { name: /finish speaking/i }));
    expect(await screen.findByText("I did not understand - please choose, repeat or clarify.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: /suggested replies/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^play/i })).toBeNull();
  });

  it("partial transcripts are shown as listening and never become turns until finished", async () => {
    const services = mockServices("water");
    const session = await activeSession(services, { audio_recording: true });
    const { user } = await renderApp("/conversation", { services, session });
    await user.click(screen.getByRole("radio", { name: "Partner" }));
    await user.click(screen.getByRole("button", { name: /record the partner/i }));
    expect(await screen.findByText(/still listening \(not saved\)/i)).toBeInTheDocument();
    expect(screen.getByText("Would you")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: /conversation transcript/i })).toBeNull(); // no turns yet
    expect(await services.conversation.history(session.session!.id)).toEqual([]);

    await user.click(screen.getByRole("button", { name: /finish speaking/i }));
    expect(await within(transcript()).findByText("Would you like water or tea?")).toBeInTheDocument();
    expect(screen.queryByText(/still listening/i)).toBeNull();
    expect(within(transcript()).getByText("Partner")).toBeInTheDocument(); // speaker role is explicit
  });

  it("a stable gesture informs suggestions but never approves or speaks them", async () => {
    const services = mockServices("water");
    const speak = vi.spyOn(services.conversation, "speak");
    const confirm = vi.spyOn(services.conversation, "confirm");
    const session = await activeSession(services, { audio_recording: true, face_capture: true });
    const { user } = await renderApp("/conversation", { services, session });
    await user.click(screen.getByRole("button", { name: /camera off — turn on/i }));
    expect(await screen.findByText(/thumb up/i, { selector: ".cue-list__value" })).toBeInTheDocument();
    expect(screen.getByText("stable")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Patient" }));
    await user.click(screen.getByRole("button", { name: /record the patient/i }));
    await user.click(await screen.findByRole("button", { name: /finish speaking/i }));
    await screen.findByRole("list", { name: /suggested replies/i });
    await user.click(screen.getByText(/why these suggestions/i));
    expect(screen.getByText(/stable gesture thumb up \(your meaning: “yes”\)/i)).toBeInTheDocument();
    // the cue stays stable for a while: still nothing confirmed, nothing spoken
    await new Promise((r) => setTimeout(r, 50));
    expect(confirm).not.toHaveBeenCalled();
    expect(speak).not.toHaveBeenCalled();
    expect(screen.getByText(/waiting for your choice · not spoken/i)).toBeInTheDocument();
  });

  it("edited Hindi–English text is confirmed and spoken exactly as written", async () => {
    const services = mockServices("edited");
    const speak = vi.spyOn(services.conversation, "speak");
    const session = await activeSession(services, {}, { language: "mixed", typedOnly: true });
    const { user } = await renderApp("/conversation", { services, session });
    await typePatient(user, "मुझे... water");
    await screen.findByRole("list", { name: /suggested replies/i });
    await user.click(screen.getByRole("button", { name: /edit a reply/i }));
    const box = screen.getByLabelText(/edit the message/i);
    const exact = "मुझे ठंडा पानी चाहिए, please।";
    await user.clear(box);
    await user.type(box, exact);
    await user.click(screen.getByRole("button", { name: /review edited message/i }));
    const quote = screen.getByText(exact, { selector: "blockquote" });
    expect(quote).toHaveAttribute("lang", "hi");
    await user.click(screen.getByRole("button", { name: /confirm these exact words/i }));
    const subtitle = await screen.findByText(exact, { selector: ".subtitle" });
    expect(subtitle.textContent).toBe(exact);
    await user.click(screen.getByRole("button", { name: new RegExp(`^play: ${exact.slice(0, 5)}`, "i") }));
    await waitFor(() => expect(speak).toHaveBeenCalled());
    const res = await speak.mock.results[0].value;
    expect(res.subtitle).toBe(exact); // the server-side confirmed text is byte-for-byte the same
  });

  it("keeps drafts through a disconnection and recovers", async () => {
    const services = mockServices("disconnect");
    const session = await activeSession(services, {}, { typedOnly: true });
    const { user } = await renderApp("/conversation", { services, session });
    await typePatient(user, "water");
    await screen.findByRole("list", { name: /suggested replies/i });
    expect(await screen.findByText(/disconnected from the service/i)).toBeInTheDocument();

    const box = screen.getByLabelText(/type the patient’s message/i);
    await user.type(box, "a draft I care about");
    await user.click(screen.getByRole("button", { name: /add patient message/i }));
    expect(await screen.findByText(/couldn’t reach the service/i)).toBeInTheDocument();
    expect(box).toHaveValue("a draft I care about");

    await user.click(screen.getByRole("button", { name: /reconnect/i }));
    await waitFor(() => expect(screen.queryByText(/disconnected from the service|reconnecting/i)).toBeNull(), { timeout: 3000 });
    expect(box).toHaveValue("a draft I care about");
  });
});

describe("mock service enforces the confirmation rules", () => {
  it("speak accepts only confirmed ids; decisions are idempotent and conflicts are refused", async () => {
    const services = mockServices("water");
    const s = await services.sessions.create("en");
    await services.conversation.addTypedTurn(s.id, "patient", "water", "en");
    const p = await services.conversation.finishTurn(s.id, { includeVisualCues: true });
    await expect(services.conversation.speak(s.id, p.id)).rejects.toMatchObject({ code: "invalid_state" });
    await expect(services.conversation.speak(s.id, "random-id")).rejects.toMatchObject({ code: "not_found" });
    const a = await services.conversation.confirm(s.id, p.id, 0);
    const b = await services.conversation.confirm(s.id, p.id, 0);
    expect(a.confirmed!.id).toBe(b.confirmed!.id);
    await expect(services.conversation.confirm(s.id, p.id, 1)).rejects.toBeInstanceOf(ApiError);
    await expect(services.conversation.reject(s.id, p.id)).rejects.toMatchObject({ code: "invalid_state" });
    const spoken = await services.conversation.speak(s.id, a.confirmed!.id);
    expect(spoken.subtitle).toBe(a.confirmed!.text);
  });

  it("capture requires audio consent and cloning requires voice-cloning consent", async () => {
    const services = mockServices("water");
    const s = await services.sessions.create("en");
    await expect(services.conversation.startCapture(s.id, "patient", "en")).rejects.toMatchObject({ code: "consent_required" });
    await expect(services.voices.clone(s.id, "me", new File(["x"], "s.wav"))).rejects.toMatchObject({ code: "consent_required" });
  });
});
