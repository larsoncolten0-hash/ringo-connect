import { createAdminClient } from "@/lib/supabase/server";
import {
  POINTS_ACTION_KEY,
  SPEND_ACTION_KEY,
  isProgramAllowed,
  type LoyaltyOptions,
  type LoyaltyProgramType,
} from "@/lib/loyalty/categories";
import type { LoyaltyAdmin } from "@/lib/loyalty/engine";

// Loyalty programs are CONFIGURATION: the service role may insert them and edit only the
// non-identity columns (column-level UPDATE grant in the migration). type, action_key,
// currency and profile_id can never change after creation, and the database enforces that,
// not just this file. The profile always comes from the authenticated business session.

export interface ProgramRow {
  id: string;
  type: LoyaltyProgramType;
  action_key: string;
  name: string;
  currency: string | null;
  target: number;
  unit_amount: number | null;
  points_per_unit: number | null;
  reward_title: string;
  reward_expires_days: number | null;
  active: boolean;
  created_at: string;
}

const COLUMNS =
  "id, type, action_key, name, currency, target, unit_amount, points_per_unit, reward_title, reward_expires_days, active, created_at";

export async function listPrograms(profileId: string, admin: LoyaltyAdmin = createAdminClient()): Promise<ProgramRow[]> {
  const { data, error } = await admin
    .from("loyalty_programs")
    .select(COLUMNS)
    .eq("profile_id", profileId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listPrograms failed: ${error.message}`);
  return (data ?? []) as ProgramRow[];
}

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

const cleanTitle = (v: unknown, max = 120): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length >= 1 && t.length <= max ? t : null;
};

const parseExpiry = (v: unknown): number | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  return isInt(v, 1, 3650) ? v : undefined;
};

// A practical ceiling for "how many visits", well inside the database's own bound.
const MAX_VISIT_TARGET = 1000;
const MAX_TARGET = 100_000_000;

export type ProgramCreateInput = {
  type: LoyaltyProgramType;
  action_key: string;
  name: string;
  currency: string | null;
  target: number;
  unit_amount: number | null;
  points_per_unit: number | null;
  reward_title: string;
  reward_expires_days: number | null;
};

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseProgramCreate(
  body: Record<string, unknown>,
  options: LoyaltyOptions,
  profileCurrency: string | null
): ParseResult<ProgramCreateInput> {
  const type = body.type;
  if (type !== "visits" && type !== "spend" && type !== "points") return { ok: false, error: "invalid_request" };

  const actionKey = type === "spend" ? SPEND_ACTION_KEY : type === "points" ? POINTS_ACTION_KEY : body.action_key;
  if (typeof actionKey !== "string" || !isProgramAllowed(options, type, actionKey)) return { ok: false, error: "invalid_request" };

  const target = body.target;
  if (!isInt(target, 1, type === "visits" ? MAX_VISIT_TARGET : MAX_TARGET)) return { ok: false, error: "invalid_request" };

  const rewardTitle = cleanTitle(body.reward_title);
  if (!rewardTitle) return { ok: false, error: "invalid_request" };
  const name = body.name === undefined || body.name === null || body.name === "" ? rewardTitle : cleanTitle(body.name);
  if (!name) return { ok: false, error: "invalid_request" };

  const expires = parseExpiry(body.reward_expires_days);
  if (expires === undefined && body.reward_expires_days !== undefined) return { ok: false, error: "invalid_request" };

  let currency: string | null = null;
  let unitAmount: number | null = null;
  let pointsPerUnit: number | null = null;
  if (type !== "visits") {
    // The business's own profile currency is the reference. A body value is only a fallback
    // for a profile that has none, and must itself be a 3-letter ISO-style code.
    const fromProfile = typeof profileCurrency === "string" ? profileCurrency.toUpperCase() : null;
    const fromBody = typeof body.currency === "string" ? body.currency.toUpperCase() : null;
    currency = fromProfile && /^[A-Z]{3}$/.test(fromProfile) ? fromProfile : fromBody && /^[A-Z]{3}$/.test(fromBody) ? fromBody : null;
    if (!currency) return { ok: false, error: "currency_missing" };
  }
  if (type === "points") {
    if (!isInt(body.unit_amount, 1, MAX_TARGET) || !isInt(body.points_per_unit, 1, 1_000_000)) return { ok: false, error: "invalid_request" };
    unitAmount = body.unit_amount;
    pointsPerUnit = body.points_per_unit;
  }

  return {
    ok: true,
    value: {
      type,
      action_key: actionKey,
      name,
      currency,
      target,
      unit_amount: unitAmount,
      points_per_unit: pointsPerUnit,
      reward_title: rewardTitle,
      reward_expires_days: expires ?? null,
    },
  };
}

export type ProgramPatch = Partial<{
  name: string;
  target: number;
  reward_title: string;
  reward_expires_days: number | null;
  active: boolean;
  unit_amount: number;
  points_per_unit: number;
}>;

/** Only the editable columns, validated against the program's (immutable) type. */
export function parseProgramUpdate(body: Record<string, unknown>, type: LoyaltyProgramType): ParseResult<ProgramPatch> {
  const patch: ProgramPatch = {};
  if (body.name !== undefined) {
    const v = cleanTitle(body.name);
    if (!v) return { ok: false, error: "invalid_request" };
    patch.name = v;
  }
  if (body.reward_title !== undefined) {
    const v = cleanTitle(body.reward_title);
    if (!v) return { ok: false, error: "invalid_request" };
    patch.reward_title = v;
  }
  if (body.target !== undefined) {
    if (!isInt(body.target, 1, type === "visits" ? MAX_VISIT_TARGET : MAX_TARGET)) return { ok: false, error: "invalid_request" };
    patch.target = body.target;
  }
  if (body.reward_expires_days !== undefined) {
    const v = parseExpiry(body.reward_expires_days);
    if (v === undefined) return { ok: false, error: "invalid_request" };
    patch.reward_expires_days = v;
  }
  if (body.active !== undefined) {
    if (typeof body.active !== "boolean") return { ok: false, error: "invalid_request" };
    patch.active = body.active;
  }
  if (body.unit_amount !== undefined || body.points_per_unit !== undefined) {
    if (type !== "points") return { ok: false, error: "invalid_request" };
    if (body.unit_amount !== undefined) {
      if (!isInt(body.unit_amount, 1, MAX_TARGET)) return { ok: false, error: "invalid_request" };
      patch.unit_amount = body.unit_amount;
    }
    if (body.points_per_unit !== undefined) {
      if (!isInt(body.points_per_unit, 1, 1_000_000)) return { ok: false, error: "invalid_request" };
      patch.points_per_unit = body.points_per_unit;
    }
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: "invalid_request" };
  return { ok: true, value: patch };
}

export async function createProgram(
  profileId: string,
  userId: string,
  input: ProgramCreateInput,
  admin: LoyaltyAdmin = createAdminClient()
): Promise<{ ok: true; program: ProgramRow } | { ok: false; error: "program_exists" | "server_error" }> {
  const { data, error } = await admin
    .from("loyalty_programs")
    .insert({ ...input, profile_id: profileId, created_by: userId })
    .select(COLUMNS)
    .single();
  if (error) {
    // 23505: the "one active program per (profile, type, action)" partial unique index.
    if ((error as any).code === "23505") return { ok: false, error: "program_exists" };
    console.error("createProgram failed:", error.message);
    return { ok: false, error: "server_error" };
  }
  return { ok: true, program: data as ProgramRow };
}

export async function updateProgram(
  profileId: string,
  programId: string,
  patch: ProgramPatch,
  admin: LoyaltyAdmin = createAdminClient()
): Promise<{ ok: true; program: ProgramRow } | { ok: false; error: "not_found" | "program_exists" | "server_error" }> {
  const { data, error } = await admin
    .from("loyalty_programs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", programId)
    .eq("profile_id", profileId)
    .select(COLUMNS)
    .maybeSingle();
  if (error) {
    if ((error as any).code === "23505") return { ok: false, error: "program_exists" };
    console.error("updateProgram failed:", error.message);
    return { ok: false, error: "server_error" };
  }
  if (!data) return { ok: false, error: "not_found" };
  return { ok: true, program: data as ProgramRow };
}
