import { autoSaleFromProductOrder, localRangeInstants, summarize, DEFAULT_TIME_ZONE, type BkEntry, type BookkeepingSummary, type CostBasis } from "./summary";

// Loads a business's rows and hands them to the pure summarize(). Takes the client as a parameter so the
// caller decides the trust level (the route passes the owner's RLS-scoped client, tests pass a fake) and
// EVERY query still filters by profile_id explicitly — RLS is the backstop, not the only boundary.
//
// Pagination: PostgREST silently caps a response at the project's "max rows" setting, which can be LOWER
// than the page size requested here. A page shorter than requested therefore does NOT mean "last page", and
// treating it that way would silently truncate a total. So this never infers the end from a page's length:
// it advances by the number of rows actually received and stops only when a request returns NO rows. Every
// query is ordered by a unique key so offsets are stable. Exceeding the safety cap throws rather than
// returning a partial total.
const PAGE = 1000;
const MAX_ROWS = 50_000;

type Query = { range: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: { message: string } | null }> };

export async function fetchAllRows(build: () => Query, opts: { pageSize?: number; maxRows?: number } = {}): Promise<any[]> {
  const pageSize = opts.pageSize ?? PAGE;
  const maxRows = opts.maxRows ?? MAX_ROWS;
  const out: any[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await build().range(offset, offset + pageSize - 1);
    if (error) throw new Error(`bookkeeping load failed: ${error.message}`);
    const rows = data ?? [];
    if (rows.length === 0) return out; // the only way to finish: nothing further to read
    out.push(...rows);
    if (out.length > maxRows) throw new Error("bookkeeping load exceeded the safety row cap; narrow the date range");
    offset += rows.length; // by rows actually received, not by the requested page size
  }
}

export async function loadBookkeepingSummary(
  db: { from: (table: string) => any },
  args: { profileId: string; currency: string; from: string; to: string; timeZone?: string; cost?: CostBasis }
): Promise<BookkeepingSummary> {
  const tz = args.timeZone || DEFAULT_TIME_ZONE;
  const { start, endExclusive } = localRangeInstants(args.from, args.to, tz);

  const entries: BkEntry[] = await fetchAllRows(() =>
    db.from("bk_entries").select("id, kind, amount, currency, entry_date, category, cash_settled, linked_order_type, linked_order_id, voided_at")
      .eq("profile_id", args.profileId).gte("entry_date", args.from).lte("entry_date", args.to).order("entry_date").order("id")
  );

  // Verified online sales, read through (never copied). The window is the business-local day range.
  const orders = await fetchAllRows(() =>
    db.from("product_orders").select("id, status, total, currency, paid_at")
      .eq("profile_id", args.profileId).in("status", ["paid", "fulfilled"]).gte("paid_at", start).lt("paid_at", endExclusive).order("paid_at").order("id")
  );
  const autoSales = orders.map(autoSaleFromProductOrder).filter((s): s is NonNullable<typeof s> => s !== null);

  return summarize({ entries, autoSales, from: args.from, to: args.to, currency: args.currency, timeZone: tz, cost: args.cost });
}
