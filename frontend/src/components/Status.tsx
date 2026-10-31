import { AlertTriangle, CheckCircle2, CircleDashed, Info, WifiOff, FlaskConical, Loader2 } from "lucide-react";
import type { ReactNode } from "react";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "pending";

const ICONS: Record<Tone, ReactNode> = {
  neutral: <CircleDashed size={18} />,
  info: <Info size={18} />,
  success: <CheckCircle2 size={18} />,
  warning: <AlertTriangle size={18} />,
  danger: <AlertTriangle size={18} />,
  pending: <Loader2 size={18} className="spin" />,
};

/** Status is always icon + words, never colour alone. */
export function StatusBadge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`badge badge--${tone}`}>
      <span aria-hidden className="badge__icon">{ICONS[tone]}</span>
      {children}
    </span>
  );
}

export function Notice({ tone = "info", title, children, action }: { tone?: Tone; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={`notice notice--${tone}`} role={tone === "danger" || tone === "warning" ? "alert" : "status"}>
      <span aria-hidden className="notice__icon">{tone === "warning" && title.toLowerCase().includes("connect") ? <WifiOff size={22} /> : ICONS[tone]}</span>
      <div className="notice__body">
        <p className="notice__title">{title}</p>
        {children && <div className="notice__text">{children}</div>}
      </div>
      {action && <div className="notice__action">{action}</div>}
    </div>
  );
}

/** Labels anything simulated so it can never be mistaken for a real measurement or device. */
export function SimulatedTag({ children = "Simulated" }: { children?: ReactNode }) {
  return (
    <span className="sim-tag">
      <FlaskConical size={15} aria-hidden /> {children}
    </span>
  );
}

/** Polite screen-reader announcements (visually hidden). */
export function LiveRegion({ message, assertive }: { message: string; assertive?: boolean }) {
  return (
    <div className="sr-only" role={assertive ? "alert" : "status"} aria-live={assertive ? "assertive" : "polite"} aria-atomic="true">
      {message}
    </div>
  );
}

export function Metric({ label, value, hint, simulated }: { label: string; value: ReactNode; hint?: ReactNode; simulated?: boolean }) {
  return (
    <div className="metric">
      <dt className="metric__label">{label}</dt>
      <dd className="metric__value">
        {value}
        {simulated && <SimulatedTag>Illustrative</SimulatedTag>}
      </dd>
      {hint && <dd className="metric__hint">{hint}</dd>}
    </div>
  );
}

export function Disclosure({ summary, children, defaultOpen }: { summary: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="disclosure" open={defaultOpen}>
      <summary className="disclosure__summary">{summary}</summary>
      <div className="disclosure__body">{children}</div>
    </details>
  );
}
