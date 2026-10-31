/**
 * The companion mascot: a friendly speech bubble that grew out of the brand mark. It is calm by
 * design — one small wave when it first appears (never under reduced motion), then it stays still.
 */
import { motion } from "motion/react";
import { useCalm } from "@/lib/motion";
import { C, LINE } from "./palette";

export function Mascot({ size = 140, title, mood = "happy" }: { size?: number; title?: string; mood?: "happy" | "listening" }) {
  const calm = useCalm();
  return (
    <svg
      className="mascot"
      width={size}
      height={size}
      viewBox="0 0 160 160"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {title && <title>{title}</title>}
      <ellipse cx={80} cy={148} rx={46} ry={7} fill={C.pistachio} />
      {/* waving hand */}
      <motion.g
        style={{ originX: "122px", originY: "92px" }}
        initial={calm ? false : { rotate: 0 }}
        animate={calm ? undefined : { rotate: [0, -16, 10, -10, 0] }}
        transition={{ duration: 1.4, delay: 0.5, ease: "easeInOut" }}
      >
        <rect x={120} y={58} width={22} height={36} rx={11} fill={C.teal300} stroke={LINE} strokeWidth={4} transform="rotate(18 131 76)" />
      </motion.g>
      {/* body: a speech bubble */}
      <path
        d="M22 74c0-31 25-52 58-52s58 21 58 52-25 52-58 52c-8 0-15-1-22-3l-24 14 6-22C28 106 22 91 22 74Z"
        fill={C.teal300}
        stroke={LINE}
        strokeWidth={4}
        strokeLinejoin="round"
      />
      {/* sparkle dot from the brand mark */}
      <circle cx={130} cy={24} r={11} fill={C.sand200} stroke={LINE} strokeWidth={3.5} />
      {/* face */}
      <ellipse cx={62} cy={70} rx={6} ry={mood === "listening" ? 6 : 8} fill={LINE} />
      <ellipse cx={98} cy={70} rx={6} ry={mood === "listening" ? 6 : 8} fill={LINE} />
      <circle cx={64} cy={67} r={2} fill={C.white} />
      <circle cx={100} cy={67} r={2} fill={C.white} />
      <circle cx={48} cy={88} r={8} fill={C.peach200} />
      <circle cx={112} cy={88} r={8} fill={C.peach200} />
      {mood === "happy" ? (
        <path d="M66 90c8 9 20 9 28 0" fill="none" stroke={LINE} strokeWidth={4} strokeLinecap="round" />
      ) : (
        <ellipse cx={80} cy={93} rx={6} ry={5} fill={LINE} />
      )}
    </svg>
  );
}
