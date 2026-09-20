// The Association Program is fully built but deliberately NOT public for now.
// Every public surface (landing, /get-started, /demo, pricing, subscription
// pages, dashboard nav, association routes) reads this single switch, so the
// whole feature can be brought back by flipping it to true — no code, table
// or data was removed.
export const ASSOCIATION_PUBLIC = false;

type PlanLike = { name?: string | null; association_enabled?: boolean | null };

// Association plans are never listed in plan pickers/pricing while the
// program is hidden. `keepName` lets a page keep showing the plan an
// account is already on.
export function publicPlans<T extends PlanLike>(plans: T[] | null | undefined, keepName?: string | null): T[] {
  const list = plans || [];
  if (ASSOCIATION_PUBLIC) return list;
  return list.filter((p) => (!p.association_enabled && !(p.name || "").startsWith("association_")) || (!!keepName && p.name === keepName));
}
