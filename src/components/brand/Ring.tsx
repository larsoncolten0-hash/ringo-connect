import type { ConnectState } from "@/lib/design/tapToConnect";
import { connectTone } from "@/lib/design/tapToConnect";

// The Ring: Ringo's signature mark and its state of connection in one shape.
//   idle       a ring with a small gap and a node at its end: ready for a tap
//   waiting    the same open ring, sweeping round: a tap or a request is in flight
//   connected  the ring closes on itself and turns to signal: it happened
// It is a plain SVG (no WebGL, no images), colored from the design tokens. Server-renderable: no hooks, no state.
// Motion is CSS (.ringo-ring-sweep / .ringo-ring-close in globals.css) so reduced motion switches it off in one place
// and the open / closed shape still carries the meaning.
//
// Accessibility: pass `label` (already translated, see t.brand.ring) when the Ring is the only thing saying what is
// happening; it then has role="img". Without `label` it is decorative (aria-hidden), for when text beside it says it.

const R = 40;
const CIRCUMFERENCE = 2 * Math.PI * R;
export type RingWeight = "regular" | "fine";
// stroke width, the node at the end of the open arc, and the centre dot, in the 100-unit viewBox
const WEIGHTS: Record<RingWeight, { stroke: string; node: string; dot: string }> = {
  regular: { stroke: "6", node: "8", dot: "6" },
  fine: { stroke: "2.5", node: "4.5", dot: "3" },
};
const GAP = 0.18; // fraction of the circle left open
const GAP_CENTER_DEG = -45; // the gap sits at the upper right
// SVG strokes start at 3 o'clock and run clockwise: rotate so the arc begins just after the gap and ends just before it.
const ARC_START_DEG = GAP_CENTER_DEG + (GAP * 360) / 2;
const ARC_END_DEG = ARC_START_DEG + (1 - GAP) * 360;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const NODE_X = +(50 + R * Math.cos(toRad(ARC_END_DEG))).toFixed(2);
const NODE_Y = +(50 + R * Math.sin(toRad(ARC_END_DEG))).toFixed(2);

export default function Ring({
  size = 48,
  state = "idle",
  label,
  weight = "regular",
  color: colorOverride,
  className = "",
}: {
  size?: number;
  state?: ConnectState;
  label?: string;
  /** "regular" is the Ring's signature weight and the default everywhere. "fine" is a thinner stroke for very large uses (an emblem
   *  hundreds of pixels wide), where the regular weight reads as heavy. Same shape, same states, same colors. */
  weight?: RingWeight;
  /** Any CSS color, for a surface that wears a creator's own accent (a public profile). Overrides gold / signal for every state; omit it
   *  and the Ring is exactly what it always was. */
  color?: string;
  className?: string;
}) {
  const w = WEIGHTS[weight];
  const color = colorOverride ?? (connectTone(state) === "signal" ? "rgb(var(--rc-signal))" : "rgb(var(--rc-gold))");
  const track = colorOverride ? `color-mix(in srgb, ${colorOverride} 20%, transparent)` : connectTone(state) === "signal" ? "rgb(var(--rc-signal) / 0.2)" : "rgb(var(--rc-gold) / 0.2)";
  const a11y = label ? ({ role: "img", "aria-label": label } as const) : ({ "aria-hidden": true } as const);

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" className={className} focusable="false" {...a11y}>
      <circle cx="50" cy="50" r={R} stroke={track} strokeWidth={w.stroke} />
      {state === "connected" ? (
        <>
          <circle
            cx="50"
            cy="50"
            r={R}
            className="ringo-ring-close"
            stroke={color}
            strokeWidth={w.stroke}
            strokeLinecap="round"
            style={{ ["--ring-len" as string]: CIRCUMFERENCE.toFixed(2), transform: "rotate(-90deg)", transformOrigin: "50% 50%" }}
          />
          <circle cx="50" cy="50" r={w.dot} fill={color} />
        </>
      ) : (
        <>
          <g className={state === "waiting" ? "ringo-ring-sweep" : undefined}>
            <circle
              cx="50"
              cy="50"
              r={R}
              stroke={color}
              strokeWidth={w.stroke}
              strokeLinecap="round"
              strokeDasharray={`${(CIRCUMFERENCE * (1 - GAP)).toFixed(2)} ${(CIRCUMFERENCE * GAP).toFixed(2)}`}
              transform={`rotate(${ARC_START_DEG} 50 50)`}
            />
            <circle cx={NODE_X} cy={NODE_Y} r={w.node} fill={color} />
          </g>
          <circle cx="50" cy="50" r={w.dot} fill={color} opacity="0.45" />
        </>
      )}
    </svg>
  );
}
