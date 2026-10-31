/**
 * The hero storyboard as a pure function of time: <HeroFilm t={seconds} />. Used three ways:
 *  1. rendered frame-by-frame by tools/render-media.mjs into the MP4/WebM hero videos,
 *  2. rendered at fixed times into the WebP/AVIF stills and posters,
 *  3. scrubbed by scroll position in the home-page story.
 * The loop is seamless: every overlay is hidden at t=0 and t=DURATION, and breathing / steam
 * periods divide the duration exactly.
 */
import { C, LINE } from "./palette";
import { CAST } from "./cast";
import { PersonArms, PersonBody } from "./Person";

export const HERO_DURATION = 16;
export type FilmLayout = "wide" | "tall";

/** Times used for stills and for the six scroll-story stages (monotonic, so scrubbing reads forward). */
export const FILM_MOMENTS = {
  calm: 0.8,
  partnerAsks: 3.0,
  listening: 5.3,
  context: 6.6,
  gesture: 7.9,
  combine: 8.95,
  suggest: 10.9,
  confirm: 12.1,
  speak: 13.7,
} as const;

const FONT_DISPLAY = "'Fraunces Variable', Georgia, serif";
const FONT_BODY = "'Atkinson Hyperlegible', 'Noto Sans Devanagari', system-ui, sans-serif";

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const ramp = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
const easeOut = (v: number) => 1 - (1 - v) ** 3;
/** Fades in over [a,b], out over [c,d]. */
const win = (t: number, a: number, b: number, c: number, d: number) => easeOut(Math.min(ramp(t, a, b), 1 - ramp(t, c, d)));
const blinkAt = (t: number, times: number[]) => times.some((s) => t >= s && t < s + 0.14);

interface Geo {
  w: number;
  h: number;
  tableY: number;
  partner: { x: number; y: number; s: number };
  patient: { x: number; y: number; s: number };
  bubble: [number, number, number, number];
  speech: [number, number, number, number];
  context: [number, number, number, number];
  tag: [number, number, number];
  node: [number, number, number, number];
  chips: { x: number; w: number; ys: number[]; h: number; size: number };
  subtitle: [number, number, number, number, number];
  cups: number;
  window: [number, number, number, number];
}

const GEO: Record<FilmLayout, Geo> = {
  wide: {
    w: 1600,
    h: 900,
    tableY: 652,
    partner: { x: 455, y: 652, s: 1.25 },
    patient: { x: 1150, y: 652, s: 1.25 },
    bubble: [540, 150, 420, 96],
    speech: [905, 108, 430, 116],
    context: [120, 64, 470, 164],
    tag: [630, 478, 290],
    node: [650, 300, 300, 74],
    chips: { x: 560, w: 500, ys: [228, 330, 432], h: 84, size: 27 },
    subtitle: [270, 752, 1060, 112, 46],
    cups: 800,
    window: [690, 70, 230, 420],
  },
  tall: {
    w: 800,
    h: 1000,
    tableY: 712,
    partner: { x: 196, y: 712, s: 0.92 },
    patient: { x: 606, y: 712, s: 0.92 },
    bubble: [36, 70, 430, 92],
    speech: [318, 208, 450, 108],
    context: [36, 36, 470, 156],
    tag: [292, 416, 252],
    node: [250, 330, 300, 70],
    chips: { x: 120, w: 560, ys: [96, 196, 296], h: 82, size: 26 },
    subtitle: [36, 832, 728, 120, 38],
    cups: 360,
    window: [300, 40, 200, 360],
  },
};

const CANDIDATES = ["I would like water, please.", "Could I have some water?", "Water, not tea, thank you."];

function Room({ g, t }: { g: Geo; t: number }) {
  const [wx, wy, ww, wh] = g.window;
  const steam = (t % 4) / 4;
  return (
    <g>
      <rect width={g.w} height={g.h} fill={C.cream50} />
      {/* soft organic shapes */}
      <path d={`M${-40},${g.h * 0.1} C${g.w * 0.18},${-20} ${g.w * 0.42},${g.h * 0.12} ${g.w * 0.36},${g.h * 0.5} C${g.w * 0.3},${g.h * 0.86} ${g.w * 0.05},${g.h * 0.8} ${-40},${g.h * 0.72} Z`} fill={C.cream100} />
      <path d={`M${g.w + 40},${g.h * 0.16} C${g.w * 0.8},${g.h * 0.02} ${g.w * 0.62},${g.h * 0.2} ${g.w * 0.68},${g.h * 0.52} C${g.w * 0.73},${g.h * 0.82} ${g.w * 0.94},${g.h * 0.76} ${g.w + 40},${g.h * 0.68} Z`} fill={C.peach100} />
      {/* arched window with a plant */}
      <path d={`M${wx},${wy + wh} L${wx},${wy + ww / 2} A${ww / 2},${ww / 2} 0 0 1 ${wx + ww},${wy + ww / 2} L${wx + ww},${wy + wh} Z`} fill={C.teal100} stroke={LINE} strokeWidth={3} />
      <path d={`M${wx + ww / 2},${wy + 6} L${wx + ww / 2},${wy + wh} M${wx},${wy + wh * 0.58} L${wx + ww},${wy + wh * 0.58}`} stroke={LINE} strokeWidth={3} opacity={0.5} />
      <g transform={`translate(${wx + ww * 0.24} ${wy + wh - 10})`}>
        <path d="M-22,0 h44 l-6,40 h-32 Z" fill={C.coral400} stroke={LINE} strokeWidth={3} strokeLinejoin="round" />
        {[-40, -14, 12, 36].map((a, i) => (
          <path key={i} d={`M0,0 C${a * 0.4},-30 ${a},-50 ${a * 1.1},-${70 + (i % 2) * 18}`} fill="none" stroke={C.teal500} strokeWidth={9} strokeLinecap="round" />
        ))}
      </g>
      {/* hanging lamp linework */}
      <path d={`M${g.w * 0.12},0 L${g.w * 0.12},${g.h * 0.08}`} stroke={LINE} strokeWidth={2.5} opacity={0.6} />
      <path d={`M${g.w * 0.12 - 34},${g.h * 0.08 + 30} Q${g.w * 0.12},${g.h * 0.08 - 10} ${g.w * 0.12 + 34},${g.h * 0.08 + 30} Z`} fill={C.sand200} stroke={LINE} strokeWidth={3} />
      {/* the steam period (4 s) divides the loop */}
      <g opacity={0.5}>
        <path
          d={`M${g.cups + 80},${g.tableY - 80} c-10,-14 10,-22 0,-38 c-10,-14 10,-22 0,-36`}
          fill="none"
          stroke={C.burgundy500}
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray="10 12"
          strokeDashoffset={-steam * 44}
        />
      </g>
    </g>
  );
}

function Table({ g }: { g: Geo }) {
  const y = g.tableY;
  return (
    <g>
      <path d={`M${g.w * 0.12},${y} C${g.w * 0.12},${y - 22} ${g.w * 0.88},${y - 22} ${g.w * 0.88},${y} L${g.w * 0.92},${g.h + 10} L${g.w * 0.08},${g.h + 10} Z`} fill={C.sand200} stroke={LINE} strokeWidth={3} strokeLinejoin="round" />
      <path d={`M${g.w * 0.13},${y + 20} C${g.w * 0.4},${y + 28} ${g.w * 0.6},${y + 28} ${g.w * 0.87},${y + 20}`} fill="none" stroke={LINE} strokeWidth={2} opacity={0.35} />
      {/* water glass and tea cup */}
      <g transform={`translate(${g.cups - 30} ${y - 6})`}>
        <path d="M-22,-74 h44 l-6,72 h-32 Z" fill={C.white} stroke={LINE} strokeWidth={3} strokeLinejoin="round" />
        <path d="M-19,-46 h38 l-4,44 h-30 Z" fill={C.teal300} opacity={0.75} />
      </g>
      <g transform={`translate(${g.cups + 80} ${y - 6})`}>
        <ellipse cx={0} cy={0} rx={46} ry={9} fill={C.white} stroke={LINE} strokeWidth={3} />
        <path d="M-30,-48 h60 c0,30 -12,46 -30,46 c-18,0 -30,-16 -30,-46 Z" fill={C.coral400} stroke={LINE} strokeWidth={3} strokeLinejoin="round" />
        <path d="M30,-38 c18,-2 18,22 0,22" fill="none" stroke={LINE} strokeWidth={3} />
      </g>
    </g>
  );
}

function Bubble({ box, text, opacity, tail, size }: { box: [number, number, number, number]; text: string; opacity: number; tail: [number, number]; size: number }) {
  const [x, y, w, h] = box;
  if (opacity <= 0) return null;
  return (
    <g opacity={opacity} transform={`translate(0 ${(1 - opacity) * 10})`}>
      <path d={`M${x + 40},${y + h - 2} L${tail[0]},${tail[1]} L${x + 92},${y + h - 2} Z`} fill={C.white} stroke={LINE} strokeWidth={3} strokeLinejoin="round" />
      <rect x={x} y={y} width={w} height={h} rx={h / 2.4} fill={C.white} stroke={LINE} strokeWidth={3} />
      <rect x={x + 30} y={y + h - 6} width={70} height={10} fill={C.white} />
      <text x={x + w / 2} y={y + h / 2 + size * 0.35} textAnchor="middle" fontFamily={FONT_DISPLAY} fontSize={size} fill={C.burgundy900}>
        {text}
      </text>
    </g>
  );
}

export interface HeroFilmProps {
  t: number;
  layout?: FilmLayout;
  title?: string;
  description?: string;
  className?: string;
  /** Hide all interface overlays (for character-only stills). */
  plain?: boolean;
}

export function HeroFilm({ t: rawT, layout = "wide", title, description, className, plain }: HeroFilmProps) {
  const t = ((rawT % HERO_DURATION) + HERO_DURATION) % HERO_DURATION;
  const g = GEO[layout];
  const tall = layout === "tall";

  // --- timeline -------------------------------------------------------------------------------
  const bubble = win(t, 1.2, 1.6, 5.8, 6.2);
  const ravMouth = t > 1.4 && t < 3.4 ? 0.45 + 0.55 * Math.abs(Math.sin(t * 9)) : 0;
  const listening = win(t, 3.6, 4.0, 9.3, 9.7);
  const ashaMouth = t > 3.9 && t < 5.8 ? 0.15 + 0.6 * Math.abs(Math.sin(t * 6.5)) : 0;
  const speaking = win(t, 3.8, 4.1, 5.8, 6.3);
  const partial = t < 4.45 ? "wa…" : t < 5.0 ? "wa… wa-" : "wa… water";
  const context = win(t, 6.0, 6.4, 9.3, 9.7);
  const raise = win(t, 6.6, 7.3, 9.6, 10.3);
  const ring = win(t, 7.2, 7.6, 9.3, 9.7);
  const lines = ramp(t, 8.0, 9.0) * (1 - ramp(t, 9.3, 9.7));
  const node = win(t, 8.5, 8.9, 9.4, 9.8);
  const chips = [0, 1, 2].map((i) => win(t, 9.7 + i * 0.22, 10.1 + i * 0.22, 12.4, 12.8));
  const chosen = ramp(t, 11.2, 11.5);
  const check = win(t, 11.7, 12.0, 12.4, 12.8);
  const subtitle = win(t, 12.6, 13.0, 14.6, 15.2);
  const sound = subtitle > 0 ? 0.5 + 0.5 * Math.sin(t * 7) : 0;
  const ravNod = t > 13.2 && t < 14.2 ? Math.sin((t - 13.2) * Math.PI * 2) * 4 : 0;

  const [sx, sy, sw, sh] = g.speech;
  const [cx, cy, cw, ch] = g.context;
  const [nx, ny, nw, nh] = g.node;
  const [ux, uy, uw, uh, us] = g.subtitle;
  const handX = g.patient.x - 124 * g.patient.s;
  const handY = g.patient.y - 196 * g.patient.s;
  const partnerMouth: [number, number] = [g.partner.x + 13 * g.partner.s, g.partner.y - 205 * g.partner.s];

  return (
    <svg
      className={className}
      viewBox={`0 0 ${g.w} ${g.h}`}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      preserveAspectRatio="xMidYMid slice"
      xmlns="http://www.w3.org/2000/svg"
    >
      {title && <title>{title}</title>}
      {description && <desc>{description}</desc>}
      <Room g={g} t={t} />
      <PersonBody look={CAST.ravi} x={g.partner.x} y={g.partner.y} scale={g.partner.s} facing="right"
        state={{ breath: t / 4, blink: blinkAt(t, [2.1, 7.9, 13.1]), mouth: ravMouth, smile: 0.5, nod: ravNod }} />
      <PersonBody look={CAST.asha} x={g.patient.x} y={g.patient.y} scale={g.patient.s} facing="left"
        state={{ breath: t / 4 + 0.37, blink: blinkAt(t, [1.3, 10.4, 15.0]), mouth: ashaMouth, smile: 0.35 + chosen * 0.4 }} />
      <Table g={g} />
      <PersonArms look={CAST.ravi} x={g.partner.x} y={g.partner.y} scale={g.partner.s} facing="right" state={{ breath: t / 4, otherHand: "rest" }} />
      <PersonArms look={CAST.asha} x={g.patient.x} y={g.patient.y} scale={g.patient.s} facing="left" state={{ breath: t / 4 + 0.37, raise, raisedPose: "thumbUp" }} />

      {!plain && (
        <g>
          <Bubble box={g.bubble} text="Would you like water or tea?" opacity={bubble} tail={[partnerMouth[0] + 20, partnerMouth[1] - 6]} size={tall ? 27 : 30} />

          {/* patient speech: listening chip, partial transcript, waveform */}
          {listening > 0 && (
            <g opacity={listening} transform={`translate(0 ${(1 - listening) * 10})`}>
              <rect x={sx} y={sy} width={sw} height={sh} rx={26} fill={C.white} stroke={LINE} strokeWidth={3} />
              <circle cx={sx + 34} cy={sy + 32} r={9} fill={C.coral400} />
              <text x={sx + 54} y={sy + 39} fontFamily={FONT_BODY} fontSize={20} fill={C.burgundy700} fontWeight={700}>
                Patient · listening (partial)
              </text>
              <text x={sx + 26} y={sy + 88} fontFamily={FONT_DISPLAY} fontSize={tall ? 34 : 38} fill={C.burgundy900} fontStyle="italic">
                {partial}
              </text>
              <g transform={`translate(${sx + sw - 170} ${sy + 72})`}>
                {Array.from({ length: 12 }, (_, i) => {
                  const hgt = 6 + 34 * speaking * (0.25 + 0.75 * Math.abs(Math.sin(t * 8 + i * 0.9)));
                  return <rect key={i} x={i * 13} y={-hgt / 2} width={7} height={hgt} rx={3.5} fill={C.teal500} />;
                })}
              </g>
            </g>
          )}

          {/* recent conversation context */}
          {context > 0 && (
            <g opacity={context} transform={`translate(0 ${(1 - context) * 10})`}>
              <rect x={cx} y={cy} width={cw} height={ch} rx={24} fill={C.cream100} stroke={LINE} strokeWidth={3} />
              <text x={cx + 26} y={cy + 40} fontFamily={FONT_BODY} fontSize={19} fontWeight={700} fill={C.teal700}>
                RECENT CONVERSATION
              </text>
              <text x={cx + 26} y={cy + 84} fontFamily={FONT_BODY} fontSize={tall ? 21 : 23} fill={C.burgundy900}>
                <tspan fontWeight={700}>Partner</tspan> — Would you like water or tea?
              </text>
              <text x={cx + 26} y={cy + 124} fontFamily={FONT_BODY} fontSize={tall ? 21 : 23} fill={C.burgundy900}>
                <tspan fontWeight={700}>Patient</tspan> — wa… water
              </text>
            </g>
          )}

          {/* stable gesture */}
          {ring > 0 && (
            <g opacity={ring}>
              <circle cx={handX} cy={handY - 8} r={58 * (0.9 + 0.1 * ring)} fill="none" stroke={C.coral400} strokeWidth={5} strokeDasharray="14 10" />
              <g transform={`translate(${g.tag[0]} ${g.tag[1]})`}>
                <rect width={g.tag[2]} height={58} rx={29} fill={C.coral400} stroke={LINE} strokeWidth={3} />
                <text x={g.tag[2] / 2} y={37} textAnchor="middle" fontFamily={FONT_BODY} fontSize={20} fontWeight={700} fill={C.burgundy900}>
                  Thumb up · stable · “yes”
                </text>
              </g>
            </g>
          )}

          {/* signals converge */}
          {lines > 0 && (
            <g fill="none" strokeWidth={4} strokeLinecap="round">
              <path pathLength={1} strokeDasharray="1" strokeDashoffset={1 - lines} stroke={C.teal500} d={`M${sx + 40},${sy + sh} C${sx},${ny - 20} ${nx + nw},${ny - 30} ${nx + nw - 40},${ny + 4}`} />
              <path pathLength={1} strokeDasharray="1" strokeDashoffset={1 - lines} stroke={C.coral400} d={`M${handX - 40},${handY + 10} C${handX - 120},${handY + 40} ${nx + nw + 40},${ny + nh + 20} ${nx + nw - 20},${ny + nh - 6}`} />
              <path pathLength={1} strokeDasharray="1" strokeDashoffset={1 - lines} stroke={C.burgundy500} d={`M${cx + cw * 0.7},${cy + ch} C${cx + cw * 0.75},${ny} ${nx - 40},${ny + nh / 2} ${nx + 6},${ny + nh / 2}`} />
            </g>
          )}
          {node > 0 && (
            <g opacity={node} transform={`translate(0 ${(1 - node) * 6})`}>
              <rect x={nx} y={ny} width={nw} height={nh} rx={nh / 2} fill={C.burgundy700} stroke={LINE} strokeWidth={3} />
              <text x={nx + nw / 2} y={ny + nh / 2 + 8} textAnchor="middle" fontFamily={FONT_BODY} fontSize={22} fontWeight={700} fill={C.white}>
                speech + gesture + context
              </text>
            </g>
          )}

          {/* candidate replies */}
          {CANDIDATES.map((text, i) => {
            const o = chips[i];
            if (o <= 0) return null;
            const isChosen = i === 0 && chosen > 0;
            // Unchosen replies recede by colour, never by transparency (so nothing shows through).
            const muted = i !== 0 && chosen > 0;
            return (
              <g key={text} opacity={o} transform={`translate(0 ${(1 - o) * 14})`}>
                <rect x={g.chips.x} y={g.chips.ys[i]} width={g.chips.w} height={g.chips.h} rx={22}
                  fill={isChosen ? C.coral400 : muted ? C.cream100 : C.white} stroke={muted ? C.burgundy500 : LINE} strokeWidth={isChosen ? 4 : 3} />
                <text x={g.chips.x + 28} y={g.chips.ys[i] + g.chips.h / 2 + g.chips.size * 0.36} fontFamily={FONT_BODY} fontSize={g.chips.size}
                  fill={muted ? C.burgundy500 : C.burgundy900} fontWeight={isChosen ? 700 : 400}>
                  {text}
                </text>
                {i === 0 && check > 0 && (
                  <g opacity={check} transform={`translate(${g.chips.x + g.chips.w - 38} ${g.chips.ys[i] + g.chips.h / 2})`}>
                    <circle r={22} fill={C.burgundy900} />
                    <path d="M-10,0 l7,8 l13,-15" fill="none" stroke={C.white} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" />
                  </g>
                )}
              </g>
            );
          })}
          {check > 0 && (
            <text x={g.chips.x} y={g.chips.ys[0] - 16} opacity={check} fontFamily={FONT_BODY} fontSize={21} fontWeight={700} fill={C.burgundy700}>
              Confirmed by the patient — exact words
            </text>
          )}

          {/* the spoken, confirmed sentence */}
          {subtitle > 0 && (
            <g opacity={subtitle} transform={`translate(0 ${(1 - subtitle) * 16})`}>
              <rect x={ux} y={uy} width={uw} height={uh} rx={uh / 2.6} fill={C.burgundy900} />
              <g transform={`translate(${ux + 58} ${uy + uh / 2})`}>
                <path d="M-18,-10 h10 l14,-12 v44 l-14,-12 h-10 Z" transform="translate(0 -10)" fill={C.peach200} />
                {[0, 1].map((k) => (
                  <path key={k} d={`M${14 + k * 12},-${12 + k * 8} q${8 + k * 4},${12 + k * 8} 0,${24 + k * 16}`} fill="none" stroke={C.peach200} strokeWidth={4} strokeLinecap="round" opacity={0.35 + 0.65 * sound} />
                ))}
              </g>
              <text x={ux + uw / 2 + 30} y={uy + uh / 2 + us * 0.36} textAnchor="middle" fontFamily={FONT_DISPLAY} fontSize={us} fill={C.cream50}>
                I would like water, please.
              </text>
            </g>
          )}
        </g>
      )}
    </svg>
  );
}

export const HERO_ALT =
  "Illustration: two adults sit at a small table. The partner asks “Would you like water or tea?”. The patient answers “wa… water” and gives a thumbs-up. Three replies are suggested, the patient confirms “I would like water, please.”, and that sentence is spoken with a large subtitle.";
