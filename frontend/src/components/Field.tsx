import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { langFor } from "@/lib/dom";

interface FieldShell {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  maxChars?: number;
}

function Counter({ value, max, id }: { value: string; max: number; id: string }) {
  const over = value.length > max;
  return (
    <span id={id} className={`field__count${over ? " is-over" : ""}`} aria-live={over ? "polite" : "off"}>
      {value.length} / {max} characters{over ? " — too long" : ""}
    </span>
  );
}

export function TextField({ label, hint, error, maxChars, value, ...rest }: FieldShell & InputHTMLAttributes<HTMLInputElement> & { value: string }) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const countId = `${id}-count`;
  const describedBy = [hint && hintId, error && errId, maxChars && countId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="field">
      <label htmlFor={id} className="field__label">{label}</label>
      {hint && <p id={hintId} className="field__hint">{hint}</p>}
      <input id={id} className="field__input" value={value} lang={langFor(value)} aria-invalid={!!error || undefined} aria-describedby={describedBy} {...rest} />
      <div className="field__foot">
        {error ? <p id={errId} className="field__error" role="alert">{error}</p> : <span />}
        {maxChars !== undefined && <Counter value={value} max={maxChars} id={countId} />}
      </div>
    </div>
  );
}

export const TextArea = forwardRef<HTMLTextAreaElement, FieldShell & TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }>(function TextArea(
  { label, hint, error, maxChars, value, ...rest },
  ref,
) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const countId = `${id}-count`;
  const describedBy = [hint && hintId, error && errId, maxChars && countId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="field">
      <label htmlFor={id} className="field__label">{label}</label>
      {hint && <p id={hintId} className="field__hint">{hint}</p>}
      <textarea ref={ref} id={id} className="field__input field__input--area" value={value} lang={langFor(value)} aria-invalid={!!error || undefined} aria-describedby={describedBy} {...rest} />
      <div className="field__foot">
        {error ? <p id={errId} className="field__error" role="alert">{error}</p> : <span />}
        {maxChars !== undefined && <Counter value={value} max={maxChars} id={countId} />}
      </div>
    </div>
  );
});

interface Option<T extends string> {
  value: T;
  label: ReactNode;
  description?: ReactNode;
  lang?: string;
}

/** Radio group rendered as large segmented choices. Arrow keys move between options natively. */
export function ChoiceGroup<T extends string>({
  legend,
  name,
  value,
  onChange,
  options,
  hint,
  compact,
}: {
  legend: string;
  name: string;
  value: T;
  onChange: (v: T) => void;
  options: Option<T>[];
  hint?: ReactNode;
  compact?: boolean;
}) {
  const hintId = useId();
  return (
    <fieldset className={`choices${compact ? " choices--compact" : ""}`} aria-describedby={hint ? hintId : undefined}>
      <legend className="field__label">{legend}</legend>
      {hint && <p id={hintId} className="field__hint">{hint}</p>}
      <div className="choices__row">
        {options.map((o) => (
          <label key={o.value} className={`choice${o.value === value ? " is-selected" : ""}`} lang={o.lang}>
            <input type="radio" name={name} value={o.value} checked={o.value === value} onChange={() => onChange(o.value)} />
            <span className="choice__label">{o.label}</span>
            {o.description && <span className="choice__desc">{o.description}</span>}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
