import { NextResponse } from "next/server";
import { resolveBookkeepingOwner } from "@/lib/bookkeeping/access";
import { denialResponse } from "@/lib/bookkeeping/http";
import { currencyMinorDigits, parseMinor } from "@/lib/bookkeeping/money";
import { ENTRY_KINDS } from "@/lib/bookkeeping/summary";
import { PRIVATE_HEADERS } from "@/lib/documents/routeKit";

export const dynamic = "force-dynamic";

const MAX_LIMIT = 100;

// Owner-only, READ-ONLY list of the caller's own bookkeeping entries (newest first), for the Bookkeeping entries screen. Creating and voiding
// stay on the existing POST /api/bookkeeping/entries and POST /api/bookkeeping/entries/[id]/void, with all their validation and rules.
// Reads through the owner's RLS-scoped client AND filters by profile_id explicitly.
export async function GET(request: Request) {
  const access = await resolveBookkeepingOwner();
  if (!access.ok) return denialResponse(access.reason);
  const { owner } = access;
  const q = new URL(request.url).searchParams;

  const kind = q.get("kind");
  if (kind && !(ENTRY_KINDS as readonly string[]).includes(kind)) return NextResponse.json({ error: "validation_failed", details: ["invalid_kind"] }, { status: 400 });
  const n = (v: string | null, d: number) => (v && /^\d{1,6}$/.test(v) ? Number(v) : d);
  const limit = Math.min(Math.max(n(q.get("limit"), 25), 1), MAX_LIMIT);
  const offset = n(q.get("offset"), 0);
  const includeVoided = q.get("include_voided") === "1";

  let query = owner.supabase
    .from("bk_entries")
    .select("id, kind, amount, currency, entry_date, category, description, cash_settled, voided_at, void_reason, created_at")
    .eq("profile_id", owner.profile.id);
  if (kind) query = query.eq("kind", kind);
  if (!includeVoided) query = query.is("voided_at", null);
  // one extra row tells whether another page exists without trusting a page length (PostgREST may cap responses)
  const { data, error } = await query.order("entry_date", { ascending: false }).order("created_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + limit);
  if (error) {
    console.error("bookkeeping history failed:", String(error.message || "").slice(0, 200));
    return NextResponse.json({ error: "internal_error" }, { status: 500, headers: { ...PRIVATE_HEADERS } });
  }
  const rows = (data ?? []) as any[];
  const items = rows.slice(0, limit).map((e) => ({
    id: e.id,
    kind: e.kind,
    amount_minor: parseMinor(typeof e.amount === "number" ? String(e.amount) : e.amount, currencyMinorDigits(String(e.currency))),
    currency: String(e.currency).toUpperCase(),
    entry_date: e.entry_date,
    category: e.category ?? null,
    description: e.description ?? null,
    cash_settled: e.cash_settled === true,
    voided_at: e.voided_at ?? null,
    void_reason: e.void_reason ?? null,
    created_at: e.created_at,
    invoice_payment: e.category === "invoice_payment" && e.kind === "sale",
  }));
  return NextResponse.json({ currency: (owner.profile.currency || "XAF").toUpperCase(), items, has_more: rows.length > limit }, { headers: { ...PRIVATE_HEADERS } });
}
