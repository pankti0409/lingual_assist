import { createContext, useContext, type ReactNode } from "react";
import type { Services } from "./contracts";
import { createHttpServices } from "./http/httpServices";
import { createMockServices } from "./mock/mockServices";

const ServicesContext = createContext<Services | null>(null);

/** Mock by default. Set VITE_API_MODE=http and VITE_API_BASE=http://127.0.0.1:8000 to use the backend. */
export function createDefaultServices(): Services {
  const mode = import.meta.env.VITE_API_MODE;
  if (mode === "http") return createHttpServices(import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000");
  return createMockServices();
}

export function ServicesProvider({ services, children }: { services: Services; children: ReactNode }) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  const s = useContext(ServicesContext);
  if (!s) throw new Error("useServices must be used inside <ServicesProvider>");
  return s;
}
