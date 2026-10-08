"use client";

import type { ReactNode } from "react";
import { LazyMotion, domAnimation } from "framer-motion";

// Gives the `m` components inside it the animation features they need (enter / exit, whileInView, tap / hover / focus) from framer-motion's `domAnimation` set.
// The full `motion` component bundles every feature (drag, layout projection and more) even when a component only fades or slides, so a public profile used to download all of
// it. `m` + `domAnimation` does exactly the same fades, slides, springs and exits with a smaller bundle. The features are imported statically (not loaded later), so nothing
// starts hidden and waits: behaviour and timing are the same. Each component that uses `m` wraps itself in this, so it works wherever it is rendered.
export default function MotionScope({ children }: { children: ReactNode }) {
  return <LazyMotion features={domAnimation}>{children}</LazyMotion>;
}
