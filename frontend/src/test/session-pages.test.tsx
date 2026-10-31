import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { activeSession, mockServices, renderApp } from "./render";

describe("review: end and delete", () => {
  it("delete asks for confirmation (focus trapped, restored on cancel) and then clears everything", async () => {
    const services = mockServices("water");
    const session = await activeSession(services, {}, { typedOnly: true });
    await services.conversation.addTypedTurn(session.session!.id, "partner", "Water or tea?", "en");
    const turns = await services.conversation.history(session.session!.id);
    const { user, router } = await renderApp("/review", { services, session: { ...session, turns, drafts: { typed: "unsent draft", edit: "" } } });

    expect(screen.getByRole("heading", { level: 1, name: /this session so far/i })).toBeInTheDocument();
    expect(screen.getByText(/does not define accounts or permanent history/i)).toBeInTheDocument();
    const opener = screen.getByRole("button", { name: /delete session/i });
    await user.click(opener);
    const dialog = await screen.findByRole("dialog", { name: /delete this session/i });
    const keep = within(dialog).getByRole("button", { name: /keep the session/i });
    await waitFor(() => expect(keep).toHaveFocus());
    // Tab cycles inside the dialog
    await user.tab();
    await user.tab();
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(opener).toHaveFocus());

    await user.click(opener);
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /delete permanently/i }));
    expect(await screen.findByRole("heading", { name: /this session was deleted/i })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/conversation");
    await expect(services.sessions.get(session.session!.id)).rejects.toMatchObject({ code: "not_found" });
    await user.click(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Review" }));
    expect(await screen.findByRole("heading", { level: 1, name: /the session was deleted/i })).toBeInTheDocument();
    expect(screen.queryByText("Water or tea?")).toBeNull();
  });

  it("ending a session makes the conversation read-only", async () => {
    const services = mockServices("water");
    const session = await activeSession(services, {}, { typedOnly: true });
    const { user } = await renderApp("/conversation", { services, session });
    await user.click(screen.getByRole("button", { name: /end session/i }));
    expect(await screen.findByText(/this session has ended/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/type the .* message/i)).toBeNull();
  });
});

describe("gestures", () => {
  it("lists all eight gestures and limits meanings to 40 characters", async () => {
    const services = mockServices();
    const session = await activeSession(services, { face_capture: true });
    const { user } = await renderApp("/gestures", { services, session });
    for (const n of ["Closed fist", "Open palm", "Pointing up", "Thumb down", "Thumb up", "Victory (two fingers)", "“I love you” hand", "No gesture"]) {
      expect(screen.getByLabelText(`${n} — meaning`)).toBeInTheDocument();
    }
    expect(screen.getByText(/does not detect which object someone is pointing at/i)).toBeInTheDocument();
    const field = screen.getByLabelText("Victory (two fingers) — meaning");
    await user.type(field, "x".repeat(41));
    expect(screen.getByText("Up to 40 characters.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save meanings/i })).toBeDisabled();
    await user.clear(field);
    await user.type(field, "call my nurse");
    await user.click(screen.getByRole("button", { name: /save meanings/i }));
    expect(await screen.findByText("Saved for this session", { selector: ".notice__title" })).toBeInTheDocument();
  });

  it("the simulated test area explains each detection state", async () => {
    const { user } = await renderApp("/gestures");
    for (const [label, text] of [
      ["Detected, unstable", /detected but not yet stable/i],
      ["Low confidence", /^low confidence$/i],
      ["Stale", /^stale$/i],
      ["Unavailable", /cues unavailable/i],
      ["Unmapped", /^unmapped$/i],
      ["Stable and fresh", /stable and fresh/i],
    ] as const) {
      await user.click(screen.getByRole("radio", { name: label }));
      expect(within(screen.getByRole("status", { name: "Test result" })).getByText(text)).toBeInTheDocument();
    }
  });
});

describe("evaluation", () => {
  it("labels every mock result and keeps WER identical across arms", async () => {
    const { user } = await renderApp("/evaluation");
    expect(screen.getByText(/no evaluation has run yet/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /run mock evaluation/i }));
    expect(await screen.findByText("Illustrative mock results — not measurements.", { selector: "strong" })).toBeInTheDocument();
    const tables = screen.getAllByRole("table");
    expect(tables.length).toBeGreaterThanOrEqual(3);
    for (const t of tables) expect(within(t).getByText(/illustrative mock results — not measurements\./i)).toBeInTheDocument();
    expect(screen.getByText(/visual cues do not change transcripts, so no wer improvement is claimed/i)).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Transcript + conversation context" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Transcript + conversation context + visual cues" })).toBeInTheDocument();
  });

  it("live mode without a backend shows the unavailable state", async () => {
    const { user } = await renderApp("/evaluation");
    await user.click(screen.getByRole("radio", { name: /live/i }));
    await user.click(screen.getByRole("button", { name: /run live evaluation/i }));
    expect(await screen.findByText(/live evaluation is unavailable/i)).toBeInTheDocument();
  });
});

describe("voice", () => {
  it("cloning is gated by consent and mock mode never claims an upload", async () => {
    const services = mockServices();
    const session = await activeSession(services, {});
    const { user } = await renderApp("/voice", { services, session });
    expect(screen.getByText(/voice cloning consent is off, so no sample can be added/i)).toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: /voice cloning consent/i }));
    expect(await screen.findByText(/the file is not read, uploaded or stored/i)).toBeInTheDocument();
    expect(screen.getByText(/no voice — text-only/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/describe the voice/i), "A calm, warm adult voice");
    await user.click(screen.getByRole("button", { name: /create designed voice/i }));
    expect(await screen.findByText(/designed voice — not a clone/i)).toBeInTheDocument();
  });
});
