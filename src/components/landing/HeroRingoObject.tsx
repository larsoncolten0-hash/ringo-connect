"use client";

import { useEffect, useState } from "react";
import RingoCard3D from "@/components/brand/RingoCard3D";
import { nextConnectState, type ConnectState } from "@/lib/design/tapToConnect";

// The hero's one focal point: the Ringo Card, reusing the design foundation's RingoCard3D (no second card implementation).
// The story it tells is one beat, once: the card arrives (it rises in), is recognised (the Ring is open, NFC · READY), then a tap
// connects it (the Ring sweeps, then closes and turns to signal). It does not loop. With reduced motion it simply stays at rest.
// The holder is a sample, so the whole object is hidden from assistive technology: the headline and the buttons carry the content.
// One warm lamp sits behind it (the card has its own on its face, kept soft); nothing else in the hero glows.
const SAMPLE_NAME = "Amina Kouam";
const SAMPLE_ID = "0042";
const TAP_AT_MS = 1400;
const CONNECT_AT_MS = 2500;

export default function HeroRingoObject() {
  const [state, setState] = useState<ConnectState>("idle");

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const tap = setTimeout(() => setState((s) => nextConnectState(s, "tap")), TAP_AT_MS);
    const confirm = setTimeout(() => setState((s) => nextConnectState(s, "confirm")), CONNECT_AT_MS);
    return () => {
      clearTimeout(tap);
      clearTimeout(confirm);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className="ringo-lamp ringo-rise"
      style={{
        ["--i" as string]: 1,
        ["--lamp-x" as string]: "50%",
        ["--lamp-y" as string]: "50%",
        ["--lamp-size" as string]: "620px",
        ["--lamp-strength" as string]: "0.16",
      }}
    >
      <RingoCard3D name={SAMPLE_NAME} ringoId={SAMPLE_ID} state={state} restTilt={{ x: 4, y: -9 }} emblem className="mx-auto max-w-[340px] sm:max-w-[420px] lg:max-w-[480px]" />
    </div>
  );
}
