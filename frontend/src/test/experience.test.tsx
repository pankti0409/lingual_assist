import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { activeSession, mockServices, renderApp } from "./render";

describe("quick expressions", () => {
  it("a tile shows the exact words, confirms through the normal pipeline, and never plays before Play", async () => {
    const services = mockServices("water");
    const speak = vi.spyOn(services.conversation, "speak");
    const edit = vi.spyOn(services.conversation, "edit");
    const session = await activeSession(services, {}, { typedOnly: true });
    const { user } = await renderApp("/expressions", { services, session });

    await user.click(screen.getByRole("button", { name: /^yes\. — review before saying/i }));
    const dialog = await screen.findByRole("dialog", { name: /say this\?/i });
    expect(within(dialog).getByText("Yes.", { selector: "blockquote" })).toBeInTheDocument();
    expect(edit).not.toHaveBeenCalled();
    expect(speak).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: /confirm these exact words/i }));
    const play = await within(await screen.findByRole("dialog", { name: /ready to say/i })).findByRole("button", { name: /^play: yes\./i });
    expect(edit).toHaveBeenCalledWith(session.session!.id, expect.any(String), "Yes."); // confirmed word for word
    expect(speak).not.toHaveBeenCalled(); // confirming is not speaking

    await user.click(play);
    await waitFor(() => expect(speak).toHaveBeenCalledTimes(1));
    expect(speak.mock.calls[0][1]).toMatch(/^confirmed-/);
    // the expression is part of the conversation like any other message
    const history = await services.conversation.history(session.session!.id);
    expect(history.at(-1)).toMatchObject({ speaker: "patient", text: "Yes.", source: "typed" });
  });

  it("without a session it can be shown large but not spoken", async () => {
    const { user } = await renderApp("/expressions");
    await user.click(screen.getByRole("button", { name: /^hello! — review before saying/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/start a session to say this aloud/i)).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /confirm these exact words/i })).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: /show large/i }));
    expect(await within(dialog).findByText("Hello!", { selector: ".subtitle--huge" })).toBeInTheDocument();
  });

  it("emergency tiles say clearly that they do not call anyone", async () => {
    const { user } = await renderApp("/expressions");
    await user.click(screen.getByRole("radio", { name: /emergency/i }));
    expect(screen.getByText(/these tiles say the words aloud — they do not call anyone/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^i need help now\. — review before saying/i }));
    expect(within(await screen.findByRole("dialog")).getByText(/it does not call anyone/i)).toBeInTheDocument();
  });

  it("search, favourites and custom expressions work and are kept on this device", async () => {
    const { user } = await renderApp("/expressions");
    await user.type(screen.getByRole("searchbox", { name: /search expressions/i }), "water");
    expect(screen.getByRole("button", { name: /^i would like some water, please\. — review/i })).toBeInTheDocument();
    await user.clear(screen.getByRole("searchbox"));
    await user.type(screen.getByRole("searchbox"), "zzzz");
    expect(screen.getByText(/nothing matches “zzzz”/i)).toBeInTheDocument();
    await user.clear(screen.getByRole("searchbox"));

    await user.click(screen.getByRole("radio", { name: /yes \/ no/i }));
    const fav = screen.getByRole("button", { name: /^add to favourites: maybe\./i });
    await user.click(fav);
    expect(screen.getByRole("button", { name: /^favourite: maybe\. — press to remove/i })).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByText("First Expression Saved", { selector: ".celebrate__title" })).toBeInTheDocument();
    await waitFor(() => expect(window.localStorage.getItem("lingual-assist:preferences:v1")).toContain("maybe"));

    await user.click(screen.getByRole("button", { name: /create your own/i }));
    const dialog = await screen.findByRole("dialog", { name: /create your own expression/i });
    await user.type(within(dialog).getByLabelText(/words to say/i), "Please call Meena");
    await user.click(within(dialog).getByRole("button", { name: /save expression/i }));
    await user.click(screen.getByRole("radio", { name: /yours/i }));
    expect(screen.getByRole("button", { name: /^please call meena — review before saying/i })).toBeInTheDocument();
  });
});

describe("settings and personalisation", () => {
  it("text size, button size, contrast and motion apply to the whole document", async () => {
    const { user } = await renderApp("/settings");
    await user.click(screen.getByRole("radio", { name: /largest/i }));
    expect(document.documentElement.style.getPropertyValue("--font-scale")).toBe("1.5");
    await user.click(screen.getByRole("radio", { name: /extra large/i }));
    expect(document.documentElement.dataset.targets).toBe("xl");
    await user.click(screen.getByRole("switch", { name: /high contrast/i }));
    expect(document.documentElement.dataset.contrast).toBe("high");
    await user.click(screen.getByRole("radio", { name: /reduce motion/i }));
    expect(document.documentElement.dataset.motion).toBe("reduced");
  });

  it("switching the journey off hides it and stops recording", async () => {
    const services = mockServices("water");
    const { user } = await renderApp("/settings", { services });
    await user.click(screen.getByRole("switch", { name: /show progress and badges/i }));
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).queryByRole("link", { name: "Progress" })).toBeNull();
    await user.click(within(nav).getByRole("link", { name: "Session setup" }));
    await user.click(await screen.findByRole("button", { name: /start the session/i }));
    await screen.findByRole("heading", { level: 1, name: /talk, review, then speak/i });
    expect(window.localStorage.getItem("lingual-assist:journey:v1") ?? "").not.toContain("session-started");
  });
});

describe("journey", () => {
  it("steps and badges come only from real actions", async () => {
    const { user } = await renderApp("/journey");
    expect(screen.getByRole("progressbar", { name: /optional steps done/i })).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getAllByText("Not yet").length).toBeGreaterThanOrEqual(5);
    await user.click(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Session setup" }));
    await user.click(await screen.findByRole("button", { name: /start the session/i }));
    await screen.findByRole("heading", { level: 1, name: /talk, review, then speak/i });
    await user.click(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Progress" }));
    const bar = await screen.findByRole("progressbar", { name: /optional steps done/i });
    expect(bar).toHaveAttribute("aria-valuenow", "1");
    expect(screen.getByText("Your communication space is ready.")).toBeInTheDocument();
  });
});

describe("voice studio", () => {
  it("pitch is not offered when the voice engine can't change it; settings save locally", async () => {
    const { user } = await renderApp("/voice");
    expect(screen.queryByRole("slider", { name: /pitch/i })).toBeNull();
    expect(screen.getByText(/pitch can’t be changed here: this browser has no built-in voice/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Brisk" }));
    expect(screen.getByRole("slider", { name: /speaking speed/i })).toHaveValue("1.2");
    await user.click(screen.getByRole("button", { name: /save settings/i }));
    expect(await screen.findByText("Saved on this device.")).toBeInTheDocument();
    expect(window.localStorage.getItem("lingual-assist:preferences:v1")).toContain('"rate":1.2');
  });
});

describe("talk workspace", () => {
  it("signals show real states, the meaning is labelled, and a confirmed reply joins the timeline", async () => {
    const services = mockServices("water");
    const session = await activeSession(services, {}, { typedOnly: true });
    const { user } = await renderApp("/conversation", { services, session });
    const signals = screen.getByRole("region", { name: /what the assistant can use/i });
    expect(within(signals).getByText("Typing only in this session")).toBeInTheDocument();
    expect(within(signals).getAllByText("Needs face and hand consent")).toHaveLength(2); // no invented cues
    expect(within(signals).getByText(/never guesses feelings/i)).toBeInTheDocument();
    expect(within(signals).getByText("Not available")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Patient" }));
    await user.type(screen.getByLabelText(/type the patient’s message/i), "water please");
    await user.click(screen.getByRole("button", { name: /add patient message/i }));
    await screen.findByRole("list", { name: /suggested replies/i });
    expect(screen.getByText("Suggested meaning")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /could i have some water/i }));
    expect(screen.getByText("Suggested · not spoken")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /confirm these exact words/i }));
    await screen.findByRole("button", { name: /^play: could i have some water/i });
    const timeline = screen.getByRole("list", { name: /conversation transcript/i });
    expect(within(timeline).getByText("Could I have some water?")).toBeInTheDocument();
    expect(within(timeline).getByText("Confirmed")).toBeInTheDocument();
    expect(await screen.findByText("First Conversation", { selector: ".celebrate__title" })).toBeInTheDocument();
  });
});

describe("suggest different replies", () => {
  it("records the current suggestions as rejected, asks again, and speaks nothing", async () => {
    const services = mockServices("water");
    const reject = vi.spyOn(services.conversation, "reject");
    const finish = vi.spyOn(services.conversation, "finishTurn");
    const speak = vi.spyOn(services.conversation, "speak");
    const session = await activeSession(services, {}, { typedOnly: true });
    const { user } = await renderApp("/conversation", { services, session });
    await user.click(screen.getByRole("radio", { name: "Patient" }));
    await user.type(screen.getByLabelText(/type the patient’s message/i), "water please");
    await user.click(screen.getByRole("button", { name: /add patient message/i }));
    await screen.findByRole("list", { name: /suggested replies/i });
    await user.click(screen.getByRole("button", { name: /suggest different replies/i }));
    await waitFor(() => expect(finish).toHaveBeenCalledTimes(2));
    expect(reject).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("list", { name: /suggested replies/i })).toBeInTheDocument();
    expect(screen.getByText(/waiting for your choice · not spoken/i)).toBeInTheDocument();
    expect(speak).not.toHaveBeenCalled();
  });
});
