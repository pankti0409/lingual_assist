import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { MotionConfig } from "motion/react";
import { useState, type ReactNode } from "react";
import type { Services } from "./api/contracts";
import { ServicesProvider } from "./api/ServicesProvider";
import type { createAppRouter } from "./router";
import { AppErrorBoundary } from "./shell/RouteStates";
import { JourneyProvider } from "./state/journey";
import { PreferencesProvider, usePreferences, type Preferences } from "./state/preferences";
import { SessionProvider, type SessionState } from "./state/session";

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15_000 },
      mutations: { retry: 0 },
    },
  });
}

/** Motion follows the system setting unless the person chose otherwise in Settings. */
function Motion({ children }: { children: ReactNode }) {
  const { prefs } = usePreferences();
  const mode = prefs.motion === "reduced" ? "always" : prefs.motion === "full" ? "never" : "user";
  return <MotionConfig reducedMotion={mode}>{children}</MotionConfig>;
}

export function App({
  services,
  router,
  initialSession,
  initialPreferences,
}: {
  services: Services;
  router: ReturnType<typeof createAppRouter>;
  initialSession?: SessionState;
  initialPreferences?: Partial<Preferences>;
}) {
  const [queryClient] = useState(createQueryClient);
  return (
    <AppErrorBoundary>
      <ServicesProvider services={services}>
        <QueryClientProvider client={queryClient}>
          <PreferencesProvider initial={initialPreferences}>
            <JourneyProvider>
              <SessionProvider initial={initialSession}>
                <Motion>
                  <RouterProvider router={router} />
                </Motion>
              </SessionProvider>
            </JourneyProvider>
          </PreferencesProvider>
        </QueryClientProvider>
      </ServicesProvider>
    </AppErrorBoundary>
  );
}
