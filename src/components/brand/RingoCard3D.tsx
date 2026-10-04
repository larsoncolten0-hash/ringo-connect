"use client";

import { useRef } from "react";
import { Nfc } from "lucide-react";
import { motion, useMotionTemplate, useMotionValue, useReducedMotion, useSpring, useTransform } from "framer-motion";
import { useLanguage } from "@/components/LanguageProvider";
import type { ConnectState } from "@/lib/design/tapToConnect";
import Ring from "./Ring";
import MicroLabel from "./MicroLabel";

// The Ringo Card as a physical object. CSS 3D only (perspective + preserve-3d), no WebGL, no Three.js, no images.
//   edge      a dark-gold plate 5px behind the face: the card has thickness
//   face      ink, a gilt hairline, lamplight, a foil sheen and a specular highlight that follow the pointer
//   marks     the Ring and the NFC mark, 18px in front of the face, so they parallax against it
// Interaction: a mouse or pen tilts the card up to 10 degrees toward the pointer, springing back on leave. Touch does NOT
// tilt (it would fight scrolling), and reduced motion renders the card flat and still (no pointer value is ever set). Pointer values are motion values,
// not React state, so moving the pointer never re-renders the tree.
// State is controlled by the caller (`state`, see lib/design/tapToConnect.ts): idle -> the Ring is open and the label says
// NFC · READY; waiting -> the Ring sweeps; connected -> the Ring closes, the card glows signal. This component never touches
// NFC hardware or the network. It is a presentation foundation: nothing renders it yet.
// The card's own colors are the always-dark stage tokens, so it looks the same in the light and dark app themes.

const MAX_TILT_DEG = 10;
const SPRING = { stiffness: 180, damping: 20, mass: 0.4 };
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export default function RingoCard3D({
  name,
  ringoId,
  state = "idle",
  interactive = true,
  restTilt,
  emblem = false,
  className = "max-w-[340px]",
}: {
  /** The card holder's name, as printed on the card. */
  name: string;
  /** The Ringo ID shown on the card (for example "0042"). */
  ringoId: string;
  state?: ConnectState;
  /** Tilt toward a mouse or pen pointer. Always off for touch and for reduced motion. */
  interactive?: boolean;
  /** A fixed resting pose in degrees (so the card reads as an object even before anyone touches it). The pointer tilts around it. */
  restTilt?: { x?: number; y?: number };
  /** A large, faint Ring cropped by the card edge: the signature, at object scale. Off by default. */
  emblem?: boolean;
  className?: string;
}) {
  const { t } = useLanguage();
  const b = t.brand;
  const reduceMotion = useReducedMotion();
  const tiltEnabled = interactive && !reduceMotion;
  const stageRef = useRef<HTMLDivElement>(null);

  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const sx = useSpring(px, SPRING);
  const sy = useSpring(py, SPRING);
  const restX = restTilt?.x ?? 0;
  const restY = restTilt?.y ?? 0;
  const rotateY = useTransform(sx, [0, 1], [restY - MAX_TILT_DEG, restY + MAX_TILT_DEG]);
  const rotateX = useTransform(sy, [0, 1], [restX + MAX_TILT_DEG, restX - MAX_TILT_DEG]);
  // The foil sheen and the pointer highlight exist only while a pointer is over the card; at rest the face is clean ink.
  const hover = useMotionValue(0);
  const hoverOpacity = useSpring(hover, SPRING);
  const specX = useTransform(sx, [0, 1], [0, 100]);
  const specY = useTransform(sy, [0, 1], [0, 100]);
  const foilX = useTransform(sx, [0, 1], [100, 0]);
  const specular = useMotionTemplate`radial-gradient(circle at ${specX}% ${specY}%, rgb(255 255 255 / 0.12), transparent 55%)`;
  const foilPosition = useMotionTemplate`${foilX}% 0%`;

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!tiltEnabled || e.pointerType === "touch" || !stageRef.current) return;
    const r = stageRef.current.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    px.set(clamp01((e.clientX - r.left) / r.width));
    py.set(clamp01((e.clientY - r.top) / r.height));
    hover.set(1);
  };
  const onPointerLeave = () => {
    px.set(0.5);
    py.set(0.5);
    hover.set(0);
  };

  const connected = state === "connected";
  const status = connected ? b.card.connected : state === "waiting" ? b.card.tapToConnect : b.card.nfcReady;

  return (
    <div
      ref={stageRef}
      role="group"
      aria-label={b.card.ariaLabel(name)}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      className={["w-full", className].filter(Boolean).join(" ")}
      style={{ perspective: 900 }}
    >
      <motion.div
        className="relative aspect-[1.586]"
        style={{ rotateX, rotateY, transformStyle: "preserve-3d" }}
      >
        {/* edge: the card's thickness */}
        <div
          aria-hidden="true"
          className={[
            "absolute inset-0 rounded-ringo-lg bg-gradient-to-br from-ringo-gold-dark to-ringo-ink transition-shadow duration-ringo-slow ease-ringo",
            connected ? "shadow-ringo-signal" : "shadow-ringo-3",
          ].join(" ")}
          style={{ transform: "translateZ(-5px)" }}
        />

        {/* face */}
        <div
          className={[
            "ringo-gilt ringo-lamp absolute inset-0 overflow-hidden rounded-ringo-lg",
            connected ? "ringo-lamp--signal" : "",
          ].join(" ")}
          style={{
            background: "linear-gradient(150deg, rgb(var(--rc-ink-2)), rgb(var(--rc-ink)) 62%)",
            ["--lamp-x" as string]: "16%",
            ["--lamp-y" as string]: "0%",
            ["--lamp-size" as string]: "380px",
            ["--lamp-strength" as string]: "0.18",
          }}
        >
          <motion.div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(115deg, transparent 22%, rgb(var(--rc-gold-light) / 0.08) 42%, rgb(var(--rc-gold-light) / 0.14) 50%, rgb(var(--rc-gold) / 0.06) 58%, transparent 78%)",
              backgroundSize: "250% 100%",
              backgroundPosition: foilPosition,
              opacity: hoverOpacity,
            }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{ backgroundImage: "radial-gradient(circle at 16% 0%, rgb(255 255 255 / 0.1), transparent 52%)" }}
          />
          <motion.div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ backgroundImage: specular, opacity: hoverOpacity }} />
          {/* one arrival sweep; reduced motion hides it in CSS (not here, so server and client render the same tree) */}
          <div
            aria-hidden="true"
            className="ringo-card-sweep pointer-events-none absolute inset-0"
            style={{ backgroundImage: "linear-gradient(105deg, transparent 40%, rgb(255 255 255 / 0.3) 50%, transparent 60%)" }}
          />

          {emblem && (
            <div aria-hidden="true" className="pointer-events-none absolute -right-[14%] top-1/2 aspect-square h-[118%] -translate-y-1/2 opacity-[0.1]">
              <Ring size={400} state={connected ? "connected" : "idle"} className="h-full w-full" />
            </div>
          )}

          <div className="relative flex h-full flex-col justify-end p-5">
            <p className="truncate font-display text-lg font-semibold leading-tight text-ringo-paper min-[380px]:text-xl sm:text-2xl">{name}</p>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <MicroLabel surface="dark" tone="muted" className="whitespace-nowrap">
                {b.card.ringoId} {ringoId}
              </MicroLabel>
              <span aria-live="polite">
                <MicroLabel surface="dark" tone={connected ? "signal" : "gold"} live={connected} className="whitespace-nowrap">
                  {status}
                </MicroLabel>
              </span>
            </div>
          </div>
        </div>

        {/* marks: in front of the face */}
        <div
          className="pointer-events-none absolute inset-x-5 top-5 flex items-center justify-between"
          style={{ transform: "translateZ(18px)" }}
        >
          {/* decorative: the status text beside it already says what the Ring shows */}
          <Ring size={40} state={state} />
          <Nfc size={24} strokeWidth={1.75} className="text-ringo-gold" aria-hidden="true" />
        </div>
      </motion.div>
    </div>
  );
}
