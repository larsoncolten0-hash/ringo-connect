import type { ChurchActor } from "../actor";
import { classifyDbError, failure } from "../errors";
import type { Result } from "../handlers";

// Churches & Ministries expansion, Phase 4: the counts at the top of the Members screen. Everything behind GET /api/church/members/summary.
//
// Same rules as every church handler: the church is actor.profileId (server-resolved), every query goes through the user's own session so row-level security decides which rows can be counted, and a
// failure is a short code. A count never carries a name or a contact detail. The number of children is only given to a person who may see children (the database would hide the rows from anyone else,
// and a count that silently left them out would be wrong, so it is left out of the answer instead).

const ok = (body: Record<string, unknown> = {}, status = 200): Result => ({ status, body: { ok: true, ...body } });
const fail = (status: number, code: string, field?: string): Result => failure(status, code, field);

export async function membersSummary(a: ChurchActor, params: URLSearchParams): Promise<Result> {
  if (a.kind === "leader" || !a.caps.viewMembers) return fail(403, "forbidden");
  for (const k of Array.from(params.keys())) return fail(400, "unexpected_field", k);

  const count = async (filter: (q: any) => any): Promise<{ n: number; error: unknown }> => {
    const q = filter(a.supabase.from("church_members").select("id", { count: "exact", head: true }).eq("profile_id", a.profileId));
    const { count: n, error } = await q;
    return { n: typeof n === "number" ? n : 0, error };
  };

  const wantChildren = a.caps.viewChildren || a.caps.manageChildren;
  const [active, adults, youth, pending, children] = await Promise.all([
    count((q) => q.eq("status", "active")),
    count((q) => q.eq("status", "active").eq("age_group", "adult")),
    count((q) => q.eq("status", "active").eq("age_group", "youth")),
    count((q) => q.eq("status", "pending")),
    wantChildren ? count((q) => q.eq("status", "active").eq("age_group", "child")) : Promise.resolve({ n: 0, error: null }),
  ]);
  const error = [active, adults, youth, pending, children].find((r) => r.error)?.error;
  if (error) {
    const o = classifyDbError(error as any);
    if (o.status >= 500) console.error(JSON.stringify({ scope: "church_members_summary", result: "db_error", code: String((error as any)?.code || "") }));
    return fail(o.status, o.code);
  }
  return ok({ members: active.n, adults: adults.n, youth: youth.n, pending: pending.n, ...(wantChildren ? { children: children.n } : {}) });
}
