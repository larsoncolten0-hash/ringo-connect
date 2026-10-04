// Quiet, verifiable milestones. Each one is a plain fact read from existing data, never an event we
// recorded. If the caller cannot supply a number (for example the orders count), that milestone is
// simply left out rather than guessed.

export type MilestoneId = "live" | "complete" | "firstVisit" | "visits100" | "firstOffering" | "firstOrder" | "firstCommunityMember";

export interface Milestone {
  id: MilestoneId;
  achieved: boolean;
  /** For count-based milestones not achieved yet: real progress, e.g. 37 of 100 visits. */
  progress?: { current: number; target: number };
}

export interface MilestoneInput {
  published: boolean;
  isComplete: boolean;
  totalPageViews?: number | null;
  /** Products/services + menu items + tracks + releases + events the owner has added. */
  offeringCount?: number | null;
  paidOrders?: number | null;
  communityMembers?: number | null;
}

export const VISITS_TARGET = 100;

// The order in which an unmet milestone is offered as "what's next".
const NEXT_ORDER: MilestoneId[] = ["complete", "firstOffering", "firstVisit", "visits100", "firstCommunityMember", "firstOrder"];

const known = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

export function detectMilestones(input: MilestoneInput): Milestone[] {
  const out: Milestone[] = [
    { id: "live", achieved: input.published },
    { id: "complete", achieved: input.isComplete },
  ];
  if (known(input.offeringCount)) out.push({ id: "firstOffering", achieved: input.offeringCount >= 1 });
  if (known(input.totalPageViews)) {
    out.push({ id: "firstVisit", achieved: input.totalPageViews >= 1 });
    const achieved = input.totalPageViews >= VISITS_TARGET;
    out.push({ id: "visits100", achieved, ...(achieved ? {} : { progress: { current: input.totalPageViews, target: VISITS_TARGET } }) });
  }
  if (known(input.communityMembers)) out.push({ id: "firstCommunityMember", achieved: input.communityMembers >= 1 });
  if (known(input.paidOrders)) out.push({ id: "firstOrder", achieved: input.paidOrders >= 1 });
  return out;
}

export function milestoneHighlights(milestones: Milestone[]): { achieved: Milestone[]; next: Milestone | null } {
  const achieved = milestones.filter((m) => m.achieved);
  const next = NEXT_ORDER.map((id) => milestones.find((m) => m.id === id)).find((m): m is Milestone => !!m && !m.achieved) ?? null;
  return { achieved, next };
}
