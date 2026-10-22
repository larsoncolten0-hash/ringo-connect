// Churches & Ministries Phase 2B + 2C: People & Groups dashboard back end, validated end to end and OFFLINE.
// The REAL route files (src/app/api/church/**), the REAL handlers, validation, error mapping and actor resolution run against scratch in-memory PostgreSQL (PGlite) that holds the REAL Team
// migrations and the REAL Phase 2A church migration. Every request is made as a chosen signed-in user (auth.uid() = that user, role `authenticated`), or as an anonymous visitor, so row-level
// security and the guard triggers decide exactly as they would for that user. Only two things are stubbed: the session client factory (to hand the route a database-backed client for the
// chosen user; the service-role factory THROWS, so any use of it fails a test) and the two Team helpers that read the active-organization cookie and the plan flag.
// All data is synthetic. No Supabase, no network, no production data, no SQL against any real database.
//   Run:  node scripts/tests/churchPeopleGroupsApi.test.mjs
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import * as F from "./churchFixtures.mjs";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");
const { u, prof, m, g, gm, ld, role } = F;

let pass = 0, fail = 0, section = "";
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", `${section}${name}`, "|", String(detail).slice(0, 400)); } };
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8").replace(/\r\n/g, "\n");
const realConsoleError = console.error;
console.error = () => {}; // the handlers log (without personal data) when the database fails unexpectedly

// ---- stubs + loader --------------------------------------------------------------------------------------------------------------------------------------------------
const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "church_stubs_"));
const serverStub = path.join(stubDir, "server.cjs");
const accessStub = path.join(stubDir, "teamaccess.cjs");
fs.writeFileSync(serverStub, `module.exports = { createClient: () => globalThis.__churchSession, createAdminClient: () => { globalThis.__adminClientCalls = (globalThis.__adminClientCalls || 0) + 1; throw new Error("the service-role client must not be used by the church routes"); } };`);
fs.writeFileSync(accessStub, `module.exports = { getActiveOrgCookie: () => globalThis.__orgCookie || null, getOrgTeamEnabled: async (id) => globalThis.__teamEnabled(id) };`);
const jiti = require("jiti")(import.meta.url, { alias: { "@/lib/supabase/server": serverStub, "@/lib/team/access": accessStub, "@": SRC }, interopDefault: true, cache: false });
const routeFile = (rel) => path.join(SRC, "app/api/church", rel, "route.ts");
const PERM = jiti(path.join(SRC, "lib/church/permissions.ts"));
const VAL = jiti(path.join(SRC, "lib/church/validation.ts"));
const ERR = jiti(path.join(SRC, "lib/church/errors.ts"));
const HND = jiti(path.join(SRC, "lib/church/handlers.ts"));
const TEAMPERM = jiti(path.join(SRC, "lib/team/permissions.ts"));

let db;
async function fresh() {
  db = new PGlite();
  const d = await F.newDb(PGlite);
  db = d;
  await F.seed(db);
  globalThis.__teamEnabled = async (profileId) => {
    const rows = await F.svcQuery(db, `select pl.team_enabled from public.profiles p join public.users us on us.id = p.user_id left join public.plans pl on pl.id = us.plan_id where p.id = '${profileId}'`);
    return !!rows[0]?.team_enabled;
  };
  globalThis.__orgCookie = null;
  globalThis.__adminClientCalls = 0;
}

/** One request as `user` (null = anonymous) against the real route file `rel` (e.g. "members/[id]"). */
async function call(user, method, rel, { url = "", body, headers, raw, params = {} } = {}) {
  globalThis.__churchSession = F.sessionFor(db, user);
  const mod = jiti(routeFile(rel));
  const h = { ...(method !== "GET" && method !== "DELETE" ? { "content-type": "application/json" } : {}), ...(headers || {}) };
  const init = { method, headers: h };
  if (raw !== undefined) init.body = raw;
  else if (body !== undefined) init.body = JSON.stringify(body);
  const res = await mod[method](new Request(`http://test.local/api/church/${rel}${url}`, init), { params });
  let json = null;
  try { json = await res.json(); } catch { /* none */ }
  return { status: res.status, body: json, headers: res.headers };
}
const A = (n) => F.id("1", n); // fresh uuids for new rows
const is = (name, r, status, code) => check(name, r.status === status && (code === undefined || r.body?.error === code || (code === "ok" && r.body?.ok === true)), `${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
const rows = async (sql) => F.svcQuery(db, sql);
const count = async (table, where = "true") => (await rows(`select count(*)::int as n from public.${table} where ${where}`))[0].n;
const unchanged = async (name, before) => { const after = await F.snapshot(db); eq(name, after, before); };

// =================================================================================================================================================================
section = "A. pure modules: ";
// =================================================================================================================================================================
{
  // validation
  const body = (o) => VAL.parseMember(o, "create");
  check("member: minimal valid", body({ full_name: "  Ada   Obi " }).ok && body({ full_name: "  Ada   Obi " }).value.full_name === "Ada Obi");
  check("member: name required", !body({}).ok && body({}).code === "invalid_full_name");
  check("member: empty name refused", !body({ full_name: "   " }).ok);
  check("member: 121-char name refused", !body({ full_name: "x".repeat(121) }).ok);
  check("member: control characters refused", !body({ full_name: "Ada\u0007" }).ok);
  for (const f of ["profile_id", "user_id", "customer_id", "source", "is_child", "created_by", "removed_at", "id", "__proto__x"]) {
    const r = body({ full_name: "Ada", [f]: "x" });
    check(`member: unexpected field ${f} refused`, !r.ok && r.code === "unexpected_field" && r.field === f);
  }
  check("member: array body refused", !body([]).ok && !body(null).ok && !body("x").ok);
  check("member: status enum", !body({ full_name: "A", status: "banned" }).ok && body({ full_name: "A", status: "pending" }).ok);
  check("member: age_group enum", !body({ full_name: "A", age_group: "teen" }).ok);
  check("member: language enum", !body({ full_name: "A", preferred_language: "de" }).ok && body({ full_name: "A", preferred_language: null }).ok);
  check("member: email lower-cased", body({ full_name: "A", email: " Ada@Example.COM " }).value.email === "ada@example.com");
  check("member: bad email refused", !body({ full_name: "A", email: "nope" }).ok && !body({ full_name: "A", email: "a@b" }).ok);
  check("member: phone accepted / refused", body({ full_name: "A", phone: "+237 670 00 00 01" }).ok && !body({ full_name: "A", phone: "abc" }).ok && !body({ full_name: "A", phone: "12" }).ok);
  check("member: empty phone becomes null", body({ full_name: "A", phone: "  " }).value.phone === null);
  check("member: guardian must be a uuid", !body({ full_name: "A", guardian_member_id: "nope" }).ok && body({ full_name: "A", guardian_member_id: null }).ok);
  check("member: update needs at least one field", !VAL.parseMember({}, "update").ok && VAL.parseMember({}, "update").code === "empty_update");
  // dates
  for (const bad of ["2026-02-31", "2026-13-01", "2026-1-1", "tomorrow", "2026-01-01T00:00:00Z", "0999-01-01", "2101-01-01", 20260101, "2026-00-10"]) check(`date refused: ${bad}`, !VAL.parseDate(bad, "d").ok);
  check("date ok: leap day", VAL.parseDate("2028-02-29", "d").ok && !VAL.parseDate("2027-02-29", "d").ok);
  check("date: empty = none", VAL.parseDate("", "d").value === null && VAL.parseDate(null, "d").value === null);
  // leadership / groups
  check("leadership: reversed range refused", VAL.parseLeadership({ member_id: m.admin, title: "T", started_on: "2026-05-01", ended_on: "2026-04-01" }, "create").code === "invalid_date_range");
  check("leadership: member fixed on update", VAL.parseLeadership({ member_id: m.admin }, "update").code === "unexpected_field");
  check("leadership: title length", !VAL.parseLeadership({ member_id: m.admin, title: "x".repeat(81) }, "create").ok);
  check("group: kind only on create", VAL.parseGroup({ kind: "group", name: "N" }, "create").ok && VAL.parseGroup({ kind: "group" }, "update").code === "unexpected_field");
  check("group: bad kind / status refused", !VAL.parseGroup({ kind: "club", name: "N" }, "create").ok && !VAL.parseGroup({ status: "deleted" }, "update").ok);
  check("group: description cap", !VAL.parseGroup({ kind: "group", name: "N", description: "x".repeat(501) }, "create").ok);
  check("group member: role enum, default member", !VAL.parseGroupMember({ member_id: m.admin, role: "boss" }, "create").ok && VAL.parseGroupMember({ member_id: m.admin }, "create").value.role === "member");
  check("group member: update only role", VAL.parseGroupMember({ member_id: m.admin, role: "member" }, "update").code === "unexpected_field");
  // list queries
  const lq = (s) => VAL.parseMemberListQuery(new URLSearchParams(s));
  check("list: defaults", lq("").ok && lq("").value.page === 1);
  check("list: profileId param refused", lq("profileId=" + prof.c1).code === "unexpected_field" && lq("profile_id=x").code === "unexpected_field");
  check("list: bad page / status / age / group refused", !lq("page=0").ok && !lq("page=abc").ok && !lq("page=99999").ok && !lq("status=x").ok && !lq("age_group=x").ok && !lq("group_id=x").ok);
  check("list: search too long refused", !lq("q=" + "x".repeat(81)).ok);
  check("escapeLike neutralises wildcards and filter syntax", VAL.escapeLike("50%_a,b(c)*\"") === "50\\%\\_a b c");
  // permissions
  eq("capabilities: manage alone does not open reading members", PERM.churchCapabilities(["church.members.manage"]).viewMembers, false);
  eq("capabilities: children.manage alone does not open reading children", PERM.churchCapabilities(["church.children.manage"]).viewChildren, false);
  eq("capabilities: groups.manage implies group reading", PERM.churchCapabilities(["church.groups.manage"]).viewGroups, true);
  check("catalogue: church permissions are in the Team catalogue", PERM.CHURCH_PERMISSIONS.every((p) => TEAMPERM.PERMISSIONS.includes(p)));
  check("catalogue: church.export is NOT offered in this phase", !TEAMPERM.PERMISSIONS.includes("church.export"));
  check("catalogue: sensitive naming", PERM.isSensitiveChurchPermissionName("Church.Children.View") && PERM.isSensitiveChurchPermissionName(" church.export ") && !PERM.isSensitiveChurchPermissionName("church.members.view"));
  check("catalogue: the church group exists", TEAMPERM.PERMISSION_GROUPS.some((x) => x.labelKey === "church"));
  // errors never echo database text
  const c1 = ERR.classifyDbError({ code: "42501", message: 'new row violates row-level security policy for table "church_members"' });
  check("errors: RLS refusal is a bare 403 code", c1.status === 403 && c1.code === "forbidden" && !JSON.stringify(c1).includes("church_members"));
  check("errors: guard names map to public codes", ERR.classifyDbError({ code: "23514", message: "church_guardian_must_be_adult" }).code === "guardian_must_be_adult" && ERR.classifyDbError({ code: "42501", message: "church_group_has_children" }).code === "group_has_children");
  check("errors: unknown failure is a 500 server_error", ERR.classifyDbError({ code: "XX000", message: "Ada Obi 670000001" }).code === "server_error");
  check("todayDouala is UTC+1", HND.todayDouala(Date.parse("2026-10-22T23:30:00Z")) === "2026-10-23" && HND.todayDouala(Date.parse("2026-10-22T22:59:00Z")) === "2026-10-22");
}

// =================================================================================================================================================================
section = "B. owner (scenario 1): ";
// =================================================================================================================================================================
await fresh();
{
  const O = u.owner1;
  let r = await call(O, "GET", "members");
  is("list members", r, 200, "ok");
  eq("owner sees all 9 people of their church, no other church", r.body.members.map((x) => x.id).sort(), [m.admin, m.leader, m.vol, m.other, m.guardian, m.kid1, m.kid2, m.pending, m.youth].sort());
  check("list rows carry no phone / email", r.body.members.every((x) => !("phone" in x) && !("email" in x)));
  check("list child row carries the guardian name", r.body.members.find((x) => x.id === m.kid1).guardian_name === "Gaby Guardian");
  check("no-store", r.headers.get("cache-control") === "no-store");

  r = await call(O, "GET", "members/[id]", { params: { id: m.admin } });
  is("detail", r, 200, "ok");
  check("detail carries contact details", r.body.member.phone === "+237670000001" && r.body.member.email === "grace@example.test");
  eq("detail: leadership", r.body.leadership.map((x) => x.title), ["Senior Pastor"]);
  r = await call(O, "GET", "members/[id]", { params: { id: m.leader } });
  eq("detail: group memberships", r.body.groups.map((x) => [x.name, x.role]), [["Choir", "leader"]]);
  r = await call(O, "GET", "members/[id]", { params: { id: m.guardian } });
  eq("detail: a guardian lists their dependents", r.body.dependents.map((x) => x.full_name), ["Kiki Child", "Koko Child"]);
  r = await call(O, "GET", "members/[id]", { params: { id: m.kid1 } });
  check("detail: a child record has no contact details and names the guardian", r.body.member.phone === null && r.body.member.email === null && r.body.guardian.full_name === "Gaby Guardian");

  // create / edit / status / remove / delete
  r = await call(O, "POST", "members", { body: { full_name: "  New   Person ", phone: "+237 691 00 00 00", email: "New@Example.test", preferred_language: "fr", status: "pending" } });
  is("create adult", r, 201, "ok");
  const newId = r.body.id;
  const row = (await rows(`select * from public.church_members where id = '${newId}'`))[0];
  check("create: server-set fields (church, source, creator)", row.profile_id === prof.c1 && row.source === "manual" && row.created_by === O && row.full_name === "New Person" && row.email === "new@example.test" && row.status === "pending");
  r = await call(O, "PATCH", "members/[id]", { params: { id: newId }, body: { status: "active", preferred_language: "en" } });
  is("edit: pending -> active", r, 200, "ok");
  r = await call(O, "PATCH", "members/[id]", { params: { id: newId }, body: { status: "inactive" } });
  is("edit: -> inactive", r, 200, "ok");
  r = await call(O, "PATCH", "members/[id]", { params: { id: newId }, body: { status: "removed" } });
  is("remove (soft)", r, 200, "ok");
  const removed = (await rows(`select status, removed_at from public.church_members where id = '${newId}'`))[0];
  check("soft removal keeps the record and stamps removed_at", removed.status === "removed" && removed.removed_at !== null);
  r = await call(O, "GET", "members", { url: "?status=removed" });
  eq("status filter finds the removed record", r.body.members.map((x) => x.id), [newId]);
  r = await call(O, "PATCH", "members/[id]", { params: { id: newId }, body: { status: "active" } });
  is("restore", r, 200, "ok");
  check("restore clears removed_at", (await rows(`select removed_at from public.church_members where id = '${newId}'`))[0].removed_at === null);
  r = await call(O, "DELETE", "members/[id]", { params: { id: newId } });
  is("hard delete by the owner", r, 200, "ok");
  eq("deleted for real", await count("church_members", `id = '${newId}'`), 0);

  // search / filters / pagination
  r = await call(O, "GET", "members", { url: "?q=olivier" });
  eq("search by name (case-insensitive)", r.body.members.map((x) => x.id), [m.other]);
  r = await call(O, "GET", "members", { url: "?q=" + encodeURIComponent("%") });
  eq("a % in the search matches nothing (no wildcard injection)", r.body.members.length, 0);
  r = await call(O, "GET", "members", { url: "?q=" + encodeURIComponent("a,b) or (x") });
  is("filter-syntax characters in the search do not break or widen the query", r, 200, "ok");
  r = await call(O, "GET", "members", { url: "?age_group=child" });
  eq("age-group filter", r.body.members.map((x) => x.id).sort(), [m.kid1, m.kid2].sort());
  r = await call(O, "GET", "members", { url: "?group_id=" + g.choir });
  eq("group filter", r.body.members.map((x) => x.id).sort(), [m.leader, m.vol, m.other].sort());
  r = await call(O, "GET", "members", { url: "?group_id=" + g.c2grp });
  eq("group filter with another church's group id finds nothing", r.body.members.length, 0);
  let ins = ""; for (let i = 0; i < 30; i++) ins += `insert into public.church_members (profile_id, full_name) values ('${prof.c1}', 'Bulk Person ${String(i).padStart(2, "0")}');`;
  await F.svc(db, ins);
  r = await call(O, "GET", "members", { url: "?q=bulk" });
  check("pagination: first page is 25 of 30", r.body.members.length === 25 && r.body.total === 30 && r.body.hasMore === true && r.body.page === 1);
  r = await call(O, "GET", "members", { url: "?q=bulk&page=2" });
  check("pagination: second page is the remaining 5", r.body.members.length === 5 && r.body.hasMore === false);
  r = await call(O, "GET", "members", { url: "?q=bulk&page=3" });
  check("pagination: beyond the end is empty, not an error", r.status === 200 && r.body.members.length === 0);
  await F.svc(db, `delete from public.church_members where full_name like 'Bulk Person%'`);

  // children
  r = await call(O, "POST", "members", { body: { full_name: "Little One", age_group: "child", guardian_member_id: m.guardian } });
  is("create child with guardian", r, 201, "ok");
  const childId = r.body.id;
  r = await call(O, "POST", "members", { body: { full_name: "No Guardian", age_group: "child" } });
  is("child without guardian refused", r, 422, "child_needs_guardian");
  r = await call(O, "POST", "members", { body: { full_name: "With Phone", age_group: "child", guardian_member_id: m.guardian, phone: "+237670000009" } });
  is("child with a phone refused", r, 422, "child_contact_not_allowed");
  r = await call(O, "POST", "members", { body: { full_name: "With Mail", age_group: "child", guardian_member_id: m.guardian, email: "k@example.test" } });
  is("child with an email refused", r, 422, "child_contact_not_allowed");
  r = await call(O, "POST", "members", { body: { full_name: "Youth Guardian", age_group: "child", guardian_member_id: m.youth } });
  is("a youth cannot be a guardian (database rule)", r, 422, "guardian_must_be_adult");
  r = await call(O, "POST", "members", { body: { full_name: "Other Church Guardian", age_group: "child", guardian_member_id: m.c2a } });
  is("a guardian from another church is refused", r, 422, "invalid_guardian");
  r = await call(O, "POST", "members", { body: { full_name: "Adult With Guardian", age_group: "adult", guardian_member_id: m.guardian } });
  is("an adult cannot have a guardian", r, 422, "adult_no_guardian");
  r = await call(O, "PATCH", "members/[id]", { params: { id: m.guardian }, body: { age_group: "youth" } });
  is("a guardian cannot stop being an adult", r, 409, "guardian_has_dependents");
  r = await call(O, "DELETE", "members/[id]", { params: { id: m.guardian } });
  is("a guardian with dependents cannot be hard-deleted", r, 409, "guardian_in_use");
  r = await call(O, "PATCH", "members/[id]", { params: { id: childId }, body: { age_group: "adult" } });
  is("child -> adult drops the guardian link automatically", r, 200, "ok");
  eq("...and it did", (await rows(`select age_group, guardian_member_id from public.church_members where id = '${childId}'`))[0], { age_group: "adult", guardian_member_id: null });
  r = await call(O, "PATCH", "members/[id]", { params: { id: childId }, body: { age_group: "child" } });
  is("adult -> child without a guardian refused", r, 422, "child_needs_guardian");
  r = await call(O, "PATCH", "members/[id]", { params: { id: childId }, body: { age_group: "child", guardian_member_id: m.guardian } });
  is("adult -> child with a guardian", r, 200, "ok");

  // groups
  r = await call(O, "POST", "groups", { body: { kind: "group", name: " Prayer   Team ", description: "Tuesday prayer" } });
  is("create group", r, 201, "ok");
  const gid = r.body.id;
  r = await call(O, "POST", "groups", { body: { kind: "group", name: "prayer team" } });
  is("duplicate active group name refused", r, 409, "group_name_taken");
  r = await call(O, "PATCH", "groups/[id]", { params: { id: gid }, body: { name: "Prayer Warriors", description: null } });
  is("edit group", r, 200, "ok");
  r = await call(O, "POST", "groups/[id]/members", { params: { id: gid }, body: { member_id: m.other } });
  is("add a member (role defaults to member)", r, 201, "ok");
  const mem1 = r.body.id;
  r = await call(O, "POST", "groups/[id]/members", { params: { id: gid }, body: { member_id: m.other } });
  is("adding the same person twice refused", r, 409, "already_in_group");
  r = await call(O, "POST", "groups/[id]/members", { params: { id: gid }, body: { member_id: m.vol, role: "leader" } });
  is("assign a leader", r, 201, "ok");
  r = await call(O, "POST", "groups/[id]/members", { params: { id: gid }, body: { member_id: m.pending } });
  is("a pending person cannot be added to a group", r, 422, "member_not_active");
  r = await call(O, "PATCH", "groups/[id]/members/[membershipId]", { params: { id: gid, membershipId: mem1 }, body: { role: "assistant" } });
  is("promote to assistant", r, 200, "ok");
  r = await call(O, "PATCH", "groups/[id]/members/[membershipId]", { params: { id: gid, membershipId: mem1 }, body: { role: "volunteer" } });
  is("change role", r, 200, "ok");
  r = await call(O, "GET", "groups/[id]", { params: { id: gid } });
  is("group detail", r, 200, "ok");
  eq("group detail: leader listed first", r.body.members.map((x) => [x.name, x.role]), [["Vera Volunteer", "leader"], ["Olivier Other", "volunteer"]]);
  r = await call(O, "DELETE", "groups/[id]/members/[membershipId]", { params: { id: gid, membershipId: mem1 } });
  is("remove from group", r, 200, "ok");
  r = await call(O, "PATCH", "groups/[id]", { params: { id: gid }, body: { status: "archived" } });
  is("archive group", r, 200, "ok");
  r = await call(O, "POST", "groups/[id]/members", { params: { id: gid }, body: { member_id: m.other } });
  is("cannot add to an archived group", r, 422, "group_archived");
  r = await call(O, "GET", "groups", { url: "?status=active" });
  check("list groups: counts, filter", r.body.groups.every((x) => x.status === "active") && r.body.groups.find((x) => x.id === g.choir).member_count === 3);
  r = await call(O, "DELETE", "groups/[id]", { params: { id: gid } });
  is("delete group", r, 200, "ok");
  // a group with a child: the owner holds children.manage implicitly
  r = await call(O, "DELETE", "groups/[id]", { params: { id: g.kids } });
  is("owner may delete a group that holds a child", r, 200, "ok");

  // leadership
  r = await call(O, "GET", "leadership");
  is("leadership list", r, 200, "ok");
  eq("leadership: current + historical, newest first", r.body.appointments.map((x) => [x.title, x.is_current]), [["Senior Pastor", true], ["Deacon", false]]);
  r = await call(O, "GET", "leadership", { url: "?current=true" });
  eq("leadership: current only", r.body.appointments.map((x) => x.title), ["Senior Pastor"]);
  r = await call(O, "GET", "leadership", { url: "?current=false" });
  eq("leadership: history only", r.body.appointments.map((x) => x.title), ["Deacon"]);
  r = await call(O, "POST", "leadership", { body: { member_id: m.vol, title: "Treasurer", started_on: "2026-01-01" } });
  is("create appointment", r, 201, "ok");
  const l3 = r.body.id;
  r = await call(O, "POST", "leadership", { body: { member_id: m.vol, title: "treasurer" } });
  is("a second open appointment with the same title refused", r, 409, "appointment_exists");
  r = await call(O, "PATCH", "leadership/[id]", { params: { id: l3 }, body: { title: "Head Treasurer" } });
  is("edit title", r, 200, "ok");
  r = await call(O, "PATCH", "leadership/[id]", { params: { id: l3 }, body: { ended_on: "2025-12-31" } });
  is("an end date before the start date refused", r, 422, "invalid_date_range");
  r = await call(O, "PATCH", "leadership/[id]", { params: { id: l3 }, body: { ended_on: "2026-06-30" } });
  is("end the appointment", r, 200, "ok");
  // an end date of today (Africa/Douala) or earlier is history at once; a future end date is still current
  const l4 = (await call(O, "POST", "leadership", { body: { member_id: m.other, title: "Greeter" } })).body.id;
  const today = HND.todayDouala();
  const tomorrow = HND.todayDouala(Date.now() + 86400_000);
  r = await call(O, "PATCH", "leadership/[id]", { params: { id: l4 }, body: { ended_on: tomorrow } });
  r = await call(O, "GET", "leadership", { url: "?current=true" });
  check("a future end date is still current", r.body.appointments.some((x) => x.id === l4 && x.is_current === true));
  await call(O, "PATCH", "leadership/[id]", { params: { id: l4 }, body: { ended_on: today } });
  r = await call(O, "GET", "leadership", { url: "?current=true" });
  check("ending an appointment today removes it from Current at once", !r.body.appointments.some((x) => x.id === l4));
  r = await call(O, "GET", "leadership", { url: "?current=false" });
  check("...and it is in History, flagged as not current", r.body.appointments.some((x) => x.id === l4 && x.is_current === false));
  eq("ended appointment stays as history", (await rows(`select title, ended_on::text as e from public.church_leadership where id = '${l3}'`))[0], { title: "Head Treasurer", e: "2026-06-30" });
  r = await call(O, "POST", "leadership", { body: { member_id: m.kid1, title: "Child Leader" } });
  is("a child cannot be appointed", r, 422, "role_requires_adult");
  r = await call(O, "POST", "leadership", { body: { member_id: m.pending, title: "Pending Leader" } });
  is("an inactive person cannot be appointed", r, 422, "member_not_active");
  check("no DELETE route for appointments", (() => { const mod = jiti(routeFile("leadership/[id]")); return typeof mod.DELETE === "undefined"; })());
  eq("the service-role client was never requested", globalThis.__adminClientCalls, 0);
}

// =================================================================================================================================================================
section = "C. staff (scenario 2, 6, 7, 10): ";
// =================================================================================================================================================================
await fresh();
{
  let before = await F.snapshot(db);
  let r;
  // a church admin (members + groups manage, leadership.view, no children, no delete)
  r = await call(u.mgr1, "GET", "members");
  is("mgr: list", r, 200, "ok");
  check("mgr: sees adults and youth but NO child", r.body.members.length === 7 && r.body.members.every((x) => x.age_group !== "child"));
  r = await call(u.mgr1, "GET", "members", { url: "?age_group=child" });
  eq("mgr: filtering by child finds none", r.body.members.length, 0);
  r = await call(u.mgr1, "GET", "members/[id]", { params: { id: m.kid1 } });
  is("mgr: child detail is 404 (not 403: existence is not confirmed)", r, 404, "not_found");
  r = await call(u.mgr1, "PATCH", "members/[id]", { params: { id: m.kid1 }, body: { full_name: "Hacked" } });
  is("mgr: cannot edit a child", r, 404, "not_found");
  r = await call(u.mgr1, "DELETE", "members/[id]", { params: { id: m.kid1 } });
  is("mgr: cannot delete a child", r, 403, "forbidden");
  r = await call(u.mgr1, "POST", "members", { body: { full_name: "Sneaky Child", age_group: "child", guardian_member_id: m.guardian } });
  is("mgr: cannot create a child", r, 403, "children_restricted");
  r = await call(u.mgr1, "PATCH", "members/[id]", { params: { id: m.youth }, body: { age_group: "child", guardian_member_id: m.guardian } });
  is("mgr: cannot reclassify a youth as a child", r, 403, "children_restricted");
  r = await call(u.mgr1, "PATCH", "members/[id]", { params: { id: m.youth }, body: { age_group: "adult" } });
  is("mgr: may reclassify a youth as an adult (not a child act)", r, 200, "ok");
  await F.svc(db, `update public.church_members set age_group = 'youth' where id = '${m.youth}'`);
  r = await call(u.mgr1, "DELETE", "members/[id]", { params: { id: m.other } });
  is("mgr: cannot delete a member (no church.members.delete)", r, 403, "forbidden");
  eq("...and the record is still there", await count("church_members", `id = '${m.other}'`), 1);
  r = await call(u.mgr1, "POST", "members", { body: { full_name: "Staff Added" } });
  is("mgr: can add an adult", r, 201, "ok");
  r = await call(u.mgr1, "POST", "groups", { body: { kind: "group", name: "Ushers" } });
  is("mgr: can create a group", r, 201, "ok");
  r = await call(u.mgr1, "POST", "leadership", { body: { member_id: m.other, title: "Usher Lead" } });
  is("mgr: cannot manage leadership (leadership.view only)", r, 403, "forbidden");
  r = await call(u.mgr1, "GET", "leadership");
  is("mgr: can read leadership", r, 200, "ok");
  r = await call(u.mgr1, "POST", "groups/[id]/members", { params: { id: g.kids }, body: { member_id: m.other } });
  is("mgr: adding a person to a group that holds children is allowed for a plain member", r, 201, "ok");
  r = await call(u.mgr1, "POST", "groups/[id]/members", { params: { id: g.kids }, body: { member_id: m.admin, role: "leader" } });
  is("mgr: appointing a leader in a group that holds a child needs children.manage", r, 403, "leader_assignment_denied");
  r = await call(u.mgr1, "DELETE", "groups/[id]", { params: { id: g.kids } });
  is("mgr: deleting a group that holds a child is refused (scenario 9)", r, 403, "group_has_children");
  eq("...the group and its child membership survive", [await count("church_groups", `id = '${g.kids}'`), await count("church_group_members", `id = '${gm.kid1}'`)], [1, 1]);
  r = await call(u.mgr1, "DELETE", "groups/[id]/members/[membershipId]", { params: { id: g.kids, membershipId: gm.kid1 } });
  is("mgr: removing a child from a group (cannot even see it)", r, 404, "not_found");
  r = await call(u.mgr1, "GET", "groups/[id]", { params: { id: g.kids } });
  check("mgr: the children's group lists no child", r.status === 200 && r.body.members.every((x) => x.age_group !== "child") && !JSON.stringify(r.body).includes("Kiki"));
  r = await call(u.mgr1, "GET", "groups");
  check("mgr: the children's group count excludes the child", r.body.groups.find((x) => x.id === g.kids).member_count === 1 /* only the plain member added above */);

  // viewer: read only
  r = await call(u.viewer1, "GET", "members");
  is("viewer: list", r, 200, "ok");
  // regression: staff keep the full detail, with contact fields and no contact_hidden marker
  for (const [who, tag] of [[u.viewer1, "viewer"], [u.mgr1, "church admin"], [u.owner1, "owner"]]) {
    const dd = await call(who, "GET", "members/[id]", { params: { id: m.guardian } });
    check(`${tag}: detail still carries phone, and no contact_hidden marker`, dd.status === 200 && dd.body.member.phone === "+237670000003" && !("contact_hidden" in dd.body), JSON.stringify(dd.body).slice(0, 200));
  }
  for (const [n, rr] of [
    ["create", await call(u.viewer1, "POST", "members", { body: { full_name: "X" } })],
    ["edit", await call(u.viewer1, "PATCH", "members/[id]", { params: { id: m.other }, body: { full_name: "X" } })],
    ["delete", await call(u.viewer1, "DELETE", "members/[id]", { params: { id: m.other } })],
    ["create group", await call(u.viewer1, "POST", "groups", { body: { kind: "group", name: "X" } })],
    ["list groups", await call(u.viewer1, "GET", "groups")],
    ["add to group", await call(u.viewer1, "POST", "groups/[id]/members", { params: { id: g.choir }, body: { member_id: m.admin } })],
    ["leadership", await call(u.viewer1, "GET", "leadership")],
    ["create leadership", await call(u.viewer1, "POST", "leadership", { body: { member_id: m.admin, title: "X" } })],
  ]) is(`viewer: ${n} refused`, rr, 403, "forbidden");

  // a member with no church permission at all
  for (const [n, rr] of [["list", await call(u.plain1, "GET", "members")], ["groups", await call(u.plain1, "GET", "groups")], ["create", await call(u.plain1, "POST", "members", { body: { full_name: "X" } })]]) is(`non-church staff: ${n}`, rr, 403, "forbidden");

  // children.view without manage
  r = await call(u.kids1, "GET", "members", { url: "?age_group=child" });
  eq("children viewer: sees the children", r.body.members.map((x) => x.id).sort(), [m.kid1, m.kid2].sort());
  r = await call(u.kids1, "GET", "members/[id]", { params: { id: m.kid1 } });
  check("children viewer: child detail has no contact fields with values", r.status === 200 && r.body.member.phone === null && r.body.member.email === null && r.body.can.edit === false);
  r = await call(u.kids1, "PATCH", "members/[id]", { params: { id: m.kid1 }, body: { full_name: "Renamed" } });
  is("children viewer: cannot edit a child", r, 403, "forbidden");
  r = await call(u.kids1, "DELETE", "members/[id]", { params: { id: m.kid1 } });
  is("children viewer: cannot delete a child", r, 403, "forbidden");

  // children.manage + members.manage
  r = await call(u.kidsMgr1, "PATCH", "members/[id]", { params: { id: m.kid1 }, body: { full_name: "Kiki Renamed" } });
  is("children manager: may edit a child", r, 200, "ok");
  r = await call(u.kidsMgr1, "POST", "members", { body: { full_name: "New Child", age_group: "child", guardian_member_id: m.guardian } });
  is("children manager: may create a child", r, 201, "ok");
  r = await call(u.kidsMgr1, "DELETE", "members/[id]", { params: { id: m.kid2 } });
  is("children manager without members.delete cannot delete", r, 403, "forbidden");

  // delete permission
  r = await call(u.del1, "DELETE", "members/[id]", { params: { id: m.other } });
  is("deleter: may delete an adult", r, 200, "ok");
  r = await call(u.del1, "DELETE", "members/[id]", { params: { id: m.kid2 } });
  is("deleter without children rights: a child is invisible", r, 404, "not_found");
  r = await call(u.kd1, "DELETE", "members/[id]", { params: { id: m.kid2 } });
  is("deleter with children.manage: may delete a child", r, 200, "ok");

  // groups manager without children.manage / children manager with groups.manage
  r = await call(u.grpMgr1, "DELETE", "groups/[id]", { params: { id: g.kids } });
  is("groups manager without children.manage cannot delete a group that holds a child", r, 403, "group_has_children");
  r = await call(u.grpMgr1, "POST", "groups/[id]/members", { params: { id: g.youthGrp }, body: { member_id: m.kid1 } });
  is("groups manager cannot add a child to a group", r, 422, "invalid_member"); // the child is not visible to them
  r = await call(u.kg1, "POST", "groups/[id]/members", { params: { id: g.youthGrp }, body: { member_id: m.kid1 } });
  is("children+groups manager may add a child", r, 201, "ok");
  const kidMembership = r.body.id;
  r = await call(u.kg1, "POST", "groups/[id]/members", { params: { id: g.youthGrp }, body: { member_id: m.kid1, role: "leader" } });
  is("a child cannot lead (already a member / role)", r, 422, "role_requires_adult");
  r = await call(u.kg1, "PATCH", "groups/[id]/members/[membershipId]", { params: { id: g.youthGrp, membershipId: kidMembership }, body: { role: "leader" } });
  is("a child cannot be promoted to leader", r, 422, "child_role_denied");
  r = await call(u.kg1, "DELETE", "groups/[id]/members/[membershipId]", { params: { id: g.youthGrp, membershipId: kidMembership } });
  is("children+groups manager may remove the child", r, 200, "ok");
  r = await call(u.kg1, "DELETE", "groups/[id]", { params: { id: g.kids } });
  is("children manager may delete a group that holds a child", r, 200, "ok");

  // leadership manager
  r = await call(u.leadMgr1, "POST", "leadership", { body: { member_id: m.vol, title: "Greeter Lead", started_on: "2026-03-01" } });
  is("leadership manager: create", r, 201, "ok");
  r = await call(u.leadMgr1, "POST", "members", { body: { full_name: "X" } });
  is("leadership manager cannot create members", r, 403, "forbidden");
  r = await call(u.leadMgr1, "POST", "leadership", { body: { member_id: m.kid1, title: "Kid Boss" } });
  is("leadership manager cannot appoint a child (invisible)", r, 422, "invalid_member");

  // permission/plan edges
  await F.svc(db, `update public.users set plan_id = '${F.plan.free}' where id = '${u.owner1}'`);
  r = await call(u.mgr1, "GET", "members");
  is("staff of an organization whose plan lost Team Management are refused", r, 403, "forbidden");
  r = await call(u.owner1, "GET", "members");
  is("the owner is unaffected by the plan flag", r, 200, "ok");
  await F.svc(db, `update public.users set plan_id = '${F.plan.biz}' where id = '${u.owner1}'`);
  await F.svc(db, `update public.organization_members set status = 'inactive' where user_id = '${u.mgr1}'`);
  r = await call(u.mgr1, "GET", "members");
  is("a deactivated team member is refused", r, 403, "forbidden");
  await F.svc(db, `update public.organization_members set status = 'active' where user_id = '${u.mgr1}'`);
  r = await call(u.adminMember, "GET", "members");
  is("a platform admin who is merely a team member gets nothing", r, 403, "forbidden");
  r = await call(u.admin, "GET", "members");
  is("a platform admin with no relationship gets nothing", r, 403, "forbidden");
  const adminTry = await call(u.admin, "GET", "members", { url: "?group_id=" + g.choir });
  is("...even with filters", adminTry, 403, "forbidden");
  eq("the service-role client was never requested", globalThis.__adminClientCalls, 0);
  void before;
}

// =================================================================================================================================================================
section = "D. cross-church isolation and unauthenticated access (scenarios 3, 4, 11, 12): ";
// =================================================================================================================================================================
await fresh();
{
  const before = await F.snapshot(db);
  let r;
  // owner 2 / staff 2 attacking church 1 with real ids from church 1
  for (const who of [u.owner2, u.mgr2]) {
    const tag = who === u.owner2 ? "owner2" : "mgr2";
    r = await call(who, "GET", "members/[id]", { params: { id: m.admin } });
    is(`${tag}: read another church's person`, r, 404, "not_found");
    r = await call(who, "PATCH", "members/[id]", { params: { id: m.admin }, body: { full_name: "Hijacked" } });
    is(`${tag}: edit another church's person`, r, 404, "not_found");
    r = await call(who, "DELETE", "members/[id]", { params: { id: m.admin } });
    check(`${tag}: delete another church's person (404 or 403)`, [403, 404].includes(r.status), `${r.status}`);
    r = await call(who, "GET", "groups/[id]", { params: { id: g.choir } });
    is(`${tag}: read another church's group`, r, 404, "not_found");
    r = await call(who, "PATCH", "groups/[id]", { params: { id: g.choir }, body: { name: "Hijacked" } });
    is(`${tag}: rename another church's group`, r, 404, "not_found");
    r = await call(who, "DELETE", "groups/[id]", { params: { id: g.choir } });
    is(`${tag}: delete another church's group`, r, 404, "not_found");
    r = await call(who, "POST", "groups/[id]/members", { params: { id: g.choir }, body: { member_id: m.c2a } });
    is(`${tag}: add own person to another church's group`, r, 404, "not_found");
    r = await call(who, "POST", "groups/[id]/members", { params: { id: g.c2grp }, body: { member_id: m.admin } });
    is(`${tag}: add another church's person to own group`, r, 422, "invalid_member");
    r = await call(who, "PATCH", "groups/[id]/members/[membershipId]", { params: { id: g.choir, membershipId: gm.vol }, body: { role: "leader" } });
    is(`${tag}: change a membership of another church`, r, 404, "not_found");
    r = await call(who, "DELETE", "groups/[id]/members/[membershipId]", { params: { id: g.choir, membershipId: gm.vol } });
    is(`${tag}: remove a membership of another church`, r, 404, "not_found");
    r = await call(who, "PATCH", "groups/[id]/members/[membershipId]", { params: { id: g.c2grp, membershipId: gm.vol }, body: { role: "member" } });
    is(`${tag}: a membership id of church 1 under a church-2 group id`, r, 404, "not_found");
    r = await call(who, "POST", "leadership", { body: { member_id: m.admin, title: "Hijack" } });
    check(`${tag}: appoint another church's person`, r.status === 422 || r.status === 403, `${r.status}`);
    r = await call(who, "PATCH", "leadership/[id]", { params: { id: ld.l1 }, body: { title: "Hijacked" } });
    check(`${tag}: edit another church's appointment`, r.status === 404, `${r.status}`);
    r = await call(who, "GET", "members", { url: "?group_id=" + g.choir });
    eq(`${tag}: group filter with a foreign group id`, r.body.members.length, 0);
    r = await call(who, "GET", "members");
    check(`${tag}: own list holds only own church`, r.body.members.every((x) => [m.c2a, m.c2b].includes(x.id)) && r.body.members.length === 1);
    r = await call(who, "GET", "leadership");
    eq(`${tag}: own leadership only`, r.body.appointments.map((x) => x.title), ["Elder"]);
  }
  // forged profile ids
  for (const [n, rr] of [
    ["profile_id in a create body", await call(u.owner2, "POST", "members", { body: { full_name: "X", profile_id: prof.c1 } })],
    ["profileId in a create body", await call(u.owner2, "POST", "members", { body: { full_name: "X", profileId: prof.c1 } })],
    ["profile_id in an update body", await call(u.owner2, "PATCH", "members/[id]", { params: { id: m.c2a }, body: { profile_id: prof.c1 } })],
    ["profile_id in a group body", await call(u.owner2, "POST", "groups", { body: { kind: "group", name: "X", profile_id: prof.c1 } })],
    ["profile_id in a membership body", await call(u.owner2, "POST", "groups/[id]/members", { params: { id: g.c2grp }, body: { member_id: m.c2a, profile_id: prof.c1 } })],
    ["profile_id in a leadership body", await call(u.owner2, "POST", "leadership", { body: { member_id: m.c2a, title: "X", profile_id: prof.c1 } })],
  ]) is(`forged ${n}`, rr, 400, "unexpected_field");
  for (const [n, rr] of [
    ["members", await call(u.owner2, "GET", "members", { url: "?profileId=" + prof.c1 })],
    ["groups", await call(u.owner2, "GET", "groups", { url: "?profile_id=" + prof.c1 })],
    ["leadership", await call(u.owner2, "GET", "leadership", { url: "?profileId=" + prof.c1 })],
  ]) is(`forged profile id in the ${n} query`, rr, 400, "unexpected_field");
  // a forged active-organization cookie only picks among real memberships
  globalThis.__orgCookie = prof.c1;
  r = await call(u.owner2, "GET", "members");
  check("a forged active-org cookie grants nothing (still own church)", r.status === 200 && r.body.members.every((x) => x.id === m.c2a));
  r = await call(u.stranger, "GET", "members");
  is("a cookie naming a church the user has no part in does not help a stranger", r, 403, "forbidden");
  globalThis.__orgCookie = null;
  r = await call(u.stranger, "GET", "members");
  is("stranger: no access", r, 403, "forbidden");
  r = await call(u.stranger, "POST", "members", { body: { full_name: "X" } });
  is("stranger: cannot create", r, 403, "forbidden");
  // owner of a non-church profile
  r = await call(u.ownerNC, "GET", "members");
  is("owner of a non-church profile: no church workspace", r, 403, "forbidden");
  // unauthenticated
  for (const [n, rel, method, opts] of [
    ["list members", "members", "GET"], ["create member", "members", "POST", { body: { full_name: "X" } }], ["member detail", "members/[id]", "GET", { params: { id: m.admin } }],
    ["edit member", "members/[id]", "PATCH", { params: { id: m.admin }, body: { full_name: "X" } }], ["delete member", "members/[id]", "DELETE", { params: { id: m.admin } }],
    ["list groups", "groups", "GET"], ["group detail", "groups/[id]", "GET", { params: { id: g.choir } }], ["create group", "groups", "POST", { body: { kind: "group", name: "X" } }],
    ["add group member", "groups/[id]/members", "POST", { params: { id: g.choir }, body: { member_id: m.admin } }],
    ["remove group member", "groups/[id]/members/[membershipId]", "DELETE", { params: { id: g.choir, membershipId: gm.vol } }],
    ["list leadership", "leadership", "GET"], ["create leadership", "leadership", "POST", { body: { member_id: m.admin, title: "X" } }], ["edit leadership", "leadership/[id]", "PATCH", { params: { id: ld.l1 }, body: { title: "X" } }],
  ]) is(`anonymous: ${n}`, await call(null, method, rel, opts || {}), 401, "not_signed_in");
  // the database itself, as the anon role and as a raw authenticated stranger
  for (const t of ["church_members", "church_groups", "church_group_members", "church_leadership"]) {
    const anon = await F.sessionFor(db, null).from(t).select("*");
    check(`anon role cannot read ${t}`, anon.error && anon.error.code === "42501", JSON.stringify(anon.error));
    const w = await F.sessionFor(db, null).from(t).delete().eq("profile_id", prof.c1);
    check(`anon role cannot delete from ${t}`, w.error && w.error.code === "42501", JSON.stringify(w.error));
    const s = await F.sessionFor(db, u.stranger).from(t).select("id");
    check(`a stranger's own query sees zero ${t} rows`, !s.error && s.data.length === 0, JSON.stringify(s));
    const c2 = await F.sessionFor(db, u.owner2).from(t).select("id").eq("profile_id", prof.c1);
    check(`owner 2 querying church 1's ${t} by profile id sees zero rows`, !c2.error && c2.data.length === 0);
  }
  // direct writes by owner 2 into church 1 (what a forged profile id would attempt below the app layer)
  const w1 = await F.sessionFor(db, u.owner2).from("church_members").insert({ id: A(1), profile_id: prof.c1, full_name: "Planted" });
  check("DB: owner 2 cannot plant a member into church 1", !!w1.error, JSON.stringify(w1));
  const w2 = await F.sessionFor(db, u.owner2).from("church_group_members").insert({ id: A(2), profile_id: prof.c2, group_id: g.choir, member_id: m.c2a, role: "member" });
  check("DB: cannot attach church 2's person to church 1's group (composite keys)", !!w2.error, JSON.stringify(w2));
  const w3 = await F.sessionFor(db, u.owner2).from("church_members").update({ profile_id: prof.c1 }).eq("id", m.c2a).select("id");
  check("DB: a person cannot be moved to another church", !!w3.error || (w3.data || []).length === 0, JSON.stringify(w3));
  // malformed / hostile requests
  const hostile = [
    ["non-JSON content type", await call(u.owner1, "POST", "members", { headers: { "content-type": "text/plain" }, raw: JSON.stringify({ full_name: "X" }) }), 415, "invalid_body"],
    ["broken JSON", await call(u.owner1, "POST", "members", { raw: "{nope" }), 400, "invalid_body"],
    ["array body", await call(u.owner1, "POST", "members", { raw: "[]" }), 400, "invalid_body"],
    ["oversize body", await call(u.owner1, "POST", "members", { raw: JSON.stringify({ full_name: "x".repeat(9000) }) }), 413, "invalid_body"],
    ["unexpected user_id", await call(u.owner1, "POST", "members", { body: { full_name: "X", user_id: u.stranger } }), 400, "unexpected_field"],
    ["unexpected source", await call(u.owner1, "POST", "members", { body: { full_name: "X", source: "join_request" } }), 400, "unexpected_field"],
    ["unexpected is_child", await call(u.owner1, "POST", "groups/[id]/members", { params: { id: g.choir }, body: { member_id: m.admin, is_child: false } }), 400, "unexpected_field"],
    ["invalid status", await call(u.owner1, "POST", "members", { body: { full_name: "X", status: "deleted" } }), 400, "invalid_status"],
    ["invalid age group", await call(u.owner1, "POST", "members", { body: { full_name: "X", age_group: "senior" } }), 400, "invalid_age_group"],
    ["invalid role", await call(u.owner1, "POST", "groups/[id]/members", { params: { id: g.choir }, body: { member_id: m.admin, role: "pastor" } }), 400, "invalid_role"],
    ["invalid group kind", await call(u.owner1, "POST", "groups", { body: { kind: "club", name: "X" } }), 400, "invalid_kind"],
    ["malformed date", await call(u.owner1, "POST", "leadership", { body: { member_id: m.admin, title: "X", started_on: "2026-02-31" } }), 400, "invalid_date"],
    ["timestamp instead of date", await call(u.owner1, "POST", "leadership", { body: { member_id: m.admin, title: "X", ended_on: "2026-01-01T00:00:00Z" } }), 400, "invalid_date"],
    ["non-uuid member id", await call(u.owner1, "POST", "leadership", { body: { member_id: "1; drop table x", title: "X" } }), 400, "invalid_member_id"],
    ["non-uuid path id", await call(u.owner1, "GET", "members/[id]", { params: { id: "not-a-uuid" } }), 404, "not_found"],
    ["sql in a path id", await call(u.owner1, "DELETE", "members/[id]", { params: { id: "x' or '1'='1" } }), 404, "not_found"],
    ["empty update", await call(u.owner1, "PATCH", "members/[id]", { params: { id: m.admin }, body: {} }), 400, "empty_update"],
    ["kind change on update", await call(u.owner1, "PATCH", "groups/[id]", { params: { id: g.choir }, body: { kind: "group" } }), 400, "unexpected_field"],
    ["member change on a leadership update", await call(u.owner1, "PATCH", "leadership/[id]", { params: { id: ld.l1 }, body: { member_id: m.other } }), 400, "unexpected_field"],
    ["bad query: page", await call(u.owner1, "GET", "members", { url: "?page=-1" }), 400, "invalid_page"],
    ["bad query: status", await call(u.owner1, "GET", "members", { url: "?status=zzz" }), 400, "invalid_status"],
  ];
  for (const [n, rr, st, code] of hostile) is(`hostile: ${n}`, rr, st, code);
  await unchanged("failed operations left every church table byte-for-byte unchanged", before);
  eq("the service-role client was never requested", globalThis.__adminClientCalls, 0);
}

// =================================================================================================================================================================
section = "E. group leaders (scenario 5): ";
// =================================================================================================================================================================
await fresh();
{
  let before = await F.snapshot(db);
  let r;
  r = await call(u.leader1, "GET", "groups");
  is("leader: group list", r, 200, "ok");
  eq("leader: sees only the group they belong to", r.body.groups.map((x) => x.name), ["Choir"]);
  r = await call(u.leader1, "GET", "groups/[id]", { params: { id: g.choir } });
  is("leader: own group detail", r, 200, "ok");
  eq("leader: sees the roster of the group they lead", r.body.members.map((x) => x.name).sort(), ["Luc Leader", "Olivier Other", "Vera Volunteer"]);
  check("leader: viewer flags are the leader's, not an administrator's", r.body.viewer.kind === "leader" && r.body.viewer.canManageGroup === false && r.body.viewer.canLeaderEdit === true);
  r = await call(u.leader1, "GET", "groups/[id]", { params: { id: g.youthGrp } });
  is("leader: another group of the same church", r, 404, "not_found");
  r = await call(u.leader1, "GET", "groups/[id]", { params: { id: g.kids } });
  is("leader: the children's group", r, 404, "not_found");
  r = await call(u.leader1, "GET", "members");
  is("leader: people list", r, 200, "ok");
  eq("leader: people of the groups they lead only", r.body.members.map((x) => x.id).sort(), [m.leader, m.other, m.vol].sort());
  r = await call(u.leader1, "GET", "members/[id]", { params: { id: m.admin } });
  is("leader: someone outside their groups", r, 404, "not_found");
  r = await call(u.leader1, "GET", "members/[id]", { params: { id: m.kid1 } });
  is("leader: a child outside their groups", r, 404, "not_found");
  r = await call(u.leader1, "GET", "members/[id]", { params: { id: m.other } });
  check("leader: a member of their group has a detail page without edit rights", r.status === 200 && r.body.can.edit === false && r.body.can.delete === false);
  check("leader: the detail of an adult in their group carries NO phone or email, and says so", !("phone" in r.body.member) && !("email" in r.body.member) && r.body.contact_hidden === true, JSON.stringify(r.body.member));
  check("leader: the seeded phone number appears nowhere in the response", !JSON.stringify(r.body).includes("670000002"));
  check("leader: the rest of the record is still there (name, status, groups)", r.body.member.full_name === "Olivier Other" && r.body.member.status === "active" && r.body.groups.length === 1);
  const own = await call(u.leader1, "GET", "members/[id]", { params: { id: m.leader } });
  check("leader: their own record is also served without contact fields", own.status === 200 && own.body.contact_hidden === true && !("phone" in own.body.member) && !("email" in own.body.member));
  r = await call(u.leader1, "GET", "members", { params: {} });
  check("leader: the list never had contact fields", r.body.members.every((x) => !("phone" in x) && !("email" in x)) && !("contact_hidden" in r.body));
  for (const [n, rr] of [
    ["create a group", await call(u.leader1, "POST", "groups", { body: { kind: "group", name: "Mine" } })],
    ["rename own group", await call(u.leader1, "PATCH", "groups/[id]", { params: { id: g.choir }, body: { name: "Mine" } })],
    ["delete own group", await call(u.leader1, "DELETE", "groups/[id]", { params: { id: g.choir } })],
    ["add a person", await call(u.leader1, "POST", "groups/[id]/members", { params: { id: g.choir }, body: { member_id: m.admin } })],
    ["create a member", await call(u.leader1, "POST", "members", { body: { full_name: "X" } })],
    ["edit a member", await call(u.leader1, "PATCH", "members/[id]", { params: { id: m.other }, body: { full_name: "X" } })],
    ["delete a member", await call(u.leader1, "DELETE", "members/[id]", { params: { id: m.other } })],
    ["create leadership", await call(u.leader1, "POST", "leadership", { body: { member_id: m.other, title: "X" } })],
    ["promote someone to leader", await call(u.leader1, "PATCH", "groups/[id]/members/[membershipId]", { params: { id: g.choir, membershipId: gm.vol }, body: { role: "leader" } })],
    ["remove the leader row (self)", await call(u.leader1, "DELETE", "groups/[id]/members/[membershipId]", { params: { id: g.choir, membershipId: gm.leader } })],
  ]) is(`leader cannot ${n}`, rr, 403, "forbidden");
  r = await call(u.leader1, "PATCH", "groups/[id]/members/[membershipId]", { params: { id: g.choir, membershipId: gm.vol }, body: { role: "worker" } });
  is("leader: may re-label a plain member (volunteer -> worker)", r, 200, "ok");
  r = await call(u.leader1, "DELETE", "groups/[id]/members/[membershipId]", { params: { id: g.choir, membershipId: gm.other } });
  is("leader: may remove a plain member from their group", r, 200, "ok");
  r = await call(u.leader1, "GET", "leadership");
  check("leader: the leadership list is only their own appointments (none)", r.status === 200 && r.body.appointments.length === 0);
  r = await call(u.leader1, "PATCH", "groups/[id]/members/[membershipId]", { params: { id: g.kids, membershipId: gm.kid1 }, body: { role: "member" } });
  is("leader: another group's membership", r, 404, "not_found");
  // a plain group member (volunteer) who is not a leader
  r = await call(u.vol1, "PATCH", "groups/[id]/members/[membershipId]", { params: { id: g.choir, membershipId: gm.vol }, body: { role: "member" } });
  is("volunteer: cannot change even their own role", r, 403, "forbidden");
  r = await call(u.vol1, "DELETE", "groups/[id]/members/[membershipId]", { params: { id: g.choir, membershipId: gm.vol } });
  is("volunteer: cannot remove themselves via the church routes", r, 403, "forbidden");
  r = await call(u.vol1, "GET", "members");
  eq("volunteer: sees only their own record", r.body.members.map((x) => x.id), [m.vol]);
  // a leader loses scope when no longer an active adult leader
  await F.svc(db, `update public.church_members set status = 'inactive' where id = '${m.leader}'`);
  r = await call(u.leader1, "GET", "groups/[id]", { params: { id: g.choir } });
  check("an inactive leader no longer has the group's scope", r.status === 403 || r.status === 404, `${r.status}`);
  void before;
}

// =================================================================================================================================================================
section = "F. DB-level child bypass attempts, below the app layer (scenarios 6-10): ";
// =================================================================================================================================================================
await fresh();
{
  // Same attempts the routes pre-check, but straight at the tables as the user: proves the DATABASE refuses even if the app layer were bypassed or buggy.
  const S = (who) => F.sessionFor(db, who);
  let before = await F.snapshot(db);
  let r;
  // mgr1: members.manage + groups.manage, no children rights
  r = await S(u.mgr1).from("church_members").update({ age_group: "child", guardian_member_id: m.guardian }).eq("id", m.youth).select("id");
  check("mgr: youth -> child is refused by the database", !!r.error || (r.data || []).length === 0, JSON.stringify(r));
  r = await S(u.mgr1).from("church_members").update({ guardian_member_id: m.admin }).eq("id", m.kid1).select("id");
  check("mgr: changing a child's guardian touches nothing", !r.error && (r.data || []).length === 0, JSON.stringify(r));
  r = await S(u.mgr1).from("church_group_members").delete().eq("id", gm.kid1).select("id");
  check("mgr: removing a child from a group touches nothing", !r.error && (r.data || []).length === 0, JSON.stringify(r));
  r = await S(u.mgr1).from("church_group_members").insert({ id: A(10), profile_id: prof.c1, group_id: g.youthGrp, member_id: m.kid2, role: "member" });
  check("mgr: adding a child to a group is refused", !!r.error, JSON.stringify(r));
  r = await S(u.mgr1).from("church_group_members").insert({ id: A(11), profile_id: prof.c1, group_id: g.kids, member_id: m.admin, role: "leader" });
  check("mgr: appointing a leader in a group holding a child is refused", !!r.error && /leader_assignment_denied/.test(r.error.message), JSON.stringify(r));
  r = await S(u.mgr1).from("church_groups").delete().eq("id", g.kids).select("id");
  check("mgr: deleting a group that holds a child is refused", !!r.error && /church_group_has_children/.test(r.error.message), JSON.stringify(r));
  r = await S(u.mgr1).from("church_members").insert({ id: A(12), profile_id: prof.c1, full_name: "Kid X", age_group: "child", guardian_member_id: m.guardian, source: "manual" });
  check("mgr: creating a child is refused", !!r.error, JSON.stringify(r));
  r = await S(u.mgr1).from("church_members").insert({ id: A(13), profile_id: prof.c1, full_name: "Self Joined", source: "join_request" });
  check("mgr: a join_request source is refused (no public join in this phase)", !!r.error, JSON.stringify(r));
  r = await S(u.mgr1).from("church_members").delete().eq("id", m.other).select("id");
  check("mgr: deleting a member without members.delete touches nothing", !r.error && (r.data || []).length === 0, JSON.stringify(r));
  r = await S(u.mgr1).from("church_leadership").insert({ id: A(14), profile_id: prof.c1, member_id: m.other, title: "X" });
  check("mgr: leadership insert without leadership.manage is refused", !!r.error, JSON.stringify(r));
  r = await S(u.mgr1).from("church_leadership").update({ title: "X" }).eq("id", ld.l1).select("id");
  check("mgr: leadership update without leadership.manage touches nothing", !r.error && (r.data || []).length === 0, JSON.stringify(r));
  // viewer1 (members.view only)
  r = await S(u.viewer1).from("church_members").update({ full_name: "X" }).eq("id", m.other).select("id");
  check("viewer: update touches nothing", !r.error && (r.data || []).length === 0, JSON.stringify(r));
  r = await S(u.viewer1).from("church_groups").insert({ id: A(15), profile_id: prof.c1, kind: "group", name: "X" });
  check("viewer: group insert refused", !!r.error);
  // kids1 (children.view only): cannot declassify
  r = await S(u.kids1).from("church_members").update({ age_group: "adult", guardian_member_id: null }).eq("id", m.kid1).select("id");
  check("children viewer: cannot declassify a child", !r.error && (r.data || []).length === 0, JSON.stringify(r));
  // non-leader leadership manager appointing a child
  r = await S(u.owner1).from("church_leadership").insert({ id: A(16), profile_id: prof.c1, member_id: m.kid1, title: "Boss" });
  check("even the owner cannot appoint a child (guard)", !!r.error && /church_role_requires_adult/.test(r.error.message), JSON.stringify(r));
  await unchanged("every refused attempt above left the data unchanged", before);
  r = await S(u.mgr1).from("church_groups").update({ name: "Renamed" }).eq("id", g.choir).select("id");
  check("(control) a groups.manage holder may rename a group, so the refusals above are not a broken harness", !r.error && r.data.length === 1);

  // legitimate cascade behaviour retained
  r = await S(u.kg1).from("church_groups").delete().eq("id", g.kids).select("id");
  check("a children.manage holder may delete a group that holds a child", !r.error && r.data.length === 1, JSON.stringify(r));
  eq("...which removes the child's membership but not the child", [await count("church_group_members", `id = '${gm.kid1}'`), await count("church_members", `id = '${m.kid1}'`)], [0, 1]);
  r = await S(u.owner1).from("profiles").delete().eq("id", prof.c1).select("id");
  check("the owner deleting the church profile succeeds", !r.error && r.data.length === 1, JSON.stringify(r));
  eq("...and cascades every church record (Phase 2A behaviour kept)", [await count("church_members", `profile_id = '${prof.c1}'`), await count("church_groups", `profile_id = '${prof.c1}'`), await count("church_group_members", `profile_id = '${prof.c1}'`), await count("church_leadership", `profile_id = '${prof.c1}'`)], [0, 0, 0, 0]);
  eq("...and left the other church untouched", [await count("church_members", `profile_id = '${prof.c2}'`), await count("church_groups", `profile_id = '${prof.c2}'`)], [1, 1]);
}

// =================================================================================================================================================================
section = "G. Team permission rules mirror the database (scenario 13): ";
// =================================================================================================================================================================
await fresh();
{
  // For several actors and several role changes, the app-side rule must give the SAME accept/deny as the database guard (organization_roles triggers) does when the user really attempts it.
  const cases = [
    { who: u.owner1, isOwner: true, isAdmin: false, held: [], label: "owner" },
    { who: u.mgr1, isOwner: false, isAdmin: false, held: ["church.members.view", "church.members.manage", "church.groups.view", "church.groups.manage", "church.leadership.view"], label: "church admin" },
    { who: u.admin, isOwner: false, isAdmin: true, held: [], label: "platform admin" },
  ];
  const changes = [
    [["church.members.view"], "ordinary, held"],
    [["church.leadership.manage"], "ordinary, not held"],
    [["church.children.view"], "sensitive view"],
    [["church.children.manage"], "sensitive manage"],
    [["church.members.delete"], "sensitive delete"],
    [["church.members.view", "church.groups.manage"], "two ordinary, held"],
    [["orders.view"], "no church permission"],
  ];
  let n = 0;
  for (const c of cases) {
    for (const [perms, label] of changes) {
      n++;
      const rid = F.id("2", n);
      const res = await F.sessionFor(db, c.who).from("organization_roles").insert({ id: rid, profile_id: prof.c1, key: `k${n}`, name: `R${n}`, permissions: `{${perms.join(",")}}` });
      const dbAllows = !res.error;
      // the Team routes only run for staff.manage holders; the platform admin reaches them through has_org_permission, so it is included here
      const appAllows = PERM.churchRoleChangeAllowed({ isOwner: c.isOwner, isAdmin: c.isAdmin, held: new Set(c.held), before: [], after: perms });
      // a role without any church permission is not this rule's business (the existing Team ceiling decides it); only the church rule is compared here
      if (!perms.some((p) => p.startsWith("church."))) { check(`${c.label}: the church rule does not interfere with a non-church permission`, appAllows === true); continue; }
      check(`${c.label} creating a role with ${label}: app rule (${appAllows}) matches the database (${dbAllows})`, appAllows === dbAllows, JSON.stringify(res.error));
    }
  }
  // update parity: removing a sensitive permission from a role
  const rid = F.id("3", 1);
  await F.svc(db, `insert into public.organization_roles (id, profile_id, key, name, permissions) values ('${rid}','${prof.c1}','k_upd','Upd','{church.children.view,church.members.view}')`);
  const res = await F.sessionFor(db, u.mgr1).from("organization_roles").update({ permissions: "{church.members.view}" }).eq("id", rid).select("id");
  const dbAllows = !res.error && (res.data || []).length === 1;
  const appAllows = PERM.churchRoleChangeAllowed({ isOwner: false, isAdmin: false, held: new Set(["church.members.view"]), before: ["church.children.view", "church.members.view"], after: ["church.members.view"] });
  check(`a church admin removing a sensitive permission: app (${appAllows}) matches the database (${dbAllows})`, appAllows === dbAllows, JSON.stringify(res));
  // existing Team gating is untouched: the catalogue still contains every pre-existing permission
  for (const p of ["orders.view", "staff.manage", "settings.manage", "inbox.view", "inbox.close", "loyalty.scan"]) check(`Team catalogue still has ${p}`, TEAMPERM.PERMISSIONS.includes(p));
  check("sanitizePermissions keeps church permissions and drops unknown church strings", JSON.stringify(TEAMPERM.sanitizePermissions(["church.members.view", "church.export", "church.bogus", "Church.Children.View"])) === JSON.stringify(["church.members.view"]));
}

// =================================================================================================================================================================
section = "H. privacy of the public surface and static guarantees (scenario 14): ";
// =================================================================================================================================================================
{
  const walk = (dir, out = []) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(e.name)) out.push(p); } return out; };
  const files = walk(SRC);
  const rel = (f) => path.relative(REPO, f).replace(/\\/g, "/");
  const TABLES = /church_members|church_groups|church_group_members|church_leadership/;
  const allowed = (r) => r.startsWith("src/lib/church/") || r.startsWith("src/app/api/church/") || r.startsWith("src/components/church/") || r.startsWith("src/app/dashboard/church/");
  const offenders = files.filter((f) => TABLES.test(fs.readFileSync(f, "utf8")) && !allowed(rel(f))).map(rel);
  eq("only the church workspace code references the four private tables (no public page, API, AI context, analytics, push or log code)", offenders, []);
  const churchCode = files.filter((f) => allowed(rel(f)));
  // line comments FIRST: a comment such as "/api/church/**" must not be mistaken for the start of a block comment
  const noComments = (t) => t.replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
  const bad = (re) => churchCode.filter((f) => re.test(noComments(fs.readFileSync(f, "utf8")))).map(rel);
  eq("no service-role client in church code", bad(/createAdminClient|SUPABASE_SERVICE_ROLE_KEY/), []);
  eq("no has_org_permission / platform-admin helper in church code", bad(/has_org_permission|getOrgAccess|requireOrgAccess|assertAdmin|is_admin/), []);
  eq("no select(\"*\") on a church table", bad(/select\(\s*["'`]\*["'`]/), []);
  eq("no export / download / csv code", bad(/\bcsv\b|text\/csv|Content-Disposition|\.xlsx|church\.export/i), []);
  eq("no raw SQL / rpc from church code", bad(/\.rpc\(|\bexecute_sql\b/), []);
  eq("no profile id read from a request in the church routes", files.filter((f) => rel(f).startsWith("src/app/api/church/") && /profileId|profile_id|searchParams/.test(fs.readFileSync(f, "utf8").replace(/\/\/.*$/gm, ""))).map(rel), []);
  eq("no use of localStorage / sessionStorage / console.log in church code", bad(/localStorage|sessionStorage|console\.log/), []);
  // the public profile surface is untouched
  const profileFiles = files.filter((f) => /src\/app\/\[username\]|src\/app\/api\/public|src\/components\/profile|src\/lib\/church\/publicPage/.test(f.replace(/\\/g, "/")));
  check("public profile files exist for the check", profileFiles.length > 0);
  eq("public profile / public API code never mentions a private church table or the people routes", profileFiles.filter((f) => TABLES.test(fs.readFileSync(f, "utf8")) || /api\/church\//.test(fs.readFileSync(f, "utf8"))).map(rel), []);
  // executable: what a response contains
  await fresh();
  const r = await call(u.owner1, "GET", "members");
  check("a list response never serialises contact details, ids of accounts or the church id", !/phone|email|user_id|customer_id|profile_id|created_by/.test(JSON.stringify(r.body)), JSON.stringify(r.body).slice(0, 200));
  const d = await call(u.owner1, "GET", "members/[id]", { params: { id: m.admin } });
  check("a detail response carries no account link, church id or creator", !/user_id|customer_id|profile_id|created_by/.test(JSON.stringify(d.body)));
  const gr = await call(u.owner1, "GET", "groups/[id]", { params: { id: g.choir } });
  check("a group response carries no church id or account link", !/user_id|profile_id|created_by/.test(JSON.stringify(gr.body)));
  const ls = await call(u.owner1, "GET", "leadership");
  check("a leadership response carries no church id or creator", !/profile_id|created_by/.test(JSON.stringify(ls.body)));
  const anon = await F.sessionFor(db, null).from("profiles").select("id, category").eq("id", prof.c1);
  check("the public profile row read (anon) exposes no church table column", !anon.error && (anon.data || []).every((x) => !("church_members" in x)));
}

// =================================================================================================================================================================
console.error = realConsoleError;
try { fs.rmSync(stubDir, { recursive: true, force: true }); } catch { /* ignore */ }
console.log(`\n${fail === 0 ? "OK" : "FAILED"}: ${pass} checks passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
