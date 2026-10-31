/** Typed, code-split route tree. Every route is directly addressable. */
// Routes: / /conversation /expressions /voice /journey /settings /gestures /setup /review /evaluation /screens (+ not found)
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  type RouterHistory,
} from "@tanstack/react-router";
import { isScenarioId, type ScenarioId } from "@/api/mock/scenarios";
import { AppShell } from "@/shell/AppShell";
import { NotFoundPage, RouteError, RouteLoading } from "@/shell/RouteStates";

export const rootRoute = createRootRoute({
  component: AppShell,
  notFoundComponent: NotFoundPage,
  errorComponent: RouteError,
});

const page = <T extends string>(path: T, loader: () => Promise<Record<string, unknown>>, name: string) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path,
    component: lazyRouteComponent(loader as never, name as never),
    pendingComponent: RouteLoading,
  });

export const homeRoute = page("/", () => import("@/pages/home/HomePage"), "HomePage");
export const setupRoute = page("/setup", () => import("@/pages/SetupPage"), "SetupPage");
export const voiceRoute = page("/voice", () => import("@/pages/VoicePage"), "VoicePage");
export const gesturesRoute = page("/gestures", () => import("@/pages/GesturesPage"), "GesturesPage");
export const reviewRoute = page("/review", () => import("@/pages/ReviewPage"), "ReviewPage");
export const evaluationRoute = page("/evaluation", () => import("@/pages/EvaluationPage"), "EvaluationPage");
export const screensRoute = page("/screens", () => import("@/pages/ScreensPage"), "ScreensPage");
export const expressionsRoute = page("/expressions", () => import("@/pages/ExpressionsPage"), "ExpressionsPage");
export const journeyRoute = page("/journey", () => import("@/pages/JourneyPage"), "JourneyPage");
export const settingsRoute = page("/settings", () => import("@/pages/SettingsPage"), "SettingsPage");

export interface ConversationSearch {
  scenario?: ScenarioId;
}

export const conversationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/conversation",
  validateSearch: (search: Record<string, unknown>): ConversationSearch => (isScenarioId(search.scenario) ? { scenario: search.scenario } : {}),
  component: lazyRouteComponent(() => import("@/pages/conversation/ConversationPage"), "ConversationPage"),
  pendingComponent: RouteLoading,
});

export const routeTree = rootRoute.addChildren([
  homeRoute,
  setupRoute,
  conversationRoute,
  expressionsRoute,
  voiceRoute,
  journeyRoute,
  settingsRoute,
  gesturesRoute,
  reviewRoute,
  evaluationRoute,
  screensRoute,
]);

export function createAppRouter(history?: RouterHistory) {
  return createRouter({
    routeTree,
    history,
    defaultPendingMs: 120,
    defaultPendingMinMs: 200,
    scrollRestoration: true,
    defaultPreload: "intent",
  });
}

export const createTestRouter = (path: string) => createAppRouter(createMemoryHistory({ initialEntries: [path] }));

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
  interface HistoryState {
    /** Set by large call-to-action links to play the full-screen route transition. */
    curtain?: boolean;
  }
}
