import { motion } from "motion/react";
import { useCalm } from "@/lib/motion";

/** An informative progress bar: the count is always written out in words beside it. */
export function ProgressBar({ value, total, label }: { value: number; total: number; label: string }) {
  const calm = useCalm();
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div className="pbar">
      <div className="pbar__head">
        <span className="pbar__label">{label}</span>
        <span className="pbar__count">{value} of {total}</span>
      </div>
      <div className="pbar__track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={value} aria-valuetext={`${value} of ${total}`}>
        <motion.span
          className="pbar__fill"
          initial={calm ? false : { width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
    </div>
  );
}
