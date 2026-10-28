import type { ChurchActor } from "../actor";
import { classifyDbError, failure } from "../errors";
import type { Result } from "../handlers";
import { booleanField, isTimestamp, makeBodyParser } from "../lifecycle/validation";

// Churches & Ministries expansion: the church's FEATURE SWITCHES (Bible in one year, counselling, giving). Everything behind /api/church/features.
//
// Only the church OWNER reads or changes them (a switch decides what the whole congregation is offered). Every feature is OFF until the owner turns it on. The giving switch cannot be turned on yet: money
// collection waits for the financial rules to be settled (see docs/church-giving-decisions.md), so the server refuses `giving: true` whatever the database would accept.

const ok = (body: Record<string, unknown> = {}, status = 200): Result => ({ status, body: { ok: true, ...body } });
const fail = (status: number, code: string, field?: string): Result => failure(status, code, field);
const sameInstant = (a: unknown, b: unknown) => Date.parse(String(a)) === Date.parse(String(b));

export const FEATURE_KEYS = ["bible_year", "counselling", "giving"] as const;
/** Whether real-money features may be switched on. False until the owner of the platform settles the financial rules. */
export const GIVING_AVAILABLE = true;

const parse = makeBodyParser({ texts: {}, fields: { bible_year: booleanField, counselling: booleanField, giving: booleanField } });
const COLS = "bible_year, counselling, giving, updated_at";
const DEFAULTS = { bible_year: false, counselling: false, giving: false, updated_at: null };

export async function getFeatures(a: ChurchActor, params: URLSearchParams): Promise<Result> {
  if (a.kind !== "owner") return fail(403, "forbidden");
  for (const k of Array.from(params.keys())) return fail(400, "unexpected_field", k);
  const { data, error } = await a.supabase.from("church_features").select(COLS).eq("profile_id", a.profileId).maybeSingle();
  if (error) return fromDb(error);
  return ok({ item: data ?? DEFAULTS, giving_available: GIVING_AVAILABLE });
}

/** PUT { bible_year?, counselling?, giving?, expected_updated_at? }: the first save creates the row; later saves name the version they are based on. */
export async function saveFeatures(a: ChurchActor, body: unknown): Promise<Result> {
  if (a.kind !== "owner") return fail(403, "forbidden");
  // expected_updated_at is not part of the field allowlist of the shared parser: take it out first
  let expected: unknown;
  let rest = body;
  if (body && typeof body === "object" && !Array.isArray(body) && "expected_updated_at" in (body as object)) {
    const { expected_updated_at, ...others } = body as Record<string, unknown>;
    expected = expected_updated_at;
    rest = others;
  }
  const parsed = parse(rest, "update");
  if (!parsed.ok) return fail(400, parsed.code, parsed.field);
  const changes = parsed.value as Record<string, boolean>;
  if (changes.giving === true && !GIVING_AVAILABLE) return fail(409, "giving_unavailable", "giving");
  const cur = await a.supabase.from("church_features").select("updated_at").eq("profile_id", a.profileId).maybeSingle();
  if (cur.error) return fromDb(cur.error);
  if (!cur.data) {
    const ins = await a.supabase.from("church_features").insert({ profile_id: a.profileId, ...changes }).select(COLS);
    if (ins.error) return fromDb(ins.error);
    const row = Array.isArray(ins.data) ? ins.data[0] : ins.data;
    return row ? ok({ item: row, giving_available: GIVING_AVAILABLE }, 201) : fail(403, "forbidden");
  }
  if (!isTimestamp(expected)) return fail(400, "invalid_body", "expected_updated_at");
  if (!sameInstant(expected, (cur.data as Record<string, any>).updated_at)) return fail(409, "stale");
  const up = await a.supabase.from("church_features").update(changes).eq("profile_id", a.profileId).eq("updated_at", (cur.data as Record<string, any>).updated_at).select(COLS);
  if (up.error) return fromDb(up.error);
  if (!Array.isArray(up.data) || up.data.length === 0) return fail(409, "stale");
  return ok({ item: up.data[0], giving_available: GIVING_AVAILABLE });
}

function fromDb(error: unknown): Result {
  const o = classifyDbError(error as any);
  if (o.status >= 500) console.error(JSON.stringify({ scope: "church_features", result: "db_error", code: String((error as any)?.code || "") }));
  return fail(o.status, o.code);
}
