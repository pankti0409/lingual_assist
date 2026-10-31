import { motion } from "motion/react";
import type { ReactNode } from "react";
import { useCalm } from "@/lib/motion";

/** A progress ring with its value always written in words beside or inside it. */
export function ProgressRing({ value, total, size = 112, label, children }: { value: number; total: number; size?: number; label: string; children?: ReactNode }) {
  const calm = useCalm();
  const stroke = Math.max(8, size / 11);
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct = total ? value / total : 0;
  return (
    <div className="ring" style={{ width: size, height: size }} role="img" aria-label={`${label}: ${value} of ${total}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" className="ring__track" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          className="ring__value"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          initial={calm ? false : { strokeDashoffset: circ }}
          animate={{ strokeDashoffset: circ * (1 - pct) }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="ring__center" aria-hidden>
        {children ?? (
          <>
            <span className="ring__value-text">{value}</span>
            <span className="ring__of">of {total}</span>
          </>
        )}
      </div>
    </div>
  );
}
