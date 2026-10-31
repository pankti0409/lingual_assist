import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
  // Preferences and the journey live in localStorage: start every test from a clean device.
  window.localStorage.clear();
  for (const k of ["targets", "contrast", "motion", "simple", "focus"]) delete document.documentElement.dataset[k];
  document.documentElement.style.removeProperty("--font-scale");
});

// jsdom gaps used by Motion, the router and media code.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
window.IntersectionObserver ??= NoopObserver as unknown as typeof IntersectionObserver;
window.ResizeObserver ??= NoopObserver as unknown as typeof ResizeObserver;
window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
HTMLMediaElement.prototype.pause = vi.fn();
