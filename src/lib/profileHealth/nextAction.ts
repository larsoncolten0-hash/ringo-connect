import type { NextAction, Recommendation } from "./types";
import { sortRecommendations } from "./recommendations";

/** A page missing this many counted items (or more), whose top step is a basic one, is "very incomplete": the headline becomes "Complete your profile". */
export const VERY_INCOMPLETE_MISSING = 4;

/**
 * Picks the ONE primary action: the highest-priority recommendation that has not been dismissed.
 * `dismissed` is a per-device, optional list of recommendation ids (see dismissals.ts). Hiding a
 * suggestion never changes the score or the checklist.
 */
export function pickNextAction(
  recommendations: Recommendation[],
  opts: { dismissed?: Iterable<string>; missingCount?: number } = {}
): NextAction | null {
  const hidden = new Set(opts.dismissed ?? []);
  const top = sortRecommendations(recommendations).find((r) => !hidden.has(r.id));
  if (!top) return null;
  // The generic headline is only for the basics (name, photo, category, description). When the most
  // valuable missing step is something specific (the menu, music, WhatsApp…), say that instead.
  const overall = top.kind === "complete" && top.journey === "create" && (opts.missingCount ?? 0) >= VERY_INCOMPLETE_MISSING;
  return { ...top, overall };
}
