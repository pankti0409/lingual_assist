import { Star } from "lucide-react";
import { motion } from "motion/react";
import { categoryOf, iconFor, type Accent, type Expression } from "@/lib/expressions";
import { langFor } from "@/lib/dom";
import { useCalm } from "@/lib/motion";

export function Pictogram({ icon, accent, size = "md" }: { icon: string; accent: Accent; size?: "sm" | "md" | "lg" }) {
  const Icon = iconFor(icon);
  const px = size === "lg" ? 34 : size === "sm" ? 20 : 28;
  return (
    <span className={`picto picto--${accent} picto--${size}`} aria-hidden>
      <Icon size={px} strokeWidth={2} />
    </span>
  );
}

/**
 * A large expression tile. Pressing it opens the exact-words review; it never speaks by itself.
 * The favourite star is a separate, labelled control.
 */
export function ExpressionTile({
  expression,
  favourite,
  onSay,
  onFavourite,
  compact,
}: {
  expression: Expression;
  favourite?: boolean;
  onSay: (e: Expression) => void;
  onFavourite?: (e: Expression) => void;
  compact?: boolean;
}) {
  const calm = useCalm();
  const cat = categoryOf(expression.category);
  return (
    <div className={`xtile xtile--${cat.accent}${expression.category === "emergency" ? " xtile--urgent" : ""}${compact ? " xtile--compact" : ""}`}>
      <motion.button
        type="button"
        className="xtile__main"
        onClick={() => onSay(expression)}
        whileTap={calm ? undefined : { scale: 0.96 }}
        whileHover={calm ? undefined : { y: -3 }}
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
        aria-label={`${expression.text} — review before saying`}
      >
        <Pictogram icon={expression.icon} accent={cat.accent} size={compact ? "md" : "lg"} />
        <span className="xtile__text" lang={langFor(expression.text)}>{expression.text}</span>
        {!compact && <span className="xtile__cat">{expression.custom ? "Your expression" : cat.label}</span>}
      </motion.button>
      {onFavourite && (
        <button
          type="button"
          className={`xtile__fav${favourite ? " is-on" : ""}`}
          aria-pressed={!!favourite}
          aria-label={favourite ? `Remove “${expression.text}” from favourites` : `Add “${expression.text}” to favourites`}
          onClick={() => onFavourite(expression)}
        >
          <Star size={20} aria-hidden fill={favourite ? "currentColor" : "none"} />
        </button>
      )}
    </div>
  );
}
