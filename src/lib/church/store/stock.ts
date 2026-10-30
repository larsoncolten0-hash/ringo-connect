import { inventoryAvailable } from "@/lib/inventory/access";
import { inventoryOverview } from "@/lib/inventory/handlers";
import { resolveBookkeepingOwner } from "@/lib/bookkeeping/access";

// Churches & Ministries, Phase 4: the stock figures shown on the Church Store screen. This REUSES the Business Toolkit Inventory (nothing is stored or computed here): the same inv_overview answer the
// Inventory screen uses, for the same owner, reduced to three counts and the names of the products that need attention. Stock of Shop products only: it is separate from giving and from the books.
// Before the Inventory migration for churches is applied (or when the plan does not include the Toolkit) the answer is "unavailable" and the screen simply offers nothing, never a wrong number.

export type ChurchStock = { state: "unavailable" } | { state: "ready"; tracked: number; low: number; out: number; attention: Array<{ id: string; name: string; state: "low" | "out"; count: number | null }> };

const MAX_LISTED = 5;
const int = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : 0);

/** Pure: the inv_overview body -> the Church Store stock card. Out of stock is listed before low stock. */
export function stockFromOverview(body: { summary?: Record<string, unknown>; items?: Array<Record<string, unknown>> } | null | undefined): ChurchStock {
  if (!body || typeof body !== "object" || !body.summary) return { state: "unavailable" };
  const attention = (body.items || [])
    .filter((i) => i && (i.state === "low" || i.state === "out") && typeof i.name === "string")
    .sort((a, b) => (a.state === b.state ? 0 : a.state === "out" ? -1 : 1))
    .slice(0, MAX_LISTED)
    .map((i) => ({ id: String(i.product_id), name: String(i.name), state: i.state as "low" | "out", count: typeof i.count === "number" ? i.count : null }));
  return { state: "ready", tracked: int(body.summary.tracked), low: int(body.summary.low), out: int(body.summary.out), attention };
}

export async function loadChurchStock(expectedProfileId: string): Promise<ChurchStock> {
  try {
    const access = await resolveBookkeepingOwner();
    if (!access.ok) return { state: "unavailable" };
    const owner = access.owner;
    // the Inventory owner and the church being viewed must be the same profile, or the numbers would belong to another page
    if (owner.profile.id !== expectedProfileId) return { state: "unavailable" };
    if (!(await inventoryAvailable(owner))) return { state: "unavailable" };
    // the products that need attention come first in two small reads; the totals come from the summary of either
    const [low, out] = await Promise.all([inventoryOverview(owner, { filter: "low", limit: "5" }), inventoryOverview(owner, { filter: "out", limit: "5" })]);
    if (low.status !== 200 || out.status !== 200 || !("body" in low) || !("body" in out)) return { state: "unavailable" };
    const lowBody = low.body as any;
    const outBody = out.body as any;
    return stockFromOverview({ summary: lowBody.summary, items: [...(outBody.items || []), ...(lowBody.items || [])] });
  } catch {
    return { state: "unavailable" };
  }
}
