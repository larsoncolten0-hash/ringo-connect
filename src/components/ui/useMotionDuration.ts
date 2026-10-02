"use client";

import { useReducedMotion } from "framer-motion";

/**
 * Motion durations that respect the visitor's "reduce motion" setting. The editor wraps itself in
 * <MotionConfig reducedMotion="user"> (which turns off transform / layout animation), but height and
 * opacity transitions are not covered by that, so expand/collapse animations take their duration from here:
 * `const dur = useMotionDuration(); … transition={{ duration: dur(0.2) }}` is 0.2s normally, instant when
 * the visitor asked for less motion.
 */
export function useMotionDuration() {
  const reduce = useReducedMotion();
  return (seconds: number) => (reduce ? 0 : seconds);
}
