import { useId, type ReactNode } from "react";

/**
 * A large, labelled range control with quick presets. The value is always written out, and the
 * native range input keeps arrow-key, Home/End and Page Up/Down support.
 */
export function Slider({
  label,
  hint,
  value,
  min,
  max,
  step,
  onChange,
  format,
  presets,
  disabled,
  icon,
}: {
  label: string;
  hint?: ReactNode;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
  presets?: { label: string; value: number }[];
  disabled?: boolean;
  icon?: ReactNode;
}) {
  const id = useId();
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className={`slider${disabled ? " is-disabled" : ""}`}>
      <div className="slider__head">
        <label htmlFor={id} className="slider__label">
          {icon && <span className="slider__icon" aria-hidden>{icon}</span>}
          {label}
        </label>
        <output htmlFor={id} className="slider__value">{format(value)}</output>
      </div>
      {hint && <p className="field__hint" id={`${id}-hint`}>{hint}</p>}
      <input
        id={id}
        type="range"
        className="slider__input"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={format(value)}
        aria-describedby={hint ? `${id}-hint` : undefined}
        style={{ ["--pct" as string]: `${pct}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {presets && (
        <div className="slider__presets" role="group" aria-label={`${label} presets`}>
          {presets.map((p) => (
            <button key={p.label} type="button" className={`chip${Math.abs(p.value - value) < 1e-6 ? " is-on" : ""}`} aria-pressed={Math.abs(p.value - value) < 1e-6} disabled={disabled} onClick={() => onChange(p.value)}>
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
