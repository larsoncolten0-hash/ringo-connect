import type { ChurchActor } from "./actor";
import { classifyDbError, failure } from "./errors";
import {
  PAGE_SIZE,
  escapeLike,
  isUuid,
  parseGroup,
  parseGroupListQuery,
  parseGroupMember,
  parseLeadership,
  parseLeadershipListQuery,
  parseMember,
  parseMemberListQuery,
  type GroupInput,
  type LeadershipInput,
} from "./validation";

// Churches & Ministries People & Groups (Phase 2B): every operation behind /api/church/**.
//
// Each handler gets the ACTOR (server-resolved: which church, which permissions, the user's own RLS-bound session) and the request input. The church is always actor.profileId; no
// handler reads a profile id from the request. Every query goes through the user's own session, so row-level security and the guard triggers of the Phase 2A migration are the authority;
// the permission checks written here only produce clear answers earlier ("you cannot do that") and are never the only protection. When the database refuses, the handler returns a short
// code (errors.ts), never the database's own message.
//
// "Nothing changed" is detected, not assumed: a write that row-level security filters away raises no error in Postgres, it just touches zero rows. Every update / delete asks for the
// affected rows back and reports a refusal (403) or a missing record (404) when there are none, so the UI never shows a success the database did not perform.

export interface Result {
  status: number;
  body: Record<string, unknown>;
}

const ok = (body: Record<string, unknown> = {}, status = 200): Result => ({ status, body: { ok: true, ...body } });
const fail = (status: number, code: string, field?: string): Result => failure(status, code, field);
const invalid = (r: { code: string; field?: string }): Result => fail(400, r.code, r.field);
const fromDb = (error: unknown): Result => {
  const o = classifyDbError(error as any);
  // only the status and a short code leave the server; an unexpected failure is logged WITHOUT the message (it can quote a person's data)
  if (o.status >= 500) console.error(JSON.stringify({ scope: "church", result: "db_error", code: String((error as any)?.code || "") }));
  return fail(o.status, o.code);
};

const newId = (): string => globalThis.crypto.randomUUID();
/** Today's date in Africa/Douala (UTC+1, no daylight saving), YYYY-MM-DD. */
export const todayDouala = (now: number = Date.now()): string => new Date(now + 3600_000).toISOString().slice(0, 10);

const MEMBER_LIST_COLS = "id, full_name, status, age_group, preferred_language, guardian_member_id, created_at, updated_at";
const MEMBER_DETAIL_COLS = `${MEMBER_LIST_COLS}, phone, email, removed_at`;
// What a non-staff group LEADER may receive: the same record without phone or email. API-level default only; the Phase 2A row policy still lets such a leader read whole rows directly.
const MEMBER_DETAIL_COLS_NO_CONTACT = `${MEMBER_LIST_COLS}, removed_at`;
const GROUP_COLS = "id, kind, name, description, status, created_at, updated_at";
const GM_COLS = "id, group_id, member_id, role, is_child, created_at";
const LEAD_COLS = "id, member_id, title, started_on, ended_on, created_at, updated_at";

type Db = ChurchActor["supabase"];
const q = (a: ChurchActor, table: string) => (a.supabase as Db).from(table);

/** Someone with nothing to see is refused up front; the database would simply return nothing. A group leader has their own (database-defined) scope. */
const canReadPeople = (a: ChurchActor) => a.kind === "leader" || a.caps.viewMembers || a.caps.viewChildren;

async function readMember(a: ChurchActor, id: string, cols = MEMBER_DETAIL_COLS) {
  const { data, error } = await q(a, "church_members").select(cols).eq("id", id).eq("profile_id", a.profileId).maybeSingle();
  return { row: (data as any) ?? null, error };
}

// =================================================================================================================================================================
// MEMBERS
// =================================================================================================================================================================
export async function listMembers(a: ChurchActor, params: URLSearchParams): Promise<Result> {
  if (!canReadPeople(a)) return fail(403, "forbidden");
  const parsed = parseMemberListQuery(params);
  if (!parsed.ok) return invalid(parsed);
  const f = parsed.value;

  const from = (f.page - 1) * PAGE_SIZE;
  // A group filter is an inner join to the memberships of that ONE group (a single request, no id list in the URL); the join is evaluated under the caller's own row-level security.
  const cols = f.group_id ? `${MEMBER_LIST_COLS}, church_group_members!inner(group_id)` : MEMBER_LIST_COLS;
  let query = q(a, "church_members").select(cols, { count: "exact" }).eq("profile_id", a.profileId);
  if (f.group_id) query = query.eq("church_group_members.group_id", f.group_id);
  if (f.status) query = query.eq("status", f.status);
  if (f.age_group) query = query.eq("age_group", f.age_group);
  if (f.q) {
    const term = escapeLike(f.q);
    if (term) query = query.ilike("full_name", `%${term}%`);
  }
  const { data, error, count } = await query.order("full_name", { ascending: true }).order("id", { ascending: true }).range(from, from + PAGE_SIZE - 1);
  if (error) return fromDb(error);
  const rows = ((data as any[]) || []).map(({ church_group_members: _joined, ...m }) => m);

  // guardian names for the rows that have one (a guardian the caller may not read simply shows no name)
  const guardianIds = Array.from(new Set(rows.map((m) => m.guardian_member_id).filter(isUuid)));
  const names = new Map<string, string>();
  if (guardianIds.length > 0) {
    const { data: gs } = await q(a, "church_members").select("id, full_name").eq("profile_id", a.profileId).in("id", guardianIds);
    for (const g of (gs as any[]) || []) names.set(g.id, g.full_name);
  }
  const total = typeof count === "number" ? count : rows.length;
  return ok({
    members: rows.map((m) => ({ ...m, guardian_name: m.guardian_member_id ? names.get(m.guardian_member_id) ?? null : null })),
    page: f.page,
    pageSize: PAGE_SIZE,
    total,
    hasMore: from + rows.length < total,
  });
}

export async function getMember(a: ChurchActor, id: string): Promise<Result> {
  if (!isUuid(id)) return fail(404, "not_found");
  if (!canReadPeople(a)) return fail(403, "forbidden");
  // A group leader (not staff) gets the person's record without contact details: they are never selected, so they cannot be serialised by accident.
  const contactHidden = a.kind === "leader";
  const { row, error } = await readMember(a, id, contactHidden ? MEMBER_DETAIL_COLS_NO_CONTACT : MEMBER_DETAIL_COLS);
  if (error) return fromDb(error);
  if (!row) return fail(404, "not_found");

  const [gm, lead, guardian, deps] = await Promise.all([
    q(a, "church_group_members").select("id, group_id, role, created_at").eq("member_id", id).eq("profile_id", a.profileId).order("created_at", { ascending: true }),
    q(a, "church_leadership").select(LEAD_COLS).eq("member_id", id).eq("profile_id", a.profileId).order("created_at", { ascending: false }),
    row.guardian_member_id ? readMember(a, row.guardian_member_id, "id, full_name") : Promise.resolve({ row: null, error: null }),
    row.age_group === "child"
      ? Promise.resolve({ data: [], error: null })
      : q(a, "church_members").select("id, full_name, status").eq("guardian_member_id", id).eq("profile_id", a.profileId).order("full_name", { ascending: true }),
  ]);
  const memberships = ((gm.data as any[]) || []) as Array<{ id: string; group_id: string; role: string; created_at: string }>;
  const groupInfo = new Map<string, { name: string; kind: string; status: string }>();
  if (memberships.length > 0) {
    const { data: gs } = await q(a, "church_groups")
      .select("id, name, kind, status")
      .eq("profile_id", a.profileId)
      .in("id", memberships.map((m) => m.group_id));
    for (const g of (gs as any[]) || []) groupInfo.set(g.id, g);
  }
  const isChild = row.age_group === "child";
  return ok({
    member: row,
    ...(contactHidden ? { contact_hidden: true } : {}),
    guardian: guardian.row ? { id: guardian.row.id, full_name: guardian.row.full_name } : null,
    dependents: ((deps.data as any[]) || []).map((d) => ({ id: d.id, full_name: d.full_name, status: d.status })),
    groups: memberships.map((m) => ({
      membership_id: m.id,
      group_id: m.group_id,
      role: m.role,
      name: groupInfo.get(m.group_id)?.name ?? null,
      kind: groupInfo.get(m.group_id)?.kind ?? null,
      status: groupInfo.get(m.group_id)?.status ?? null,
    })),
    leadership: ((lead.data as any[]) || []).map((l) => ({ id: l.id, title: l.title, started_on: l.started_on, ended_on: l.ended_on })),
    // UX hints only; the database decides
    can: {
      edit: a.kind !== "leader" && a.caps.manageMembers && (!isChild || a.caps.manageChildren),
      remove: a.kind !== "leader" && a.caps.manageMembers && (!isChild || a.caps.manageChildren),
      delete: a.kind !== "leader" && a.caps.deleteMembers && (!isChild || a.caps.manageChildren),
    },
  });
}

/** Cross-field rules of a person's final record (what the database also enforces): a child has a guardian and no contact details, an adult has no guardian. */
function memberRulesProblem(final: { age_group: string; guardian_member_id: string | null; phone: string | null; email: string | null }, id: string | null): Result | null {
  if (final.age_group === "child") {
    if (!final.guardian_member_id) return fail(422, "child_needs_guardian", "guardian_member_id");
    if (final.phone || final.email) return fail(422, "child_contact_not_allowed");
  }
  if (final.age_group === "adult" && final.guardian_member_id) return fail(422, "adult_no_guardian", "guardian_member_id");
  if (id && final.guardian_member_id === id) return fail(422, "invalid_guardian", "guardian_member_id");
  return null;
}

export async function createMember(a: ChurchActor, body: unknown): Promise<Result> {
  if (a.kind === "leader" || !a.caps.manageMembers) return fail(403, "forbidden");
  const parsed = parseMember(body, "create");
  if (!parsed.ok) return invalid(parsed);
  const v = parsed.value;
  const final = { age_group: v.age_group ?? "adult", guardian_member_id: v.guardian_member_id ?? null, phone: v.phone ?? null, email: v.email ?? null };
  if (final.age_group === "child" && !a.caps.manageChildren) return fail(403, "children_restricted");
  const problem = memberRulesProblem(final, null);
  if (problem) return problem;
  if (final.guardian_member_id) {
    // the guardian must be a person of THIS church that the caller can see; the database also requires an adult
    const g = await readMember(a, final.guardian_member_id, "id, age_group");
    if (g.error) return fromDb(g.error);
    if (!g.row) return fail(422, "invalid_guardian", "guardian_member_id");
  }
  const id = newId();
  const row = {
    id,
    profile_id: a.profileId,
    created_by: a.userId,
    source: "manual",
    full_name: v.full_name,
    phone: final.phone,
    email: final.email,
    preferred_language: v.preferred_language ?? null,
    status: v.status ?? "active",
    age_group: final.age_group,
    guardian_member_id: final.guardian_member_id,
  };
  const { error } = await q(a, "church_members").insert(row);
  if (error) return fromDb(error);
  const { row: created } = await readMember(a, id, MEMBER_LIST_COLS);
  return ok({ id, member: created }, 201);
}

export async function updateMember(a: ChurchActor, id: string, body: unknown): Promise<Result> {
  if (!isUuid(id)) return fail(404, "not_found");
  if (a.kind === "leader" || !a.caps.manageMembers) return fail(403, "forbidden");
  const parsed = parseMember(body, "update");
  if (!parsed.ok) return invalid(parsed);
  const v = parsed.value;

  const cur = await readMember(a, id);
  if (cur.error) return fromDb(cur.error);
  if (!cur.row) return fail(404, "not_found");
  const wasChild = cur.row.age_group === "child";
  const final = {
    age_group: v.age_group ?? cur.row.age_group,
    // becoming an adult drops the guardian link (an adult cannot have one); otherwise the link stays unless the caller changed it
    guardian_member_id: v.guardian_member_id !== undefined ? v.guardian_member_id : v.age_group === "adult" ? null : cur.row.guardian_member_id,
    phone: v.phone !== undefined ? v.phone : cur.row.phone,
    email: v.email !== undefined ? v.email : cur.row.email,
  };
  // any change to a child, or to or from the child classification, is a children.manage act
  if ((wasChild || final.age_group === "child") && !a.caps.manageChildren) return fail(403, "children_restricted");
  const problem = memberRulesProblem(final, id);
  if (problem) return problem;
  if (final.guardian_member_id && final.guardian_member_id !== cur.row.guardian_member_id) {
    const g = await readMember(a, final.guardian_member_id, "id, age_group");
    if (g.error) return fromDb(g.error);
    if (!g.row) return fail(422, "invalid_guardian", "guardian_member_id");
  }

  const patch: Record<string, unknown> = { ...v };
  if (v.age_group !== undefined || v.guardian_member_id !== undefined) patch.guardian_member_id = final.guardian_member_id;
  const { data, error } = await q(a, "church_members").update(patch).eq("id", id).eq("profile_id", a.profileId).select("id");
  if (error) return fromDb(error);
  // zero rows with no error = row-level security filtered the write away (the row IS visible: it was just read)
  if (!Array.isArray(data) || data.length === 0) return fail(403, wasChild ? "children_restricted" : "forbidden");
  const { row } = await readMember(a, id);
  return ok({ member: row });
}

export async function deleteMember(a: ChurchActor, id: string): Promise<Result> {
  if (!isUuid(id)) return fail(404, "not_found");
  if (a.kind === "leader" || !a.caps.deleteMembers) return fail(403, "forbidden");
  const cur = await readMember(a, id, "id, age_group");
  if (cur.error) return fromDb(cur.error);
  if (!cur.row) return fail(404, "not_found");
  if (cur.row.age_group === "child" && !a.caps.manageChildren) return fail(403, "children_restricted");
  const { data, error } = await q(a, "church_members").delete().eq("id", id).eq("profile_id", a.profileId).select("id");
  if (error) return fromDb(error);
  if (!Array.isArray(data) || data.length === 0) return fail(403, "forbidden");
  return ok({ id });
}

// =================================================================================================================================================================
// GROUPS
// =================================================================================================================================================================
const canReadGroups = (a: ChurchActor) => a.kind === "leader" || a.caps.viewGroups;

export async function listGroups(a: ChurchActor, params: URLSearchParams): Promise<Result> {
  if (!canReadGroups(a)) return fail(403, "forbidden");
  const parsed = parseGroupListQuery(params);
  if (!parsed.ok) return invalid(parsed);
  let query = q(a, "church_groups").select(GROUP_COLS).eq("profile_id", a.profileId);
  if (parsed.value.status) query = query.eq("status", parsed.value.status);
  if (parsed.value.kind) query = query.eq("kind", parsed.value.kind);
  const { data, error } = await query.order("name", { ascending: true }).limit(500);
  if (error) return fromDb(error);
  const groups = (data as any[]) || [];

  // member counts from the rows the caller may see (a child's membership row is only visible to those who may see children, so a count never reveals a child to anyone else)
  const counts = new Map<string, number>();
  for (let i = 0; i < groups.length; i += 100) {
    const { data: gms } = await q(a, "church_group_members")
      .select("group_id")
      .eq("profile_id", a.profileId)
      .in("group_id", groups.slice(i, i + 100).map((g) => g.id))
      .limit(10000);
    for (const r of (gms as any[]) || []) counts.set(r.group_id, (counts.get(r.group_id) ?? 0) + 1);
  }
  return ok({ groups: groups.map((g) => ({ ...g, member_count: counts.get(g.id) ?? 0 })) });
}

export async function getGroup(a: ChurchActor, id: string): Promise<Result> {
  if (!isUuid(id)) return fail(404, "not_found");
  if (!canReadGroups(a)) return fail(403, "forbidden");
  const { data: group, error } = await q(a, "church_groups").select(GROUP_COLS).eq("id", id).eq("profile_id", a.profileId).maybeSingle();
  if (error) return fromDb(error);
  if (!group) return fail(404, "not_found");
  const { data: gms, error: gmError } = await q(a, "church_group_members").select(GM_COLS).eq("group_id", id).eq("profile_id", a.profileId).order("created_at", { ascending: true }).limit(2000);
  if (gmError) return fromDb(gmError);
  const rows = ((gms as any[]) || []) as Array<{ id: string; member_id: string; role: string; is_child: boolean; created_at: string }>;
  const people = new Map<string, any>();
  // chunked: a large group must not produce an over-long URL
  for (let i = 0; i < rows.length; i += 100) {
    const { data: ms } = await q(a, "church_members")
      .select("id, full_name, status, age_group")
      .eq("profile_id", a.profileId)
      .in("id", rows.slice(i, i + 100).map((r) => r.member_id));
    for (const m of (ms as any[]) || []) people.set(m.id, m);
  }
  const rank: Record<string, number> = { leader: 0, assistant: 1, member: 2, volunteer: 3, worker: 4 };
  const members = rows
    .map((r) => {
      const p = people.get(r.member_id) ?? null;
      return { membership_id: r.id, member_id: r.member_id, role: r.role, name: p?.full_name ?? null, status: p?.status ?? null, age_group: p?.age_group ?? (r.is_child ? "child" : null) };
    })
    .sort((x, y) => (rank[x.role] ?? 9) - (rank[y.role] ?? 9) || String(x.name ?? "").localeCompare(String(y.name ?? "")));
  return ok({
    group,
    members,
    viewer: { kind: a.kind, canManageGroup: a.kind !== "leader" && a.caps.manageGroups, canManageMembers: a.kind !== "leader" && a.caps.manageGroups, canLeaderEdit: a.kind === "leader" },
  });
}

export async function createGroup(a: ChurchActor, body: unknown): Promise<Result> {
  if (a.kind === "leader" || !a.caps.manageGroups) return fail(403, "forbidden");
  const parsed = parseGroup(body, "create");
  if (!parsed.ok) return invalid(parsed);
  const id = newId();
  const { error } = await q(a, "church_groups").insert({ id, profile_id: a.profileId, created_by: a.userId, status: "active", ...parsed.value });
  if (error) return fromDb(error);
  const { data } = await q(a, "church_groups").select(GROUP_COLS).eq("id", id).eq("profile_id", a.profileId).maybeSingle();
  return ok({ id, group: data ?? null }, 201);
}

export async function updateGroup(a: ChurchActor, id: string, body: unknown): Promise<Result> {
  if (!isUuid(id)) return fail(404, "not_found");
  if (a.kind === "leader" || !a.caps.manageGroups) return fail(403, "forbidden");
  const parsed = parseGroup(body, "update");
  if (!parsed.ok) return invalid(parsed);
  const { data, error } = await q(a, "church_groups").update(parsed.value as GroupInput).eq("id", id).eq("profile_id", a.profileId).select(GROUP_COLS);
  if (error) return fromDb(error);
  if (!Array.isArray(data) || data.length === 0) return fail(404, "not_found");
  return ok({ group: data[0] });
}

export async function deleteGroup(a: ChurchActor, id: string): Promise<Result> {
  if (!isUuid(id)) return fail(404, "not_found");
  if (a.kind === "leader" || !a.caps.manageGroups) return fail(403, "forbidden");
  // a group that holds a child can only be deleted with children.manage: the database refuses it (church_group_has_children); nothing is pre-checked here that could disagree with it
  const { data, error } = await q(a, "church_groups").delete().eq("id", id).eq("profile_id", a.profileId).select("id");
  if (error) return fromDb(error);
  if (!Array.isArray(data) || data.length === 0) return fail(404, "not_found");
  return ok({ id });
}

// ---- group membership -------------------------------------------------------------------------------------------------------------------------------------------
export async function addGroupMember(a: ChurchActor, groupId: string, body: unknown): Promise<Result> {
  if (!isUuid(groupId)) return fail(404, "not_found");
  if (a.kind === "leader" || !a.caps.manageGroups) return fail(403, "forbidden");
  const parsed = parseGroupMember(body, "create");
  if (!parsed.ok) return invalid(parsed);
  const v = parsed.value as { member_id: string; role: string };

  const { data: group, error: gError } = await q(a, "church_groups").select("id, status").eq("id", groupId).eq("profile_id", a.profileId).maybeSingle();
  if (gError) return fromDb(gError);
  if (!group) return fail(404, "not_found");
  if (group.status !== "active") return fail(422, "group_archived");
  const person = await readMember(a, v.member_id, "id, status, age_group");
  if (person.error) return fromDb(person.error);
  if (!person.row) return fail(422, "invalid_member", "member_id");
  if (person.row.age_group === "child" && !a.caps.manageChildren) return fail(403, "children_restricted");
  if ((v.role === "leader" || v.role === "assistant") && person.row.age_group !== "adult") return fail(422, "role_requires_adult", "role");

  const id = newId();
  const { error } = await q(a, "church_group_members").insert({ id, profile_id: a.profileId, group_id: groupId, member_id: v.member_id, role: v.role, created_by: a.userId });
  if (error) return fromDb(error);
  return ok({ id }, 201);
}

async function readMembership(a: ChurchActor, groupId: string, membershipId: string) {
  const { data, error } = await q(a, "church_group_members").select(GM_COLS).eq("id", membershipId).eq("group_id", groupId).eq("profile_id", a.profileId).maybeSingle();
  return { row: (data as any) ?? null, error };
}

export async function updateGroupMember(a: ChurchActor, groupId: string, membershipId: string, body: unknown): Promise<Result> {
  if (!isUuid(groupId) || !isUuid(membershipId)) return fail(404, "not_found");
  const parsed = parseGroupMember(body, "update");
  if (!parsed.ok) return invalid(parsed);
  const role = (parsed.value as { role: string }).role;
  const cur = await readMembership(a, groupId, membershipId);
  if (cur.error) return fromDb(cur.error);
  if (!cur.row) return fail(404, "not_found");
  // a group LEADER may re-label plain members (member / volunteer / worker) only; promoting to or demoting from a leading role is the church's administrators' act
  if (a.kind === "leader" && (["leader", "assistant"].includes(role) || ["leader", "assistant"].includes(cur.row.role))) return fail(403, "forbidden");
  if (a.kind !== "leader" && !a.caps.manageGroups) return fail(403, "forbidden");
  if (cur.row.is_child && a.kind !== "leader" && !a.caps.manageChildren) return fail(403, "children_restricted");
  const { data, error } = await q(a, "church_group_members").update({ role }).eq("id", membershipId).eq("group_id", groupId).eq("profile_id", a.profileId).select("id");
  if (error) return fromDb(error);
  if (!Array.isArray(data) || data.length === 0) return fail(403, "forbidden");
  return ok({ id: membershipId });
}

export async function removeGroupMember(a: ChurchActor, groupId: string, membershipId: string): Promise<Result> {
  if (!isUuid(groupId) || !isUuid(membershipId)) return fail(404, "not_found");
  const cur = await readMembership(a, groupId, membershipId);
  if (cur.error) return fromDb(cur.error);
  if (!cur.row) return fail(404, "not_found");
  if (a.kind === "leader" && ["leader", "assistant"].includes(cur.row.role)) return fail(403, "forbidden");
  if (a.kind !== "leader" && !a.caps.manageGroups) return fail(403, "forbidden");
  if (cur.row.is_child && a.kind !== "leader" && !a.caps.manageChildren) return fail(403, "children_restricted");
  const { data, error } = await q(a, "church_group_members").delete().eq("id", membershipId).eq("group_id", groupId).eq("profile_id", a.profileId).select("id");
  if (error) return fromDb(error);
  if (!Array.isArray(data) || data.length === 0) return fail(403, "forbidden");
  return ok({ id: membershipId });
}

// =================================================================================================================================================================
// LEADERSHIP
// =================================================================================================================================================================
export async function listLeadership(a: ChurchActor, params: URLSearchParams): Promise<Result> {
  if (a.kind !== "leader" && !a.caps.viewLeadership) return fail(403, "forbidden");
  const parsed = parseLeadershipListQuery(params);
  if (!parsed.ok) return invalid(parsed);
  const { current, member_id } = parsed.value;
  let query = q(a, "church_leadership").select(LEAD_COLS).eq("profile_id", a.profileId);
  if (member_id) query = query.eq("member_id", member_id);
  const today = todayDouala();
  // current = no end date, or an end date still ahead (Africa/Douala calendar day); history = an end date of today or earlier. Ending an appointment "today" therefore moves it to History at once.
  if (current === true) query = query.or(`ended_on.is.null,ended_on.gt.${today}`);
  if (current === false) query = query.lte("ended_on", today);
  const { data, error } = await query.order("started_on", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).limit(1000);
  if (error) return fromDb(error);
  const rows = (data as any[]) || [];
  const people = new Map<string, any>();
  const ids = Array.from(new Set(rows.map((r) => r.member_id)));
  for (let i = 0; i < ids.length; i += 100) {
    const { data: ms } = await q(a, "church_members").select("id, full_name, status").eq("profile_id", a.profileId).in("id", ids.slice(i, i + 100));
    for (const m of (ms as any[]) || []) people.set(m.id, m);
  }
  return ok({
    today,
    appointments: rows.map((r) => ({
      ...r,
      name: people.get(r.member_id)?.full_name ?? null,
      member_status: people.get(r.member_id)?.status ?? null,
      is_current: r.ended_on === null || r.ended_on > today,
    })),
  });
}

export async function createLeadership(a: ChurchActor, body: unknown): Promise<Result> {
  if (a.kind === "leader" || !a.caps.manageLeadership) return fail(403, "forbidden");
  const parsed = parseLeadership(body, "create");
  if (!parsed.ok) return invalid(parsed);
  const v = parsed.value as Required<Pick<LeadershipInput, "member_id" | "title">> & LeadershipInput;
  const person = await readMember(a, v.member_id, "id, status, age_group");
  if (person.error) return fromDb(person.error);
  if (!person.row) return fail(422, "invalid_member", "member_id");
  if (person.row.age_group !== "adult") return fail(422, "role_requires_adult", "member_id");
  const id = newId();
  const { error } = await q(a, "church_leadership").insert({
    id,
    profile_id: a.profileId,
    created_by: a.userId,
    member_id: v.member_id,
    title: v.title,
    started_on: v.started_on ?? null,
    ended_on: v.ended_on ?? null,
  });
  if (error) return fromDb(error);
  return ok({ id }, 201);
}

export async function updateLeadership(a: ChurchActor, id: string, body: unknown): Promise<Result> {
  if (!isUuid(id)) return fail(404, "not_found");
  if (a.kind === "leader" || !a.caps.manageLeadership) return fail(403, "forbidden");
  const parsed = parseLeadership(body, "update");
  if (!parsed.ok) return invalid(parsed);
  const v = parsed.value;
  const { data: cur, error: cError } = await q(a, "church_leadership").select(LEAD_COLS).eq("id", id).eq("profile_id", a.profileId).maybeSingle();
  if (cError) return fromDb(cError);
  if (!cur) return fail(404, "not_found");
  const started = v.started_on !== undefined ? v.started_on : cur.started_on;
  const ended = v.ended_on !== undefined ? v.ended_on : cur.ended_on;
  if (started && ended && ended < started) return fail(422, "invalid_date_range", "ended_on");
  const { data, error } = await q(a, "church_leadership").update(v).eq("id", id).eq("profile_id", a.profileId).select(LEAD_COLS);
  if (error) return fromDb(error);
  if (!Array.isArray(data) || data.length === 0) return fail(403, "forbidden");
  return ok({ appointment: data[0] });
}
