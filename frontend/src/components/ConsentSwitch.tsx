import { Check, Minus } from "lucide-react";
import { useId, type ReactNode } from "react";

interface ConsentSwitchProps {
  title: string;
  description: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** What becomes possible when this is on (shown next to the state, not colour alone). */
  enables?: string;
}

/**
 * One consent decision. Each purpose is its own switch: there is deliberately no "accept all".
 * State is spoken ("On"/"Off") and shown as text and icon, never by colour alone.
 */
export function ConsentSwitch({ title, description, checked, onChange, disabled, enables }: ConsentSwitchProps) {
  const id = useId();
  return (
    <div className={`consent${checked ? " is-on" : ""}`}>
      <div className="consent__text">
        <span id={`${id}-title`} className="consent__title">{title}</span>
        <p id={`${id}-desc`} className="consent__desc">{description}</p>
        {enables && <p className="consent__enables">{checked ? `Allows: ${enables}` : `Off: ${enables} stays unavailable`}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-desc`}
        className="switch"
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <span className="switch__track" aria-hidden>
          <span className="switch__thumb">{checked ? <Check size={16} /> : <Minus size={16} />}</span>
        </span>
        <span className="switch__state">{checked ? "On" : "Off"}</span>
      </button>
    </div>
  );
}
