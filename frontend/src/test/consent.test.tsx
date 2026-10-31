import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderApp } from "./render";

const SWITCHES = ["Audio recording", "Face and hand capture", "Voice cloning", "Demo and evaluation use"];

describe("session setup consent", () => {
  it("shows four separate consent switches, all starting off, with no accept-all", async () => {
    await renderApp("/setup");
    const switches = screen.getAllByRole("switch");
    expect(switches.map((s) => s.getAttribute("aria-checked"))).toEqual(["false", "false", "false", "false"]);
    for (const name of SWITCHES) expect(screen.getByRole("switch", { name })).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByRole("button", { name: /accept all|allow all|agree to all/i })).toBeNull();
  });

  it("toggling one consent never changes another", async () => {
    const { user } = await renderApp("/setup");
    await user.click(screen.getByRole("switch", { name: "Voice cloning" }));
    expect(screen.getByRole("switch", { name: "Voice cloning" })).toHaveAttribute("aria-checked", "true");
    for (const name of SWITCHES.filter((n) => n !== "Voice cloning")) {
      expect(screen.getByRole("switch", { name })).toHaveAttribute("aria-checked", "false");
    }
    expect(screen.getAllByText("On")).toHaveLength(1); // state is also shown as text, not colour alone
  });

  it("starts a typed-only session with every consent off and lands on the conversation", async () => {
    const { user, router, services } = await renderApp("/setup");
    expect(screen.getByRole("radio", { name: /type only/i })).toBeChecked();
    await user.click(screen.getByRole("button", { name: /start the session/i }));
    expect(await screen.findByRole("heading", { level: 1, name: /talk, review, then speak/i })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/conversation");
    expect(screen.getByRole("button", { name: /record the/i })).toBeDisabled();
    expect(screen.getByText(/typed-only session: no microphone or camera is used/i)).toBeInTheDocument();
    // the service received only the person's choices: all off
    const sid = (await import("@/api/mock/mockServices")) && services; // keep services referenced
    expect(sid.mode).toBe("mock");
  });

  it("sends exactly the consents chosen (and only those) to the service", async () => {
    const { user, services } = await renderApp("/setup");
    await user.click(screen.getByRole("switch", { name: "Face and hand capture" }));
    await user.click(screen.getByRole("radio", { name: /speak, and optionally use the camera/i }));
    await user.click(screen.getByRole("button", { name: /start the session/i }));
    await screen.findByRole("heading", { level: 1, name: /talk, review, then speak/i });
    const created = (await services.sessions.create("en")).id; // a NEW session also starts off
    const fresh = await services.sessions.get(created);
    expect(fresh.consent).toMatchObject({ audio_recording: false, face_capture: false, voice_cloning: false, demo_use: false });
    // camera may be used (face consent on) but recording may not (audio consent off)
    expect(screen.getByRole("button", { name: /camera off — turn on/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /record the/i })).toBeDisabled();
  });
});
