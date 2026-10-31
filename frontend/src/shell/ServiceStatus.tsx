import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, CircleSlash, RefreshCw, WifiOff } from "lucide-react";
import { useServices } from "@/api/ServicesProvider";

/**
 * HTTP mode only: what the connected backend can do right now, from GET /health. Missing pieces are
 * named with the setting that enables them, so nobody has to guess why a feature is unavailable.
 */
export function ServiceStatus() {
  const services = useServices();
  const health = useQuery({
    queryKey: ["service-health"],
    queryFn: () => services.connection.health(),
    retry: false,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  if (health.isPending) return <div className="service-strip" role="status">Checking the service…</div>;

  if (health.isError)
    return (
      <div className="service-strip service-strip--down" role="alert">
        <WifiOff size={18} aria-hidden />
        <span>
          <strong>Can’t reach the service.</strong> Check that the backend is running, then try again.
        </span>
        <button type="button" className="btn btn--secondary btn--md" onClick={() => void health.refetch()}>
          <RefreshCw size={16} aria-hidden /> <span>Try again</span>
        </button>
      </div>
    );

  const h = health.data;
  const missing = [
    !h.suggestions && "Suggested replies need GROQ_API_KEY",
    !h.speech && "Recording and voices need ELEVENLABS_API_KEY",
    !h.vision && "Camera cues need the vision model files in assets/",
  ].filter((m): m is string => !!m);

  return (
    <div className={`service-strip${missing.length ? " service-strip--partial" : ""}`} role="note">
      <CheckCircle2 size={18} aria-hidden />
      <span>
        <strong>Connected to the service.</strong>
        {missing.length ? " Some features are switched off on the server:" : " Everything is available."}
      </span>
      {missing.length > 0 && (
        <ul className="service-strip__list">
          {missing.map((m) => (
            <li key={m}>
              <CircleSlash size={15} aria-hidden /> {m}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
