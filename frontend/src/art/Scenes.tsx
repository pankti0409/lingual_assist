/** Portraits, state illustrations, everyday-conversation vignettes and gesture glyphs (original art). */
import type { ReactNode } from "react";
import type { GestureLabel } from "@/api/types";
import { CAST } from "./cast";
import { C, LINE } from "./palette";
import { Person, PersonArms, PersonBody, type HandPose, type PersonLook } from "./Person";


interface FrameProps {
  w: number;
  h: number;
  title?: string;
  className?: string;
  children: ReactNode;
}

/** Decorative unless titled; titled art gets role="img" and an accessible name. */
function Art({ w, h, title, className, children }: FrameProps) {
  return (
    <svg className={className} viewBox={`0 0 ${w} ${h}`} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true} xmlns="http://www.w3.org/2000/svg">
      {title && <title>{title}</title>}
      {children}
    </svg>
  );
}

function Blob({ fill, d }: { fill: string; d: string }) {
  return <path d={d} fill={fill} />;
}

function Breath(t: number, offset = 0) {
  return t / 4 + offset;
}

// ----------------------------------------------------------------------------- portraits
export function VoicePortrait({ t = 0, title, className }: { t?: number; title?: string; className?: string }) {
  const pulse = 0.5 + 0.5 * Math.sin(t * 3);
  return (
    <Art w={800} h={800} title={title} className={className}>
      <rect width={800} height={800} fill={C.cream50} />
      <Blob fill={C.peach100} d="M120,140 C260,40 560,60 660,190 C760,320 720,560 560,650 C400,740 170,700 110,540 C60,400 20,230 120,140 Z" />
      <Blob fill={C.teal100} d="M560,120 C640,110 720,170 700,250 C680,320 600,320 560,280 C520,240 500,130 560,120 Z" />
      <PersonBody look={CAST.tomi} x={380} y={700} scale={1.35} state={{ breath: Breath(t), smile: 0.6 }} />
      <rect x={60} y={690} width={680} height={110} rx={30} fill={C.sand200} stroke={LINE} strokeWidth={3} />
      <PersonArms look={CAST.tomi} x={380} y={700} scale={1.35} state={{ breath: Breath(t), otherHand: "rest" }} />
      {/* speaker device on the table with soft sound arcs */}
      <g transform="translate(600 650)">
        <rect x={-46} y={-70} width={92} height={70} rx={20} fill={C.burgundy700} stroke={LINE} strokeWidth={3} />
        <circle cx={0} cy={-35} r={18} fill={C.teal300} />
        {[0, 1, 2].map((k) => (
          <path key={k} d={`M${58 + k * 22},-${70 + k * 12} q${22 + k * 6},${36 + k * 12} 0,${72 + k * 24}`} transform="translate(0 0)" fill="none" stroke={C.coral400} strokeWidth={6} strokeLinecap="round" opacity={0.4 + 0.6 * pulse * (1 - k * 0.25)} />
        ))}
      </g>
      <g transform="translate(150 150)">
        <rect width={250} height={64} rx={32} fill={C.white} stroke={LINE} strokeWidth={3} />
        {Array.from({ length: 11 }, (_, i) => {
          const hgt = 10 + 26 * (0.3 + 0.7 * Math.abs(Math.sin(t * 5 + i)));
          return <rect key={i} x={34 + i * 17} y={32 - hgt / 2} width={8} height={hgt} rx={4} fill={C.teal500} />;
        })}
      </g>
    </Art>
  );
}

export function GesturePortrait({ t = 0, title, className }: { t?: number; title?: string; className?: string }) {
  return (
    <Art w={800} h={800} title={title} className={className}>
      <rect width={800} height={800} fill={C.cream50} />
      <Blob fill={C.teal100} d="M140,120 C300,40 600,90 680,240 C760,390 690,600 520,660 C350,720 150,660 110,500 C70,350 40,170 140,120 Z" />
      <PersonBody look={CAST.daniel} x={360} y={710} scale={1.35} state={{ breath: Breath(t), smile: 0.55 }} />
      <rect x={60} y={700} width={680} height={100} rx={30} fill={C.sand200} stroke={LINE} strokeWidth={3} />
      <PersonArms look={CAST.daniel} x={360} y={710} scale={1.35} state={{ breath: Breath(t), raise: 1, raisedPose: "openPalm" }} />
      <circle cx={360 + 124 * 1.35} cy={710 - 205 * 1.35} r={92} fill="none" stroke={C.coral400} strokeWidth={6} strokeDasharray="16 12" />
      {(["Thumb_Up", "Victory", "Thumb_Down"] as GestureLabel[]).map((g, i) => (
        <g key={g} transform={`translate(${118 + i * 96} ${132 + (i % 2) * 34})`}>
          <circle r={40} fill={C.white} stroke={LINE} strokeWidth={3} />
          <g transform="scale(0.62)">
            <GestureShape label={g} />
          </g>
        </g>
      ))}
    </Art>
  );
}

// ----------------------------------------------------------------------------- states
export function EmptyStateArt({ title, className }: { title?: string; className?: string }) {
  return (
    <Art w={800} h={600} title={title} className={className}>
      <rect width={800} height={600} fill={C.cream50} />
      <Blob fill={C.peach100} d="M110,140 C250,40 560,50 650,170 C740,290 700,470 540,520 C380,570 160,540 100,410 C50,300 30,190 110,140 Z" />
      <PersonBody look={CAST.mei} x={330} y={520} scale={1} state={{ smile: 0.6 }} />
      <rect x={120} y={512} width={560} height={88} rx={28} fill={C.sand200} stroke={LINE} strokeWidth={3} />
      <PersonArms look={CAST.mei} x={330} y={520} scale={1} state={{ otherHand: "cup" }} />
      {/* an empty, waiting speech bubble */}
      <g transform="translate(470 110)">
        <rect width={240} height={120} rx={46} fill={C.white} stroke={LINE} strokeWidth={3} strokeDasharray="14 10" />
        <path d="M44,118 L20,160 L90,118" fill={C.white} stroke={LINE} strokeWidth={3} strokeDasharray="14 10" strokeLinejoin="round" />
        {[0, 1, 2].map((i) => (
          <circle key={i} cx={84 + i * 36} cy={60} r={9} fill={C.teal500} opacity={0.5 + i * 0.2} />
        ))}
      </g>
    </Art>
  );
}

export function UnavailableArt({ title, className }: { title?: string; className?: string }) {
  return (
    <Art w={800} h={600} title={title} className={className}>
      <rect width={800} height={600} fill={C.cream50} />
      <Blob fill={C.cream100} d="M90,170 C220,50 540,40 660,160 C770,280 720,480 560,530 C390,580 160,560 100,420 C50,320 20,240 90,170 Z" />
      <PersonBody look={CAST.grace} x={300} y={520} scale={1} state={{ smile: 0.25 }} />
      <rect x={110} y={512} width={580} height={88} rx={28} fill={C.sand200} stroke={LINE} strokeWidth={3} />
      <PersonArms look={CAST.grace} x={300} y={520} scale={1} state={{ otherHand: "tablet" }} />
      {/* a cloud with a gentle pause mark, and an unplugged connector */}
      <g transform="translate(560 160)">
        <path d="M-90,40 C-120,40 -122,-6 -88,-10 C-86,-56 -24,-66 -8,-28 C10,-62 76,-52 70,-6 C110,-6 110,40 76,40 Z" fill={C.white} stroke={LINE} strokeWidth={3} strokeLinejoin="round" />
        <rect x={-22} y={-14} width={12} height={36} rx={5} fill={C.teal500} />
        <rect x={6} y={-14} width={12} height={36} rx={5} fill={C.teal500} />
      </g>
      <g transform="translate(520 380)" fill="none" stroke={LINE} strokeWidth={4} strokeLinecap="round">
        <path d="M-120,40 C-60,40 -60,-10 -10,-10" />
        <rect x={-12} y={-24} width={30} height={28} rx={6} fill={C.coral400} />
        <path d="M18,-16 h12 M18,-4 h12" />
        <path d="M110,-40 C70,-40 70,-10 54,-10" />
        <rect x={30} y={-24} width={26} height={28} rx={6} fill={C.teal300} />
      </g>
    </Art>
  );
}

// ----------------------------------------------------------------------------- everyday conversations
export type VignetteId = "family" | "friends" | "caregiving" | "work" | "appointment";

const VIGNETTES: Record<VignetteId, { a: PersonLook; b: PersonLook; aHand?: HandPose; bHand?: HandPose; bg: string; prop?: "laptop" | "notebook" | "cups" }> = {
  family: { a: CAST.nasreen, b: CAST.daniel, aHand: "cup", bHand: "rest", bg: C.peach100, prop: "cups" },
  friends: { a: CAST.tomi, b: CAST.mei, aHand: "rest", bHand: "tablet", bg: C.teal100 },
  caregiving: { a: CAST.grace, b: CAST.joseph, aHand: "rest", bHand: "rest", bg: C.cream100, prop: "cups" },
  work: { a: CAST.sam, b: CAST.priya, aHand: "rest", bHand: "rest", bg: C.coral100, prop: "laptop" },
  appointment: { a: CAST.ines, b: CAST.margaret, aHand: "rest", bHand: "rest", bg: C.teal100, prop: "notebook" },
};

export function Vignette({ id, t = 0, title, className }: { id: VignetteId; t?: number; title?: string; className?: string }) {
  const v = VIGNETTES[id];
  const talkA = Math.sin(t * 0.9) > 0.3 ? 0.4 + 0.5 * Math.abs(Math.sin(t * 8)) : 0;
  return (
    <Art w={800} h={600} title={title} className={className}>
      <rect width={800} height={600} fill={C.cream50} />
      <Blob fill={v.bg} d="M60,180 C180,50 600,30 720,160 C820,280 760,500 600,540 C420,590 160,570 80,440 C30,350 0,250 60,180 Z" />
      <PersonBody look={v.a} x={230} y={470} scale={0.95} facing="right" state={{ breath: t / 4, mouth: talkA, smile: 0.5 }} />
      <PersonBody look={v.b} x={570} y={470} scale={0.95} facing="left" state={{ breath: t / 4 + 0.4, smile: 0.55 }} />
      <path d="M90,470 C90,452 710,452 710,470 L730,600 L70,600 Z" fill={C.sand200} stroke={LINE} strokeWidth={3} strokeLinejoin="round" />
      {v.prop === "cups" && (
        <g>
          <path d="M370,466 h36 l-5,-50 h-26 Z" transform="rotate(180 388 441)" fill={C.white} stroke={LINE} strokeWidth={3} />
          <path d="M420,462 h40 c0,-26 -40,-26 -40,0 Z" fill={C.coral400} stroke={LINE} strokeWidth={3} />
        </g>
      )}
      {v.prop === "laptop" && (
        <g transform="translate(400 462)">
          <path d="M-70,0 L-56,-66 L56,-66 L70,0 Z" fill={C.teal500} stroke={LINE} strokeWidth={3} strokeLinejoin="round" />
          <rect x={-80} y={-4} width={160} height={10} rx={5} fill={C.burgundy700} />
        </g>
      )}
      {v.prop === "notebook" && (
        <g transform="translate(400 460) rotate(-6)">
          <rect x={-50} y={-30} width={100} height={36} rx={6} fill={C.white} stroke={LINE} strokeWidth={3} />
          <path d="M-36,-18 h60 M-36,-6 h44" stroke={C.teal500} strokeWidth={3} strokeLinecap="round" />
        </g>
      )}
      <PersonArms look={v.a} x={230} y={470} scale={0.95} facing="right" state={{ breath: t / 4, otherHand: v.aHand }} />
      <PersonArms look={v.b} x={570} y={470} scale={0.95} facing="left" state={{ breath: t / 4 + 0.4, otherHand: v.bHand }} />
    </Art>
  );
}

// ----------------------------------------------------------------------------- gesture glyphs
export function GestureShape({ label }: { label: GestureLabel }) {
  const s = { fill: C.peach200, stroke: LINE, strokeWidth: 4, strokeLinejoin: "round" as const };
  const fist = <rect x={-26} y={-6} width={52} height={44} rx={16} {...s} />;
  switch (label) {
    case "Closed_Fist":
      return <g>{fist}<path d="M-14,4 v18 M0,4 v18 M14,4 v18" stroke={LINE} strokeWidth={3} strokeLinecap="round" opacity={0.5} /></g>;
    case "Open_Palm":
      return (
        <g>
          {[-21, -7, 7, 21].map((x, i) => <rect key={x} x={x - 6} y={-50 + Math.abs(i - 1.5) * 6} width={13} height={46} rx={6.5} {...s} />)}
          <rect x={-28} y={-12} width={56} height={46} rx={18} {...s} />
        </g>
      );
    case "Pointing_Up":
      return <g><rect x={-7} y={-56} width={14} height={56} rx={7} {...s} />{fist}</g>;
    case "Thumb_Up":
      return <g>{fist}<rect x={-20} y={-46} width={17} height={46} rx={8.5} {...s} /></g>;
    case "Thumb_Down":
      return <g transform="rotate(180)">{fist}<rect x={-20} y={-46} width={17} height={46} rx={8.5} {...s} /></g>;
    case "Victory":
      return (
        <g>
          <rect x={-18} y={-58} width={14} height={60} rx={7} transform="rotate(-10 -11 0)" {...s} />
          <rect x={4} y={-58} width={14} height={60} rx={7} transform="rotate(10 11 0)" {...s} />
          {fist}
        </g>
      );
    case "ILoveYou":
      return (
        <g>
          <rect x={-24} y={-56} width={13} height={56} rx={6.5} {...s} />
          <rect x={12} y={-56} width={13} height={56} rx={6.5} {...s} />
          <rect x={-46} y={-8} width={34} height={14} rx={7} {...s} />
          {fist}
        </g>
      );
    case "None":
      return <circle r={34} fill="none" stroke={LINE} strokeWidth={4} strokeDasharray="8 8" />;
  }
}

export function GestureGlyph({ label, size = 56 }: { label: GestureLabel; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="-60 -66 120 120" aria-hidden className="gesture-glyph">
      <GestureShape label={label} />
    </svg>
  );
}

export { Person };
