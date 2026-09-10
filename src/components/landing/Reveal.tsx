"use client";

import { motion, useReducedMotion } from "framer-motion";

// A restrained scroll-reveal — fade and a small rise, once, the first
// time a section enters view. Respects prefers-reduced-motion by simply
// rendering in its final state with no animation at all. Used throughout
// LandingView.tsx instead of animating everything at page-load, which is
// what made the previous pass feel busy rather than considered.
export default function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();

  if (reduceMotion) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}
