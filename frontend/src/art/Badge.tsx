/** Illustrated achievement badges: one distinct silhouette per badge, palette colours, solid fills. */
import { AudioLines, Compass, Hand, Heart, MessageCircle, PenLine, SlidersHorizontal, Sparkles, type LucideIcon } from "lucide-react";
import type { Achievement, JourneyIcon } from "@/state/journey";
import { C, LINE } from "./palette";

export const JOURNEY_ICONS: Record<JourneyIcon, LucideIcon> = {
  compass: Compass,
  message: MessageCircle,
  sparkle: Sparkles,
  wave: AudioLines,
  hand: Hand,
  sliders: SlidersHorizontal,
  pen: PenLine,
  heart: Heart,
};

const TONES: Record<Achievement["tone"], { fill: string; inner: string }> = {
  teal: { fill: C.teal300, inner: C.teal100 },
  butter: { fill: C.sand200, inner: C.cream100 },
  lilac: { fill: C.coral100, inner: "#F4F1FA" },
  peach: { fill: C.peach200, inner: C.peach100 },
  pistachio: { fill: C.pistachio, inner: "#EEF4E7" },
};

function star(points: number, outer: number, inner: number) {
  const pts: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : outer;
    const a = (Math.PI * i) / points - Math.PI / 2;
    pts.push(`${(r * Math.cos(a)).toFixed(1)},${(r * Math.sin(a)).toFixed(1)}`);
  }
  return `M${pts.join("L")}Z`;
}

function flower(petals: number, r: number, bump: number) {
  let d = "";
  for (let i = 0; i < petals; i++) {
    const a0 = (2 * Math.PI * i) / petals;
    const a1 = (2 * Math.PI * (i + 1)) / petals;
    const am = (a0 + a1) / 2;
    const p0 = [r * Math.cos(a0), r * Math.sin(a0)];
    const p1 = [r * Math.cos(a1), r * Math.sin(a1)];
    const c = [(r + bump) * Math.cos(am), (r + bump) * Math.sin(am)];
    d += `${i ? "" : `M${p0[0].toFixed(1)},${p0[1].toFixed(1)}`}Q${c[0].toFixed(1)},${c[1].toFixed(1)} ${p1[0].toFixed(1)},${p1[1].toFixed(1)}`;
  }
  return `${d}Z`;
}

const SHAPES: Record<Achievement["shape"], string> = {
  seal: star(14, 46, 40),
  flower: flower(8, 36, 16),
  star: star(5, 50, 30),
  shield: "M0,-48 C18,-40 32,-40 42,-42 C44,0 30,32 0,48 C-30,32 -44,0 -42,-42 C-32,-40 -18,-40 0,-48 Z",
  hex: "M0,-48 L42,-24 L42,24 L0,48 L-42,24 L-42,-24 Z",
  drop: "M0,-50 C22,-24 40,-4 40,16 C40,38 22,50 0,50 C-22,50 -40,38 -40,16 C-40,-4 -22,-24 0,-50 Z",
  ticket: "M-44,-34 H44 V-10 A10,10 0 0 0 44,10 V34 H-44 V10 A10,10 0 0 0 -44,-10 Z",
};

/** A badge. When not yet earned it is drawn as a dashed outline — "not yet", never "locked". */
export function BadgeArt({ achievement, earned, size = 96 }: { achievement: Achievement; earned: boolean; size?: number }) {
  const Icon = JOURNEY_ICONS[achievement.icon];
  const tone = TONES[achievement.tone];
  const d = SHAPES[achievement.shape];
  return (
    <svg className={`badge-art${earned ? " is-earned" : ""}`} width={size} height={size} viewBox="-60 -60 120 120" aria-hidden>
      {earned ? (
        <>
          <path d={d} transform="translate(0 4)" fill={LINE} />
          <path d={d} fill={tone.fill} stroke={LINE} strokeWidth={3} strokeLinejoin="round" />
          <circle r={24} fill={tone.inner} stroke={LINE} strokeWidth={2.5} />
          <Icon x={-14} y={-14} width={28} height={28} color={LINE} strokeWidth={2.2} />
        </>
      ) : (
        <>
          <path d={d} fill={C.white} stroke={C.cream200} strokeWidth={3} strokeDasharray="6 6" strokeLinejoin="round" />
          <Icon x={-13} y={-13} width={26} height={26} color="#718184" strokeWidth={2} />
        </>
      )}
    </svg>
  );
}
