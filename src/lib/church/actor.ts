import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgCookie, getOrgTeamEnabled } from "@/lib/team/access";
import { CHURCH_PERMISSIONS, churchCapabilities, churchPermissionsOf, type ChurchCapabilities } from "./permissions";
import { isUuid } from "./validation";

// WHO is using the church workspace, and in WHICH church. Never taken from the request: every answer below comes from the signed-in session and the user's OWN RLS-filtered reads.
//
//   owner   the signed-in user's own profile, when it has the Churches & Ministries category. Holds every church permission (as an owner does for everything).
//   staff   an ACTIVE team member whose role holds at least one `church.*` permission, in an organization whose plan has Team Management (the same gate the Team screens use).
//   leader  a person whose own roster record (linked to their account) is active and adult. Holds no church permission; the database lets them see, and in part change, only the
//           groups they lead (church_is_group_leader). They are NOT staff and get no dashboard menu entry: they can only reach the group routes.
//
// The active-organization cookie only PICKS among the churches the user really belongs to; it never grants anything. A platform admin gets nothing from being an admin (the database
// refuses them unless they own the church), so a non-owner admin is refused here too.
//
// This module is a routing / UX layer. The data stays protected independently: every query goes through the user's own session, so row-level security and the guard triggers decide
// every read and write. There is no service-role client anywhere in the church routes.

export type ChurchActorKind = "owner" | "staff" | "leader";
export type ChurchDenial = "not_signed_in" | "no_access";

export interface ChurchActor {
  kind: ChurchActorKind;
  userId: string;
  /** The church (profile) this request is about. Server-resolved, never from the request. */
  profileId: string;
  /** The user's own session client: every read and write is filtered by RLS. */
  supabase: ChurchDb;
  permissions: readonly string[];
  caps: ChurchCapabilities;
}
export type ChurchActorResult = { ok: true; actor: ChurchActor } | { ok: false; reason: ChurchDenial };

/** The slice of the Supabase client the church code uses (structural, so tests can supply a database-backed double). */
export type ChurchDb = { from(table: string): any; rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: any; error: any }>; auth: { getUser(): Promise<{ data: { user: { id: string } | null } }> } };

interface Candidate {
  kind: ChurchActorKind;
  profileId: string;
  permissions: string[];
}

const isChurchProfile = (p: any): boolean => !!p && (p.category === "church_ministries" || (Array.isArray(p.categories) && p.categories.includes("church_ministries")));

function cookieHint(): string | null {
  try {
    return getActiveOrgCookie();
  } catch {
    return null;
  }
}

async function ownerCandidate(db: ChurchDb, userId: string): Promise<Candidate | null> {
  const { data, error } = await db.from("profiles").select("id, category, categories").eq("user_id", userId).maybeSingle();
  if (error || !data || !isUuid(data.id) || !isChurchProfile(data)) return null;
  return { kind: "owner", profileId: data.id, permissions: [...CHURCH_PERMISSIONS] };
}

async function staffCandidates(db: ChurchDb, userId: string): Promise<Candidate[]> {
  const { data: memberships, error } = await db.from("organization_members").select("profile_id, role_id").eq("user_id", userId).eq("status", "active");
  if (error || !Array.isArray(memberships) || memberships.length === 0) return [];
  const roleIds = Array.from(new Set(memberships.map((m: any) => m.role_id).filter(isUuid)));
  if (roleIds.length === 0) return [];
  const { data: roles, error: rolesError } = await db.from("organization_roles").select("id, profile_id, permissions").in("id", roleIds);
  if (rolesError || !Array.isArray(roles)) return [];
  const out: Candidate[] = [];
  for (const m of memberships) {
    const role = roles.find((r: any) => r.id === m.role_id && r.profile_id === m.profile_id);
    if (!role || !isUuid(m.profile_id) || !Array.isArray(role.permissions)) continue;
    const church = churchPermissionsOf(role.permissions).filter((p) => (CHURCH_PERMISSIONS as readonly string[]).includes(p));
    if (church.length > 0) out.push({ kind: "staff", profileId: m.profile_id, permissions: church });
  }
  return out;
}

async function leaderCandidates(db: ChurchDb, userId: string): Promise<Candidate[]> {
  // their own roster record(s): visible to them through the "own record" policy, and only for an active adult
  const { data, error } = await db.from("church_members").select("profile_id").eq("user_id", userId).eq("status", "active").eq("age_group", "adult");
  if (error || !Array.isArray(data)) return [];
  return Array.from(new Set(data.map((r: any) => r.profile_id).filter(isUuid))).map((profileId) => ({ kind: "leader" as const, profileId, permissions: [] }));
}

async function isPlatformAdmin(db: ChurchDb, userId: string): Promise<boolean> {
  const { data, error } = await db.from("users").select("role").eq("id", userId).maybeSingle();
  return !!error || data?.role === "admin"; // fail closed: if it cannot be read, treat the account as an admin (non-owner access refused)
}

// cache(): the layout and the page both ask in one request; the answer is computed once. (Outside a React server render, e.g. a route handler or a test, cache is absent and each call resolves afresh.)
const once: <T extends () => Promise<ChurchActorResult>>(fn: T) => T = typeof cache === "function" ? (cache as any) : (fn) => fn;

export const resolveChurchActor = once(async (): Promise<ChurchActorResult> => {
  const db = createClient() as unknown as ChurchDb;
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return { ok: false, reason: "not_signed_in" };

  const hint = cookieHint();
  const candidates: Candidate[] = [];
  const owner = await ownerCandidate(db, user.id).catch(() => null);
  if (owner) candidates.push(owner);

  // Staff and leaders: never a platform admin (an admin who owns the church is the owner above).
  if (!(await isPlatformAdmin(db, user.id).catch(() => true))) {
    for (const c of await staffCandidates(db, user.id).catch(() => [])) if (!candidates.some((x) => x.profileId === c.profileId)) candidates.push(c);
    for (const c of await leaderCandidates(db, user.id).catch(() => [])) if (!candidates.some((x) => x.profileId === c.profileId)) candidates.push(c);
  }
  if (candidates.length === 0) return { ok: false, reason: "no_access" };

  // The cookie picks among real memberships; otherwise own church, then staff roles, then leader links.
  const order: ChurchActorKind[] = ["owner", "staff", "leader"];
  const sorted = [...candidates].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  const chosen = (hint && sorted.find((c) => c.profileId === hint)) || sorted[0];

  // A team member only works inside an organization whose plan has Team Management (the same gate the Team screens apply). Fails closed.
  if (chosen.kind === "staff") {
    const enabled = await getOrgTeamEnabled(chosen.profileId).catch(() => false);
    if (!enabled) {
      const fallback = sorted.find((c) => c.kind !== "staff");
      if (!fallback) return { ok: false, reason: "no_access" };
      return finish(db, user.id, fallback);
    }
  }
  return finish(db, user.id, chosen);
});

function finish(db: ChurchDb, userId: string, c: Candidate): ChurchActorResult {
  return { ok: true, actor: { kind: c.kind, userId, profileId: c.profileId, supabase: db, permissions: c.permissions, caps: churchCapabilities(c.permissions) } };
}
