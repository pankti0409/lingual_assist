/**
 * Parametric half-body character (original artwork). Drawn seated behind a table: the origin (0,0)
 * is where the torso meets the table top, the person faces +x (use `facing="left"` to mirror).
 *
 * The person is drawn in two passes so hands can rest in front of the table:
 *   <PersonBody/>  (torso, head, hair, face)   -> then the table -> <PersonArms/>
 */
import type { ReactNode } from "react";
import { C, LINE, STROKE } from "./palette";

export type HairStyle = "bun" | "short" | "curly" | "long" | "bob" | "bald" | "headscarf" | "cropped";
export type HandPose = "rest" | "thumbUp" | "openPalm" | "point" | "cup" | "tablet";

export interface PersonLook {
  skin: string;
  hair: HairStyle;
  hairColor: string;
  top: string;
  topDetail?: string;
  glasses?: boolean;
  beard?: boolean;
  scarf?: string; // e.g. a neck scarf over a stoma cover
  headscarf?: string;
  earring?: boolean;
  lanyard?: boolean;
  wheelchair?: boolean;
  age?: "young" | "middle" | "older";
}

export interface PersonState {
  /** 0..1 breathing phase offset applied as a tiny torso/head lift. */
  breath?: number;
  blink?: boolean;
  /** 0 closed, 1 fully open (speaking). */
  mouth?: number;
  smile?: number;
  /** Head nod in degrees. */
  nod?: number;
  /** Raised (gesture) hand: 0 = resting on table, 1 = fully raised. */
  raise?: number;
  raisedPose?: Exclude<HandPose, "rest" | "cup" | "tablet">;
  otherHand?: HandPose;
}

interface Props {
  look: PersonLook;
  state?: PersonState;
  x: number;
  y: number;
  scale?: number;
  facing?: "left" | "right";
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

function frame(x: number, y: number, scale: number, facing: "left" | "right") {
  return `translate(${x} ${y}) scale(${facing === "left" ? -scale : scale} ${scale})`;
}

function Hair({ look, back }: { look: PersonLook; back: boolean }) {
  const c = look.hairColor;
  const s = { fill: c, stroke: LINE, strokeWidth: STROKE, strokeLinejoin: "round" as const };
  switch (look.hair) {
    case "bun":
      return back ? (
        <g>
          <circle cx={-6} cy={-302} r={26} {...s} />
          <path d="M-48,-238 C-52,-292 -18,-306 6,-304 C40,-302 54,-276 48,-236 C30,-262 -20,-266 -48,-238 Z" {...s} />
        </g>
      ) : (
        <path d="M-47,-246 C-40,-284 -6,-296 18,-292 C36,-288 50,-272 50,-250 C30,-270 0,-276 -20,-266 C-32,-260 -42,-252 -47,-246 Z" {...s} />
      );
    case "curly":
      return back ? (
        <g {...s}>
          {[[-40, -262], [-26, -292], [0, -302], [26, -294], [44, -268], [-50, -232], [52, -232]].map(([cx, cy], i) => (
            <circle key={i} cx={cx} cy={cy} r={24} />
          ))}
        </g>
      ) : (
        <path d="M-40,-252 C-30,-282 30,-286 44,-252 C30,-266 -26,-268 -40,-252 Z" fill={c} stroke={LINE} strokeWidth={STROKE} />
      );
    case "long":
      return back ? (
        <path d="M-50,-236 C-60,-300 50,-312 54,-240 C58,-190 64,-150 50,-120 L-54,-120 C-66,-150 -58,-190 -50,-236 Z" {...s} />
      ) : (
        <path d="M-48,-240 C-40,-290 40,-296 50,-246 C24,-262 -6,-262 -24,-252 C-36,-246 -44,-240 -48,-240 Z" {...s} />
      );
    case "bob":
      return back ? (
        <path d="M-52,-232 C-60,-300 54,-306 54,-232 C56,-206 54,-188 44,-178 L-46,-178 C-56,-190 -56,-208 -52,-232 Z" {...s} />
      ) : (
        <path d="M-48,-238 C-44,-286 44,-292 50,-242 C20,-258 -14,-256 -48,-238 Z" {...s} />
      );
    case "short":
      return back ? null : (
        <path d="M-46,-240 C-46,-286 36,-298 50,-252 C46,-246 42,-256 30,-262 C6,-272 -24,-266 -40,-246 Z" {...s} />
      );
    case "cropped":
      return back ? null : <path d="M-45,-244 C-40,-284 40,-290 48,-248 C30,-264 -24,-266 -45,-244 Z" {...s} />;
    case "bald":
      return back ? null : <path d="M-44,-228 C-46,-212 -40,-200 -36,-198 M44,-228 C46,-212 40,-200 36,-198" fill="none" stroke={c} strokeWidth={9} strokeLinecap="round" />;
    case "headscarf":
      return back ? (
        <path d="M-58,-232 C-64,-308 62,-314 58,-230 C60,-190 66,-168 56,-146 C30,-138 -30,-138 -58,-148 C-66,-172 -62,-196 -58,-232 Z" fill={look.headscarf ?? C.coral400} stroke={LINE} strokeWidth={STROKE} />
      ) : (
        <path d="M-50,-236 C-46,-290 46,-294 52,-238 C40,-262 -36,-264 -50,-236 Z" fill={look.headscarf ?? C.coral400} stroke={LINE} strokeWidth={STROKE} />
      );
  }
}

function Face({ look, state }: { look: PersonLook; state: PersonState }) {
  const mouth = state.mouth ?? 0;
  const smile = state.smile ?? 0.4;
  const blink = state.blink;
  return (
    <g>
      {/* cheeks */}
      <circle cx={22} cy={-212} r={9} fill={C.coral400} opacity={0.22} />
      {/* eyes: looking toward +x */}
      {blink ? (
        <g stroke={LINE} strokeWidth={3} strokeLinecap="round">
          <path d="M-8,-232 l10,0" />
          <path d="M22,-232 l10,0" />
        </g>
      ) : (
        <g fill={C.burgundy900}>
          <ellipse cx={-2} cy={-233} rx={4.2} ry={5.4} />
          <ellipse cx={27} cy={-233} rx={4.2} ry={5.4} />
        </g>
      )}
      {/* brows */}
      <path d="M-11,-246 q8,-5 16,-1 M19,-246 q8,-5 16,0" fill="none" stroke={LINE} strokeWidth={3} strokeLinecap="round" opacity={0.85} />
      {/* nose */}
      <path d="M14,-228 q8,10 2,15" fill="none" stroke={LINE} strokeWidth={2.4} strokeLinecap="round" opacity={0.7} />
      {/* mouth */}
      {mouth > 0.08 ? (
        <ellipse cx={13} cy={-201} rx={8 + mouth * 2} ry={2 + mouth * 6} fill={C.burgundy700} stroke={LINE} strokeWidth={2} />
      ) : (
        <path d={`M3,-202 q10,${3 + smile * 6} 20,0`} fill="none" stroke={LINE} strokeWidth={2.8} strokeLinecap="round" />
      )}
      {look.glasses && (
        <g fill="none" stroke={LINE} strokeWidth={2.6}>
          <circle cx={-2} cy={-233} r={11} />
          <circle cx={27} cy={-233} r={11} />
          <path d="M9,-234 h7 M-13,-234 l-26,-6" />
        </g>
      )}
      {look.beard && (
        <path d="M-36,-218 C-34,-180 -8,-168 14,-170 C38,-172 50,-196 48,-218 C34,-196 30,-192 14,-192 C-4,-192 -18,-200 -36,-218 Z" fill={look.hairColor} stroke={LINE} strokeWidth={STROKE} />
      )}
      {look.age === "older" && <path d="M-14,-213 q-5,4 -4,9 M38,-216 q4,5 2,10" fill="none" stroke={LINE} strokeWidth={1.8} opacity={0.45} />}
    </g>
  );
}

export function PersonBody({ look, state = {}, x, y, scale = 1, facing = "right" }: Props) {
  const breath = Math.sin((state.breath ?? 0) * Math.PI * 2);
  const lift = breath * 2.2;
  const nod = state.nod ?? 0;
  return (
    <g transform={frame(x, y, scale, facing)}>
      {look.wheelchair && (
        <g>
          <circle cx={-96} cy={36} r={86} fill="none" stroke={C.burgundy700} strokeWidth={10} />
          <circle cx={-96} cy={36} r={70} fill="none" stroke={C.teal500} strokeWidth={4} opacity={0.7} />
          {[0, 45, 90, 135].map((a) => (
            <path key={a} d="M-96,-34 L-96,106" stroke={C.burgundy700} strokeWidth={3} opacity={0.55} transform={`rotate(${a} -96 36)`} />
          ))}
          <path d="M-72,-150 C-110,-150 -118,-120 -116,-60" fill="none" stroke={C.burgundy700} strokeWidth={9} strokeLinecap="round" />
        </g>
      )}
      <g transform={`translate(0 ${-lift})`}>
        {/* torso */}
        <path
          d="M-84,30 C-88,-70 -78,-138 -34,-156 C-16,-163 16,-163 34,-156 C78,-138 88,-70 84,30 Z"
          fill={look.top}
          stroke={LINE}
          strokeWidth={STROKE}
          strokeLinejoin="round"
        />
        {look.topDetail && <path d="M-26,-156 C-10,-120 10,-120 26,-156" fill="none" stroke={look.topDetail} strokeWidth={8} strokeLinecap="round" />}
        {look.lanyard && (
          <g>
            <path d="M-22,-154 L-4,-70 L4,-70 L22,-154" fill="none" stroke={C.teal500} strokeWidth={5} />
            <rect x={-16} y={-72} width={32} height={40} rx={6} fill={C.white} stroke={LINE} strokeWidth={2.5} />
            <path d="M-8,-58 h16 M-8,-48 h10" stroke={LINE} strokeWidth={2.5} strokeLinecap="round" />
          </g>
        )}
        {/* neck + head */}
        <g transform={`rotate(${nod} 0 -170)`}>
          <Hair look={look} back />
          <path d="M-15,-182 L-14,-150 C-6,-142 6,-142 14,-150 L15,-182 Z" fill={look.skin} stroke={LINE} strokeWidth={STROKE} strokeLinejoin="round" />
          <ellipse cx={-44} cy={-222} rx={9} ry={13} fill={look.skin} stroke={LINE} strokeWidth={STROKE} />
          {look.earring && <circle cx={-46} cy={-204} r={5} fill={C.coral400} stroke={LINE} strokeWidth={2} />}
          <path
            d="M-46,-232 C-48,-272 -22,-288 6,-288 C34,-288 52,-268 50,-230 C49,-202 36,-178 8,-176 C-24,-176 -44,-200 -46,-232 Z"
            fill={look.skin}
            stroke={LINE}
            strokeWidth={STROKE}
            strokeLinejoin="round"
          />
          <Face look={look} state={state} />
          <Hair look={look} back={false} />
        </g>
        {look.scarf && (
          <path d="M-30,-160 C-10,-146 14,-146 32,-160 C38,-150 30,-128 2,-126 C-26,-126 -38,-146 -30,-160 Z" fill={look.scarf} stroke={LINE} strokeWidth={STROKE} strokeLinejoin="round" />
        )}
      </g>
    </g>
  );
}

function Hand({ pose, skin }: { pose: HandPose; skin: string }) {
  const s = { fill: skin, stroke: LINE, strokeWidth: STROKE, strokeLinejoin: "round" as const };
  switch (pose) {
    case "thumbUp":
      return (
        <g>
          <rect x={-18} y={-10} width={38} height={34} rx={13} {...s} />
          <rect x={-12} y={-42} width={15} height={38} rx={7.5} {...s} />
          <path d="M20,2 h-12 M20,13 h-12" stroke={LINE} strokeWidth={2} strokeLinecap="round" opacity={0.6} />
        </g>
      );
    case "openPalm":
      return (
        <g>
          {[-15, -4, 7, 18].map((fx, i) => (
            <rect key={i} x={fx - 5} y={-46 + Math.abs(i - 1.5) * 5} width={11} height={36} rx={5.5} {...s} />
          ))}
          <rect x={-22} y={-24} width={12} height={28} rx={6} transform="rotate(-35 -16 -10)" {...s} />
          <rect x={-20} y={-18} width={42} height={36} rx={14} {...s} />
        </g>
      );
    case "point":
      return (
        <g>
          <rect x={-6} y={-48} width={12} height={40} rx={6} {...s} />
          <rect x={-18} y={-12} width={38} height={32} rx={13} {...s} />
        </g>
      );
    case "cup":
      return (
        <g>
          <path d="M-14,-40 h38 l-5,48 h-28 Z" fill={C.coral400} stroke={LINE} strokeWidth={STROKE} strokeLinejoin="round" />
          <ellipse cx={-4} cy={0} rx={18} ry={12} {...s} />
        </g>
      );
    case "tablet":
      return (
        <g>
          <rect x={-46} y={-62} width={92} height={66} rx={10} fill={C.burgundy700} stroke={LINE} strokeWidth={STROKE} />
          <rect x={-38} y={-54} width={76} height={50} rx={6} fill={C.teal100} />
          <rect x={-32} y={-48} width={30} height={12} rx={4} fill={C.peach200} />
          <rect x={2} y={-48} width={30} height={12} rx={4} fill={C.teal300} />
          <rect x={-32} y={-30} width={64} height={12} rx={4} fill={C.white} />
          <ellipse cx={-30} cy={4} rx={16} ry={11} {...s} />
          <ellipse cx={34} cy={4} rx={16} ry={11} {...s} />
        </g>
      );
    default:
      return <ellipse cx={0} cy={0} rx={20} ry={13} {...s} />;
  }
}

type Pt = [number, number];

/** A jointed sleeve (shoulder -> elbow -> wrist) with a hand on the end. */
function Arm({ from, elbow, to, sleeve, skin, pose, width = 30 }: { from: Pt; elbow: Pt; to: Pt; sleeve: string; skin: string; pose: HandPose; width?: number }) {
  const d = `M${from[0]},${from[1]} L${elbow[0]},${elbow[1]} L${to[0]},${to[1] + 12}`;
  return (
    <g>
      <path d={d} fill="none" stroke={LINE} strokeWidth={width + STROKE * 2} strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} fill="none" stroke={sleeve} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
      <g transform={`translate(${to[0]} ${to[1]})`}>
        <Hand pose={pose} skin={skin} />
      </g>
    </g>
  );
}

/** Arms + hands, drawn after the table so resting hands sit on it. */
export function PersonArms({ look, state = {}, x, y, scale = 1, facing = "right" }: Props) {
  const r = ease(Math.min(1, Math.max(0, state.raise ?? 0)));
  const lift = Math.sin((state.breath ?? 0) * Math.PI * 2) * 2.2;
  const other = state.otherHand ?? "rest";
  const raisedPose = r > 0.35 ? state.raisedPose ?? "thumbUp" : "rest";
  // Resting: forearms lie on the table, hands drawn together in front of the body.
  const hand: Pt = [lerp(62, 124, r), lerp(14, -196, r)];
  const elbow: Pt = [lerp(98, 140, r), lerp(-28, -86, r)];
  return (
    <g transform={frame(x, y, scale, facing)}>
      <g transform={`translate(0 ${-lift * 0.5})`}>
        {other === "tablet" ? (
          <Arm from={[-62, -122]} elbow={[-96, -26]} to={[0, 10]} sleeve={look.top} skin={look.skin} pose="tablet" />
        ) : (
          <Arm from={[-62, -122]} elbow={[-96, -28]} to={[-26, 18]} sleeve={look.top} skin={look.skin} pose={other} />
        )}
        <Arm from={[62, -124]} elbow={elbow} to={hand} sleeve={look.top} skin={look.skin} pose={raisedPose} />
      </g>
    </g>
  );
}

/** Convenience wrapper for places where table layering does not matter (portraits). */
export function Person(props: Props & { children?: ReactNode }) {
  return (
    <g>
      <PersonBody {...props} />
      <PersonArms {...props} />
    </g>
  );
}
