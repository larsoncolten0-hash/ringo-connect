// Customer segments (Phase 3): new, returning, VIP and inactive, COMPUTED on demand from data that already exists - nothing is stored, so a segment can never be stale.
// The rule lives in the database (customer_segments, 2027-01-18_customer_retention.sql); classifySegment below is the same rule in code, kept so the thresholds are documented, testable and
// shown to the owner in one place. Both must agree (the tests run the real function against it).
//
// An INTERACTION is a loyalty record the business made, or a booking / restaurant order / music order the customer linked to this profile. Church attendance, membership, giving and
// testimonies are never read. A business only ever sees COUNTS per segment; it is never given a list of names by segment.

export const SEGMENTS = ["new", "returning", "vip", "inactive"] as const;
export type Segment = (typeof SEGMENTS)[number];
export const isSegment = (v: unknown): v is Segment => typeof v === "string" && (SEGMENTS as readonly string[]).includes(v);

export const SEGMENT_RULES = { inactiveAfterDays: 60, vipInteractionsIn90Days: 6, returningInteractions: 2 } as const;
const DAY = 86_400_000;

export interface SegmentFacts {
  /** Epoch ms of the latest interaction, or of the connection when there is none. */
  lastSeenMs: number;
  /** Interactions in the last 90 days. */
  count90: number;
  /** Interactions in all. */
  total: number;
}

export function classifySegment(f: SegmentFacts, nowMs: number): Segment {
  if (f.lastSeenMs < nowMs - SEGMENT_RULES.inactiveAfterDays * DAY) return "inactive";
  if (f.count90 >= SEGMENT_RULES.vipInteractionsIn90Days) return "vip";
  if (f.total >= SEGMENT_RULES.returningInteractions) return "returning";
  return "new";
}

export type SegmentDb = { rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: any; error: any }> };

/** customer id -> segment, for the ACTIVE connections of one profile. Server side only. */
export async function loadSegments(db: SegmentDb, profileId: string): Promise<{ ok: true; map: Map<string, Segment> } | { ok: false }> {
  try {
    const { data, error } = await db.rpc("customer_segments", { p_profile: profileId });
    if (error || !Array.isArray(data)) return { ok: false };
    const map = new Map<string, Segment>();
    for (const row of data as Array<{ customer_id: string; segment: string }>) if (isSegment(row.segment)) map.set(row.customer_id, row.segment);
    return { ok: true, map };
  } catch {
    return { ok: false };
  }
}

export type SegmentCounts = Record<Segment, number> & { total: number };

export function countSegments(map: ReadonlyMap<string, Segment>): SegmentCounts {
  const counts: SegmentCounts = { new: 0, returning: 0, vip: 0, inactive: 0, total: 0 };
  for (const s of map.values()) {
    counts[s]++;
    counts.total++;
  }
  return counts;
}

/** One customer's segment at one profile, or null when they are not actively connected. */
export async function segmentOf(db: SegmentDb, profileId: string, customerId: string): Promise<Segment | null> {
  try {
    const { data, error } = await db.rpc("customer_segments", { p_profile: profileId, p_customer: customerId });
    if (error || !Array.isArray(data) || data.length === 0) return null;
    return isSegment(data[0].segment) ? data[0].segment : null;
  } catch {
    return null;
  }
}
