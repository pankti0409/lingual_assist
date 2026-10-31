import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderApp } from "./render";

const ROUTES: [string, RegExp, string][] = [
  ["/", /^(good (morning|afternoon|evening)|hello)\.$/i, "Lingual Assist — Your words. Your choice. Your conversation."],
  ["/setup", /choose how this conversation works/i, "Set up a session · Lingual Assist"],
  ["/conversation", /talk, review, then speak/i, "Conversation · Lingual Assist"],
  ["/expressions", /say it in a tap/i, "Quick expressions · Lingual Assist"],
  ["/voice", /find a voice that feels like you/i, "Voice Studio · Lingual Assist"],
  ["/journey", /your progress and badges/i, "Progress and badges · Lingual Assist"],
  ["/settings", /make it yours/i, "Settings · Lingual Assist"],
  ["/gestures", /gestures mean what you decide/i, "Gesture settings · Lingual Assist"],
  ["/review", /no session to review/i, "Session review · Lingual Assist"],
  ["/evaluation", /does combining signals help/i, "Evaluation · Lingual Assist"],
  ["/screens", /every screen and state/i, "Screens and states · Lingual Assist"],
];

describe("routing", () => {
  it.each(ROUTES)("%s renders directly with its heading and document title", async (path, heading, title) => {
    await renderApp(path);
    expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
    expect(document.title).toBe(title);
  });

  it("unknown paths show the not-found page", async () => {
    await renderApp("/no-such-page");
    expect(await screen.findByRole("heading", { level: 1, name: /this page isn’t here/i })).toBeInTheDocument();
    expect(document.title).toBe("Page not found · Lingual Assist");
  });

  it("has a skip link, landmarks and wired navigation", async () => {
    const { user, router } = await renderApp("/setup");
    expect(screen.getByRole("link", { name: /skip to main content/i })).toHaveAttribute("href", "#main");
    expect(screen.getByRole("main")).toHaveAttribute("id", "main");
    const nav = screen.getByRole("navigation", { name: "Main" });
    for (const name of ["Home", "Talk", "Expressions", "Voice Studio", "Progress", "Settings", "Gestures", "Session setup", "Review", "Evaluation", "Screens"]) {
      expect(within(nav).getByRole("link", { name })).toBeInTheDocument();
    }
    expect(within(nav).getByRole("link", { name: "Session setup" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
    await user.click(within(nav).getByRole("link", { name: "Gestures" }));
    expect(await screen.findByRole("heading", { level: 1, name: /gestures mean what you decide/i })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/gestures");
  });

  it("home dashboard: promise, start action, sample, quick expressions and a personal greeting", async () => {
    await renderApp("/", { preferences: { name: "Asha" } });
    expect(screen.getByRole("heading", { level: 1, name: /, asha\.$/i })).toBeInTheDocument();
    expect(screen.getAllByText(/nothing is spoken until you confirm it/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /start conversation/i })).toHaveAttribute("href", "/setup");
    expect(screen.getByRole("link", { name: /try a sample/i })).toHaveAttribute("href", "/conversation?scenario=water");
    expect(screen.getByRole("heading", { name: /your favourite expressions/i })).toBeInTheDocument();
    for (const name of [/communication board/i, /voice settings/i, /text size & comfort/i]) {
      expect(within(screen.getByRole("navigation", { name: "Shortcuts" })).getByRole("link", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: /^hello! — review before saying/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /getting started/i })).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: /optional steps done/i })).toHaveAttribute("aria-valuenow", "0");
  });

  it("simplified interface hides the journey and lab from navigation and the home extras", async () => {
    await renderApp("/", { preferences: { simplified: true } });
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).queryByRole("link", { name: "Evaluation" })).toBeNull();
    expect(screen.queryByRole("heading", { name: /getting started/i })).toBeNull();
    expect(within(nav).queryByRole("link", { name: "Progress" })).toBeNull();
    expect(document.documentElement.dataset.simple).toBe("true");
  });
});
