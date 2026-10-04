// The Ringo motion system, in code. globals.css holds the same values as CSS variables for CSS-driven motion
// (--ringo-dur-fast/base/slow, --ringo-ease, --ringo-press-scale); this module is for framer-motion. A test
// (scripts/tests/designFoundation.test.mjs) fails if the two ever drift apart, so there is one set of numbers.
//
//   fast 120ms  a press, a toggle, a hover tint
//   base 220ms  a menu, a tab, a state change
//   slow 420ms  an entrance, the Ring closing
//
// Motion has to mean something: it shows a connection happening, or confirms a touch. It is never ambient.
// Reduced motion removes movement and keeps information: callers check `useReducedMotion()` (framer-motion) and render
// the end state, exactly as landing/Reveal.tsx does.

/** The exponential ease-out shared with landing/Reveal.tsx. */
export const RINGO_EASE = [0.16, 1, 0.3, 1] as const;

/** The same curve as a CSS timing function (for inline styles). */
export const RINGO_EASE_CSS = "cubic-bezier(0.16, 1, 0.3, 1)";

/** Durations in seconds (framer-motion's unit). */
export const RINGO_DURATION = { fast: 0.12, base: 0.22, slow: 0.42 } as const;

/** What a tappable thing scales to while pressed. */
export const RINGO_PRESS_SCALE = 0.97;

/** A list never staggers over more than this many steps, however long it is. */
export const RINGO_STAGGER_MAX = 5;

/** Seconds between staggered items. */
export const RINGO_STAGGER_STEP = 0.06;

export type RingoSpeed = keyof typeof RINGO_DURATION;

/** A framer-motion transition at one of the three speeds. */
export function ringoTransition(speed: RingoSpeed = "base", delay = 0) {
  return { duration: RINGO_DURATION[speed], ease: RINGO_EASE, delay };
}

/** The delay of item `index` in a staggered group: 0, 60, 120, 180, 240ms, then flat (never a long tail). */
export function staggerDelay(index: number, base = 0): number {
  const step = Math.min(Math.max(Math.floor(Number.isFinite(index) ? index : 0), 0), RINGO_STAGGER_MAX - 1);
  return base + step * RINGO_STAGGER_STEP;
}
