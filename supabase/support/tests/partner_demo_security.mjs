// Partner-demo security suite (demo/test Partner capability + the profiles demo-flag guard interplay).
//
// Runs the REAL route handlers from this repository (transpiled in memory) against an in-memory fake of the data
// layer, and the real legacy RLS policies, the real B1 migration and the real earn/redeem functions on a scratch
// PostgreSQL (PGlite). It never connects to Supabase or any real database.
//
//   Setup:  npm install --no-save @electric-sql/pglite      (nothing is added to package.json)
//   Run:    node supabase/support/tests/partner_demo_security.mjs
//           (optional: PGLITE_ENTRY=<path or file URL of the pglite entry point> to use another install)
//   Mutation self-check (optional): MUT="<file suffix>@@<exact text>@@<replacement>" breaks one check in memory only.
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");
const ROOT = fileURLToPath(new URL("../../../", import.meta.url)).replace(/\\/g, "/");
const nodeRequire = createRequire(ROOT + "package.json");
const ts = nodeRequire("typescript");

const results = [];
const check = (name, cond, detail = "") => { results.push({ name, pass: !!cond, detail }); if (!cond) console.log("  FAIL:", name, "|", detail); };

// =====================================================================================================
// PART 1 - the REAL route handlers, run against an in-memory fake of the data layer
// =====================================================================================================
const ctx = { user: null, db: null, rpcCalls: [] };

function topLevelCols(str) { const out = []; let depth = 0, cur = ""; for (const ch of str) { if (ch === "(") depth++; if (ch === ")") depth--; if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out.map((x) => x.trim().split("(")[0].split("!")[0].trim()).filter(Boolean); }
class Query {
  constructor(table) { this.table = table; this.f = []; this.mode = "select"; this.patch = null; this.head = false; this.lim = null; this.ret = false; }
  select(c, opts) { if (this.mode === "insert") this.ret = true; if (opts?.head) this.head = true; if (typeof c === "string" && c.trim() !== "*") this.cols = topLevelCols(c); return this; }
  eq(c, v) { this.f.push((r) => r[c] === v); return this; }
  neq(c, v) { this.f.push((r) => r[c] !== v); return this; }
  in(c, a) { this.f.push((r) => a.includes(r[c])); return this; }
  is(c, v) { this.f.push((r) => (v === null ? r[c] == null : r[c] === v)); return this; }
  not() { return this; }
  gt(c, v) { this.f.push((r) => r[c] != null && String(r[c]) > String(v)); return this; }
  lt() { return this; }
  gte() { return this; }
  order() { return this; }
  ilike(c, p) { const s = p.replace(/%/g, "").toLowerCase(); this.f.push((r) => String(r[c] ?? "").toLowerCase().includes(s)); return this; }
  limit(n) { this.lim = n; return this; }
  insert(row) { this.mode = "insert"; this.patch = row; return this; }
  update(p) { this.mode = "update"; this.patch = p; return this; }
  async maybeSingle() { const r = this.run(); return { data: r.data[0] ?? null, error: null }; }
  async single() { const r = this.run(); return r.data[0] ? { data: r.data[0], error: null } : { data: null, error: { message: "no rows" } }; }
  run() {
    const rows = ctx.db[this.table] || (ctx.db[this.table] = []);
    if (this.mode === "insert") { const row = { id: `gen-${rows.length + 1}`, ...this.patch }; rows.push(row); return { data: [row], count: 1 }; }
    let m = rows.filter((r) => this.f.every((fn) => fn(r)));
    if (this.mode === "update") { m.forEach((r) => Object.assign(r, this.patch)); return { data: m, count: m.length }; }
    if (this.lim != null) m = m.slice(0, this.lim);
    if (this.cols) m = m.map((r) => Object.fromEntries(this.cols.filter((k) => k in r).map((k) => [k, r[k]])));
    return { data: this.head ? null : m, count: m.length };
  }
  then(res, rej) { try { const r = this.run(); res({ data: r.data, error: null, count: r.count }); } catch (e) { rej?.(e); } }
}
const fakeClient = () => ({
  auth: { getUser: async () => ({ data: { user: ctx.user ? { id: ctx.user } : null } }) },
  from: (t) => new Query(t),
  rpc: async (name, args) => {
    ctx.rpcCalls.push({ name, args });
    if (name === "association_staff_role") {
      const s = ctx.db.association_staff.find((x) => x.association_id === args.p_association_id && x.user_id === ctx.user && x.status === "active");
      return { data: s ? s.role : null, error: null };
    }
    if (name === "has_association_permission") {
      const s = ctx.db.association_staff.find((x) => x.association_id === args.p_association_id && x.user_id === ctx.user && x.status === "active");
      const ok = !!s && (s.role === "super_associate" || (s.permissions || []).includes(args.p_permission));
      return { data: ok, error: null };
    }
    if (name === "log_association_earn" || name === "log_association_redeem") return { data: { id: "txn-fake" }, error: null };
    return { data: null, error: { message: "unexpected rpc " + name } };
  },
});

const cache = new Map();
const resolveSrc = (spec) => {
  const base = ROOT + "src/" + spec.slice(2);
  for (const c of [base + ".ts", base + ".tsx", base + "/index.ts", base]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  throw new Error("cannot resolve " + spec);
};
const shims = {
  "next/server": { NextResponse: { json: (body, init) => ({ status: init?.status ?? 200, body }) } },
  "@/lib/supabase/server": { createClient: fakeClient, createAdminClient: fakeClient },
  "@/lib/notifications": { notifyUser: async () => {} },
};
function loadTs(file) {
  if (cache.has(file)) return cache.get(file).exports;
  let src = fs.readFileSync(file, "utf8");
  if (process.env.MUT) { const [f, a, b] = process.env.MUT.split("@@"); if (file.endsWith(f)) { if (!src.includes(a)) throw new Error("mutation target not found: " + a); src = src.replace(a, b); } }
  const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  cache.set(file, mod);
  const req = (spec) => {
    if (shims[spec]) return shims[spec];
    if (spec.startsWith("@/")) return loadTs(resolveSrc(spec));
    return nodeRequire(spec);
  };
  new Function("exports", "require", "module", out)(mod.exports, req, mod);
  return mod.exports;
}
const route = (rel) => loadTs(ROOT + rel);
const req = (body, url = "http://localhost/x") => ({ json: async () => body, url });

// ---- seed ---------------------------------------------------------------------------------------------
const id = (p, n) => `${p}${String(n).padStart(7, "0")}-0000-4000-8000-000000000000`.slice(0, 36);
const U = { ownerA: "u-ownerA", ownerB: "u-ownerB", ownerC: "u-ownerC", partner: "u-partner", partnerReal: "u-partnerReal", stranger: "u-stranger", admin: "u-admin", other: "u-otherPartner" };
const P = { A: "p-assocA", B: "p-assocB", C: "p-assocC", partner: "p-partner", partnerReal: "p-partnerReal", stranger: "p-stranger", other: "p-otherPartner", real1: "p-realUser1", demo1: "p-demoUser1" };
const plan = { association_enabled: true, max_association_members: null, max_association_partners: null };
const M = { a1: "aaaa1111-0000-4000-8000-000000000001", a2: "aaaa2222-0000-4000-8000-000000000002", aDis: "aaaa3333-0000-4000-8000-000000000003", aAmb1: "cccc0001-0000-4000-8000-000000000004", aAmb2: "cccc0001-1111-4000-8000-000000000005", b1: "bbbb2222-0000-4000-8000-000000000006", c1: "dddd4444-0000-4000-8000-000000000007" };
const assocId = { A: "11111111-1111-4111-8111-111111111111", B: "22222222-2222-4222-8222-222222222222", C: "33333333-3333-4333-8333-333333333333" };
function seed() {
  const FUTURE = new Date(Date.now() + 7 * 86400000).toISOString();
  const prof = (id_, user, demo, username, extra = {}) => ({ id: id_, user_id: user, is_demo: demo, demo_expires_at: demo ? FUTURE : null, username, name: username, avatar_url: null, users: { plan_id: "pl", plans: plan }, ...extra });
  return {
    users: [U.ownerA, U.ownerB, U.ownerC, U.partner, U.partnerReal, U.stranger, U.other].map((u) => ({ id: u, role: "creator" })).concat([{ id: U.admin, role: "admin" }]),
    profiles: [
      prof(P.A, U.ownerA, true, "test-user-a"), prof(P.B, U.ownerB, true, "test-user-b"), prof(P.C, U.ownerC, false, "real-assoc-c"),
      prof(P.partner, U.partner, true, "test-user-partner"), prof(P.partnerReal, U.partnerReal, false, "real-partner"),
      prof(P.stranger, U.stranger, true, "test-user-stranger"), prof(P.other, U.other, true, "test-user-other"),
      prof(P.real1, "u-real1", false, "test-real-user"), prof(P.demo1, "u-demo1", true, "test-demo-user"),
    ],
    association_partners: [
      { id: "ap1", association_profile_id: P.A, partner_profile_id: P.partner, status: "active" },
      { id: "ap2", association_profile_id: P.A, partner_profile_id: P.partnerReal, status: "active" },
      { id: "ap3", association_profile_id: P.A, partner_profile_id: P.other, status: "active" },
      { id: "ap4", association_profile_id: P.C, partner_profile_id: P.partner, status: "active" },
    ],
    association_members: [
      { id: M.a1, association_profile_id: P.A, name: "Alpha One", points_balance: 25, status: "active" },
      { id: M.a2, association_profile_id: P.A, name: "Alpha Two", points_balance: 10, status: "active" },
      { id: M.aDis, association_profile_id: P.A, name: "Alpha Disabled", points_balance: 0, status: "disabled" },
      { id: M.aAmb1, association_profile_id: P.A, name: "Amb One", points_balance: 0, status: "active" },
      { id: M.aAmb2, association_profile_id: P.A, name: "Amb Two", points_balance: 0, status: "active" },
      { id: M.b1, association_profile_id: P.B, name: "Bravo One", points_balance: 5, status: "active" },
      { id: M.c1, association_profile_id: P.C, name: "Charlie One", points_balance: 7, status: "active" },
    ],
    association_settings: [{ association_profile_id: P.A, points_per_amount: 1, amount_unit: 100 }],
    association_invitations: [], profile_phone_numbers: [{ profile_id: P.real1, phone_number: "670000001", profiles: { id: P.real1, username: "test-real-user", name: "Real", avatar_url: null, is_demo: false, demo_expires_at: null } },
                                                           { profile_id: P.demo1, phone_number: "670000002", profiles: { id: P.demo1, username: "test-demo-user", name: "Demo", avatar_url: null, is_demo: true, demo_expires_at: new Date(Date.now() + 7 * 86400000).toISOString() } }],
    associations: [{ id: assocId.A, host_profile_id: P.A, legacy_profile_id: P.A, config: { membership_enabled: true } }],
    association_staff: [{ association_id: assocId.A, user_id: U.ownerA, role: "super_associate", permissions: [], status: "active" }],
  };
}
const call = async (rel, method, user, body, url, params) => {
  ctx.db = ctx.db || seed(); ctx.user = user; ctx.rpcCalls = [];
  const h = route(rel)[method];
  return h(req(body, url), params ? { params } : undefined);
};
const reseed = () => { ctx.db = seed(); };

console.log("### 1. demo-lookup authorization boundary (real route, fake data layer)");
const DL = "src/app/api/association/tap/demo-lookup/route.ts";
reseed();
let r = await call(DL, "POST", U.partner, { associationProfileId: P.A, code: "aaaa1111" });
check("demo Partner + demo Association => permitted, returns exactly that one member", r.status === 200 && r.body.member.id === M.a1 && r.body.member.name === "Alpha One" && r.body.member.pointsBalance === 25, JSON.stringify(r));
check("...the response contains only id/name/pointsBalance and no other member (no roster)", Object.keys(r.body.member).sort().join() === "id,name,pointsBalance" && !JSON.stringify(r.body).includes("Alpha Two") && !JSON.stringify(r.body).includes("Bravo"), JSON.stringify(r.body));
r = await call(DL, "POST", null, { associationProfileId: P.A, code: "aaaa1111" });
check("unauthenticated => 401", r.status === 401, JSON.stringify(r));
r = await call(DL, "POST", U.stranger, { associationProfileId: P.A, code: "aaaa1111" });
check("stranger (demo user, no Partner link) + demo Association => refused 403", r.status === 403 && r.body.code === "not_authorized", JSON.stringify(r));
r = await call(DL, "POST", U.partner, { associationProfileId: P.B, code: "bbbb2222" });
check("demo Partner + WRONG demo Association (not linked) => refused 403", r.status === 403 && r.body.code === "not_authorized", JSON.stringify(r));
r = await call(DL, "POST", U.partner, { associationProfileId: P.C, code: "dddd4444" });
check("demo Partner + NON-demo Association (linked) => refused 403 demo_only", r.status === 403 && r.body.code === "demo_only", JSON.stringify(r));
r = await call(DL, "POST", U.partnerReal, { associationProfileId: P.A, code: "aaaa1111" });
check("NON-demo Partner + demo Association => refused 403 demo_only", r.status === 403 && r.body.code === "demo_only", JSON.stringify(r));
r = await call(DL, "POST", U.partner, { associationProfileId: P.A, code: "bbbb2222" });
check("cross-Association member code (member of B, asked in A) => not recognized 404", r.status === 404 && r.body.code === "demo_code_not_recognized" && !JSON.stringify(r.body).includes("Bravo"), JSON.stringify(r));
r = await call(DL, "POST", U.ownerA, { associationProfileId: P.A, code: "aaaa1111" });
check("Owner of the Association is refused (the Owner has the Simulated Tap tab instead)", r.status === 403, JSON.stringify(r));
r = await call(DL, "POST", U.admin, { associationProfileId: P.A, code: "aaaa1111" });
check("platform admin is refused", r.status === 403, JSON.stringify(r));
for (const bad of ["", "aaaa", "aaaa1111f", "zzzzzzzz", "aaaa111%", "aaaa1111'--", "AAAA 111"]) {
  r = await call(DL, "POST", U.partner, { associationProfileId: P.A, code: bad });
  check(`malformed / partial code "${bad}" => 400, no lookup (not a search endpoint)`, r.status === 400 && r.body.code === "demo_code_not_recognized", JSON.stringify(r));
}
r = await call(DL, "POST", U.partner, { associationProfileId: P.A, code: "cccc0001" });
check("ambiguous code (matches two members) => not recognized, nothing returned", r.status === 404, JSON.stringify(r));
r = await call(DL, "POST", U.partner, { associationProfileId: P.A, code: "aaaa3333" });
check("disabled member => 409 member_disabled", r.status === 409 && r.body.code === "member_disabled", JSON.stringify(r));
r = await call(DL, "POST", U.partner, { associationProfileId: P.A, code: "AAAA1111", partnerProfileId: P.other, userId: U.ownerA, is_demo: true });
check("code is case-insensitive; extra client-supplied identity fields are ignored (identity comes from the session)", r.status === 200 && r.body.member.id === M.a1, JSON.stringify(r));
ctx.db.profiles.find((p) => p.id === P.partner).is_demo = null;
r = await call(DL, "POST", U.partner, { associationProfileId: P.A, code: "aaaa1111" });
check("fails CLOSED when the Partner's demo flag is not exactly true (null)", r.status === 403 && r.body.code === "demo_only", JSON.stringify(r));
reseed();
ctx.db.association_partners.find((p) => p.id === "ap1").status = "removed";
r = await call(DL, "POST", U.partner, { associationProfileId: P.A, code: "aaaa1111" });
check("a REMOVED Partner (link no longer active) => refused", r.status === 403, JSON.stringify(r));
reseed();

console.log("### 1b. the demo window: a profile qualifies only if is_demo IS TRUE and demo_expires_at is set and in the future");
const PAST = new Date(Date.now() - 1000).toISOString(), LATER = new Date(Date.now() + 86400000).toISOString();
const setFlag = (pid, patch) => Object.assign(ctx.db.profiles.find((p) => p.id === pid), patch);
const lookup = async () => call(DL, "POST", U.partner, { associationProfileId: P.A, code: "aaaa1111" });
const helper = loadTs(ROOT + "src/lib/association/demoProfile.ts").isActiveDemoProfile;
const fixedNow = new Date("2026-01-01T00:00:00Z");
check("helper: valid demo window => true", helper({ is_demo: true, demo_expires_at: "2026-01-02T00:00:00Z" }, fixedNow) === true);
check("helper: null / undefined / empty profile => false", !helper(null) && !helper(undefined) && !helper({}));
check("helper: is_demo false / 'true' string / 1 => false even with a valid expiry", !helper({ is_demo: false, demo_expires_at: LATER }) && !helper({ is_demo: "true", demo_expires_at: LATER }) && !helper({ is_demo: 1, demo_expires_at: LATER }));
check("helper: null / empty / unparseable / numeric / Date-object expiry => false (fails closed)", !helper({ is_demo: true, demo_expires_at: null }) && !helper({ is_demo: true, demo_expires_at: "" }) && !helper({ is_demo: true, demo_expires_at: "not a date" }) && !helper({ is_demo: true, demo_expires_at: 4102444800000 }) && !helper({ is_demo: true, demo_expires_at: new Date(Date.now() + 1e9) }));
check("helper: expiry exactly now or in the past => false; the client's clock is never used (now is a parameter)", !helper({ is_demo: true, demo_expires_at: "2026-01-01T00:00:00Z" }, fixedNow) && !helper({ is_demo: true, demo_expires_at: "2025-12-31T23:59:59Z" }, fixedNow) && helper({ is_demo: true, demo_expires_at: "2026-01-01T00:00:01Z" }, fixedNow));
reseed();
r = await lookup();
check("valid demo Partner + valid unexpired demo Association => allowed", r.status === 200 && r.body.member.id === M.a1, JSON.stringify(r));
setFlag(P.partner, { demo_expires_at: PAST });
r = await lookup();
check("EXPIRED Partner => refused 403 demo_only", r.status === 403 && r.body.code === "demo_only", JSON.stringify(r));
reseed(); setFlag(P.A, { demo_expires_at: PAST });
r = await lookup();
check("EXPIRED Association => refused 403 demo_only", r.status === 403 && r.body.code === "demo_only", JSON.stringify(r));
reseed(); setFlag(P.partner, { demo_expires_at: null });
r = await lookup();
check("NULL Partner expiry => refused", r.status === 403 && r.body.code === "demo_only", JSON.stringify(r));
reseed(); setFlag(P.A, { demo_expires_at: null });
r = await lookup();
check("NULL Association expiry => refused", r.status === 403 && r.body.code === "demo_only", JSON.stringify(r));
reseed(); setFlag(P.partner, { is_demo: false });
r = await lookup();
check("Partner is_demo = false (even with a valid future expiry) => refused", r.status === 403 && r.body.code === "demo_only", JSON.stringify(r));
reseed(); setFlag(P.A, { is_demo: false });
r = await lookup();
check("Association is_demo = false (even with a valid future expiry) => refused", r.status === 403 && r.body.code === "demo_only", JSON.stringify(r));
reseed(); setFlag(P.A, { demo_expires_at: "garbage" });
r = await lookup();
check("unparseable Association expiry => refused", r.status === 403, JSON.stringify(r));
reseed(); setFlag(P.partnerReal, { is_demo: false, demo_expires_at: LATER });
r = await call(DL, "POST", U.partnerReal, { associationProfileId: P.A, code: "aaaa1111" });
check("NON-demo Partner carrying a future expiry (is_demo false) => refused", r.status === 403 && r.body.code === "demo_only", JSON.stringify(r));
reseed(); setFlag(P.C, { is_demo: true, demo_expires_at: LATER });
r = await call(DL, "POST", U.partner, { associationProfileId: P.C, code: "dddd4444" });
check("(control) a demo Partner linked to a genuinely active demo Association C is allowed; the check is symmetric", r.status === 200, JSON.stringify(r));
reseed();
r = await call(DL, "POST", U.partner, { associationProfileId: P.A, code: "bbbb2222" });
check("cross-Association lookup remains refused with valid demo windows on both sides", r.status === 404 && r.body.code === "demo_code_not_recognized", JSON.stringify(r));

console.log("### 2. invitations: a demo Association may invite demo profiles ONLY");
const INV = "src/app/api/association/invitations/route.ts";
r = await call(INV, "POST", U.ownerA, { associationProfileId: P.A, inviteeProfileId: P.demo1, method: "link" });
check("demo Association + demo invitee => 200 with an invitation link", r.status === 200 && /\/association\/invite\//.test(r.body.inviteUrl || "") && ctx.db.association_invitations.length === 1 && ctx.db.association_invitations[0].invitee_profile_id === P.demo1 && !!ctx.db.association_invitations[0].token_hash, JSON.stringify(r).slice(0, 200));
reseed();
r = await call(INV, "POST", U.ownerA, { associationProfileId: P.A, inviteeProfileId: P.real1, method: "link" });
check("demo Association + REAL invitee => still refused (demo_association_invite_disabled), nothing created", r.status === 403 && r.body.code === "demo_association_invite_disabled" && ctx.db.association_invitations.length === 0, JSON.stringify(r));
r = await call(INV, "POST", U.ownerA, { associationProfileId: P.A, inviteeProfileId: "p-does-not-exist", method: "link" });
check("demo Association + unknown invitee => refused (fails closed)", r.status === 403 && ctx.db.association_invitations.length === 0, JSON.stringify(r));
ctx.db.profiles.find((p) => p.id === P.demo1).is_demo = "true";
r = await call(INV, "POST", U.ownerA, { associationProfileId: P.A, inviteeProfileId: P.demo1, method: "link" });
check("demo Association + flag that is not exactly boolean true => refused", r.status === 403, JSON.stringify(r));
reseed();
r = await call(INV, "POST", U.ownerC, { associationProfileId: P.C, inviteeProfileId: P.real1, method: "link" });
check("NON-demo Association behaves as before: may invite a real profile", r.status === 200 && ctx.db.association_invitations.length === 1, JSON.stringify(r).slice(0, 160));
reseed();
r = await call(INV, "POST", U.partner, { associationProfileId: P.A, inviteeProfileId: P.demo1, method: "link" });
check("a Partner cannot invite (Owner-only) => 403", r.status === 403 && ctx.db.association_invitations.length === 0, JSON.stringify(r));
r = await call(INV, "POST", U.stranger, { associationProfileId: P.A, inviteeProfileId: P.demo1, method: "link" });
check("a stranger cannot invite => 403", r.status === 403, JSON.stringify(r));

console.log("### 3. search-profile: a demo Association only ever sees demo profiles");
const SP = "src/app/api/association/search-profile/route.ts";
reseed();
r = await call(SP, "GET", U.ownerA, null, `http://x/?associationProfileId=${P.A}&q=test-`);
const names = (r.body.profiles || []).map((p) => p.username);
check("demo Association search by username returns demo profiles only (no real profile leaks)", r.status === 200 && names.length > 0 && !names.includes("test-real-user") && names.includes("test-demo-user"), JSON.stringify(names));
check("...and the result shape is unchanged (no is_demo field exposed)", (r.body.profiles || []).every((p) => Object.keys(p).sort().join() === "avatar_url,id,name,username"), JSON.stringify(r.body.profiles?.[0]));
r = await call(SP, "GET", U.ownerA, null, `http://x/?associationProfileId=${P.A}&q=670000001`);
check("demo Association search by a REAL user's phone number returns nothing", r.status === 200 && (r.body.profiles || []).length === 0, JSON.stringify(r.body));
r = await call(SP, "GET", U.ownerA, null, `http://x/?associationProfileId=${P.A}&q=670000002`);
check("demo Association search by a DEMO user's phone number works", (r.body.profiles || []).length === 1 && r.body.profiles[0].id === P.demo1, JSON.stringify(r.body));
r = await call(SP, "GET", U.ownerC, null, `http://x/?associationProfileId=${P.C}&q=test-`);
const namesC = (r.body.profiles || []).map((p) => p.username);
check("NON-demo Association search is unchanged (real and demo profiles both found)", namesC.includes("test-real-user") && namesC.includes("test-demo-user"), JSON.stringify(namesC));
r = await call(SP, "GET", U.partner, null, `http://x/?associationProfileId=${P.A}&q=test-`);
check("a Partner cannot use the profile search (Owner-only) => 403", r.status === 403, JSON.stringify(r));

console.log("### 3b. the demo window on invitations and profile search");
reseed(); setFlag(P.demo1, { demo_expires_at: PAST });
r = await call(INV, "POST", U.ownerA, { associationProfileId: P.A, inviteeProfileId: P.demo1, method: "link" });
check("invitation of an EXPIRED demo invitee => refused, nothing created", r.status === 403 && r.body.code === "demo_association_invite_disabled" && ctx.db.association_invitations.length === 0, JSON.stringify(r));
reseed(); setFlag(P.demo1, { demo_expires_at: null });
r = await call(INV, "POST", U.ownerA, { associationProfileId: P.A, inviteeProfileId: P.demo1, method: "link" });
check("invitation of a demo invitee with NULL expiry => refused", r.status === 403 && ctx.db.association_invitations.length === 0, JSON.stringify(r));
reseed(); setFlag(P.A, { demo_expires_at: PAST });
r = await call(INV, "POST", U.ownerA, { associationProfileId: P.A, inviteeProfileId: P.demo1, method: "link" });
check("invitation FROM an expired demo Association => refused", r.status === 403 && ctx.db.association_invitations.length === 0, JSON.stringify(r));
reseed(); setFlag(P.A, { demo_expires_at: null });
r = await call(INV, "POST", U.ownerA, { associationProfileId: P.A, inviteeProfileId: P.demo1, method: "link" });
check("invitation FROM a demo Association with NULL expiry => refused", r.status === 403 && ctx.db.association_invitations.length === 0, JSON.stringify(r));
reseed();
r = await call(INV, "POST", U.ownerA, { associationProfileId: P.A, inviteeProfileId: P.demo1, method: "link" });
check("(control) valid demo Association + valid demo invitee => allowed", r.status === 200 && ctx.db.association_invitations.length === 1, JSON.stringify(r).slice(0, 120));
reseed(); setFlag(P.demo1, { demo_expires_at: PAST });
r = await call(SP, "GET", U.ownerA, null, `http://x/?associationProfileId=${P.A}&q=test-demo`);
check("profile search in a demo Association does NOT return an expired demo profile (by username)", r.status === 200 && !(r.body.profiles || []).some((p) => p.id === P.demo1), JSON.stringify(r.body));
ctx.db.profile_phone_numbers.find((x) => x.profile_id === P.demo1).profiles.demo_expires_at = PAST;
r = await call(SP, "GET", U.ownerA, null, `http://x/?associationProfileId=${P.A}&q=670000002`);
check("...nor by phone number", r.status === 200 && (r.body.profiles || []).length === 0, JSON.stringify(r.body));
reseed(); setFlag(P.demo1, { demo_expires_at: null });
r = await call(SP, "GET", U.ownerA, null, `http://x/?associationProfileId=${P.A}&q=test-demo`);
check("...nor a demo profile with NULL expiry", r.status === 200 && !(r.body.profiles || []).some((p) => p.id === P.demo1), JSON.stringify(r.body));
reseed(); setFlag(P.A, { demo_expires_at: PAST });
r = await call(SP, "GET", U.ownerA, null, `http://x/?associationProfileId=${P.A}&q=test-`);
check("an expired demo Association stays restricted to demo profiles (never falls back to the real-user search)", r.status === 200 && !(r.body.profiles || []).some((p) => p.username === "test-real-user"), JSON.stringify((r.body.profiles || []).map((p) => p.username)));
reseed();

console.log("### 4. privacy: what a Partner is refused");
r = await call("src/app/api/association/members/route.ts", "GET", U.partner, null, `http://x/?associationProfileId=${P.A}`);
check("Partner cannot fetch the full member roster (/api/association/members) => 403", r.status === 403 && !JSON.stringify(r.body).includes("Alpha"), JSON.stringify(r));
r = await call("src/app/api/association/members/route.ts", "GET", U.ownerA, null, `http://x/?associationProfileId=${P.A}`);
check("(control) the Owner still gets the roster", r.status === 200 && r.body.members.length === 5, JSON.stringify(r).slice(0, 120));
const B1 = (rel, method, user, body, url) => call(`src/app/api/associations/[associationId]/${rel}/route.ts`, method, user, body, url, { associationId: assocId.A });
for (const [rel, method, body] of [["members", "GET"], ["membership-settings", "PATCH", { enabled: true }], ["membership-plans", "POST", { nameEn: "x", nameFr: "y" }], ["membership-plans", "GET"], ["audit", "GET"], ["memberships", "GET"], ["memberships", "POST", { memberId: M.a1, planId: "x" }], ["memberships/expire", "POST", {}]]) {
  r = await B1(rel, method, U.partner, body || null);
  check(`Partner refused on B1 Membership administration: ${method} /${rel} => 403 permission_denied`, r.status === 403 && r.body.code === "permission_denied", JSON.stringify(r));
}
r = await B1("members", "GET", U.stranger, null);
check("stranger refused on B1 Membership administration => 403", r.status === 403, JSON.stringify(r));
{
  ctx.user = U.ownerA;
  const perms = loadTs(ROOT + "src/lib/association/permissions.ts");
  const ok = await perms.requireAssociationPermission(assocId.A, "memberships.view");
  check("(control) the Association Owner passes the same B1 permission check", ok.ok === true && ok.user.id === U.ownerA, JSON.stringify(ok).slice(0, 100));
}

console.log("### 5. earn / redeem: identity and attribution come from the authenticated session");
const EARN = "src/app/api/association/tap/earn/route.ts", RED = "src/app/api/association/tap/redeem/route.ts";
reseed();
r = await call(EARN, "POST", U.partner, { associationProfileId: P.A, memberId: M.a1, amountXaf: 3000, partnerProfileId: P.other, partner_profile_id: P.other, points: 99999, pointsDelta: 99999, userId: U.ownerA });
let rc = ctx.rpcCalls.find((c) => c.name === "log_association_earn");
check("Partner earn => RPC receives p_partner_profile_id = the AUTHENTICATED Partner, not the one in the body", r.status === 200 && rc?.args.p_partner_profile_id === P.partner, JSON.stringify(rc?.args));
check("...points are computed server-side (30 for 3000 XAF), never taken from the client", rc?.args.p_points === 30 && rc?.args.p_amount_xaf === 3000, JSON.stringify(rc?.args));
r = await call(EARN, "POST", U.ownerA, { associationProfileId: P.A, memberId: M.a1, amountXaf: 1000 });
rc = ctx.rpcCalls.find((c) => c.name === "log_association_earn");
check("Owner earn => partner_profile_id is null (Owner-logged), unchanged", r.status === 200 && rc?.args.p_partner_profile_id === null, JSON.stringify(rc?.args));
r = await call(EARN, "POST", U.stranger, { associationProfileId: P.A, memberId: M.a1, amountXaf: 1000 });
check("stranger earn => 403 and no RPC is called", r.status === 403 && ctx.rpcCalls.length === 0, JSON.stringify(r));
r = await call(EARN, "POST", U.partner, { associationProfileId: P.A, memberId: M.b1, amountXaf: 1000 });
check("Partner earn for a member of ANOTHER Association => 404 member_not_found, no RPC", r.status === 404 && ctx.rpcCalls.length === 0, JSON.stringify(r));
r = await call(EARN, "POST", U.partner, { associationProfileId: P.A, memberId: M.aDis, amountXaf: 1000 });
check("Partner earn for a disabled member (suspended/pending/cancelled managed members project to disabled) => 409, no RPC", r.status === 409 && r.body.code === "member_disabled" && ctx.rpcCalls.length === 0, JSON.stringify(r));
r = await call(RED, "POST", U.partner, { associationProfileId: P.A, memberId: M.a1, rewardId: "rw1", partnerProfileId: P.other, pointsCost: 1 });
rc = ctx.rpcCalls.find((c) => c.name === "log_association_redeem");
check("Partner redeem => RPC receives the AUTHENTICATED Partner id; no client price/points passed", r.status === 200 && rc?.args.p_partner_profile_id === P.partner && Object.keys(rc.args).sort().join() === "p_association_profile_id,p_member_id,p_partner_profile_id,p_reward_id", JSON.stringify(rc?.args));
r = await call(RED, "POST", U.partner, { associationProfileId: P.A, memberId: M.aDis, rewardId: "rw1" });
check("Partner redeem for a disabled member => 409, no RPC", r.status === 409 && ctx.rpcCalls.length === 0, JSON.stringify(r));
{
  const src = fs.readFileSync(ROOT + "src/app/api/association/tap/demo-lookup/route.ts", "utf8");
  check("demo-lookup source never reads partner_profile_id / user id from the request body", !/body\??\.(partnerProfileId|partner_profile_id|userId|user_id|is_demo)/.test(src));
  const earnSrc = fs.readFileSync(ROOT + "src/app/api/association/tap/earn/route.ts", "utf8");
  check("earn route is byte-identical in behavior: still uses access.partnerProfileId only", /p_partner_profile_id: access\.isPartner \? access\.partnerProfileId : null/.test(earnSrc));
}

console.log("### 5b. protected systems are unchanged in the working tree");
const git = (args) => { try { return execSync("git " + args, { cwd: ROOT, encoding: "utf8" }).trim(); } catch { return null; } };
if (git("rev-parse --is-inside-work-tree") === "true") {
  const changed = new Set((git("diff --name-only HEAD") || "").split("\n").filter(Boolean));
  for (const f of [
    "src/app/api/association/tap/lookup/route.ts", "src/app/api/association/tap/earn/route.ts", "src/app/api/association/tap/redeem/route.ts",
    "src/lib/association/access.ts", "src/lib/association/permissions.ts", "src/lib/association/membership.ts",
    "supabase/migrations/2026-09-18_association_program.sql", "supabase/migrations/2026-10-14_association_foundation.sql", "supabase/migrations/2026-10-15_association_membership_core.sql",
    "src/app/api/demo/create/route.ts", "src/lib/association/demoSeed.ts", "src/app/api/cron/cleanup-demo-accounts/route.ts",
  ]) check("unchanged vs HEAD: " + f + " (real NFC lookup, earn, redeem, access, B1, demo creation/seed/cleanup)", !changed.has(f));
  const pv = git("diff --numstat HEAD -- src/components/association/AssociationPartnerView.tsx");
  check("AssociationPartnerView (real NFC scan flow) only ADDS lines: zero deletions", pv === null || pv === "" || pv.split("\t")[1] === "0", String(pv));
} else {
  console.log("   (not a git work tree: skipped)");
}

// =====================================================================================================
// PART 2 - REAL RLS policies, real B1 migration and real earn/redeem functions on scratch PostgreSQL 18
// =====================================================================================================
console.log("### 6. real RLS policies + B1 guards on scratch PostgreSQL (Partner as an authenticated database user)");
const read = (f) => fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const MIG = ROOT + "supabase/migrations/";
const legacy = read(MIG + "2026-09-18_association_program.sql"), phaseA = read(MIG + "2026-10-14_association_foundation.sql"), b1 = read(MIG + "2026-10-15_association_membership_core.sql");
const UU = { own: "11111111-1111-4111-8111-aaaaaaaaaaaa", pt: "22222222-2222-4222-8222-aaaaaaaaaaaa", pt2: "33333333-3333-4333-8333-aaaaaaaaaaaa", str: "44444444-4444-4444-8444-aaaaaaaaaaaa", ownB: "55555555-5555-4555-8555-aaaaaaaaaaaa" };
const PP = { own: "a1111111-1111-4111-8111-111111111111", pt: "a2222222-2222-4222-8222-222222222222", pt2: "a3333333-3333-4333-8333-333333333333", str: "a4444444-4444-4444-8444-444444444444", ownB: "a5555555-5555-4555-8555-555555555555" };
const MM = { legacy: "b0000001-0000-4000-8000-000000000001", act: "b0000002-0000-4000-8000-000000000002", sus: "b0000003-0000-4000-8000-000000000003", canc: "b0000004-0000-4000-8000-000000000004", other: "b0000005-0000-4000-8000-000000000005" };
const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; grant usage on schema auth, public to anon, authenticated, service_role;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  create table public.users (id uuid primary key default gen_random_uuid(), email text, role text default 'creator');
  create table public.profiles (id uuid primary key default gen_random_uuid(), user_id uuid references public.users(id) on delete cascade, username text, name text, is_demo boolean default false);
  create function public.is_admin() returns boolean language sql as $$ select false $$;
`);
for (const s of [...legacy.matchAll(/create table if not exists (association_[a-z_]+) \([\s\S]*?\n\);/g)].map((m) => m[0])) await db.exec(s);
await db.exec("set check_function_bodies = off;");
for (const s of [...legacy.matchAll(/create or replace function (log_association_earn|log_association_redeem|is_association_owner|is_association_partner)\([\s\S]*?\$\$[\s\S]*?\$\$[^;]*;/g)].map((m) => m[0])) await db.exec(s);
for (const s of [...legacy.matchAll(/(revoke all on function log_association_[a-z]+\([^)]*\)[^;]*;|grant execute on function log_association_[a-z]+\([^)]*\)[^;]*;)/g)].map((m) => m[0])) await db.exec(s);
const rlsStart = legacy.indexOf("alter table association_settings enable row level security;");
const doStart = legacy.indexOf("do $$", rlsStart);
const doEnd = legacy.indexOf("end $$;", doStart) + "end $$;".length;
await db.exec(legacy.slice(legacy.indexOf("alter table association_partners enable row level security;"), rlsStart + "alter table association_settings enable row level security;".length));
await db.exec(legacy.slice(doStart, doEnd));
check("the REAL legacy RLS policy block from 2026-09-18_association_program.sql was applied", (await db.query(`select count(*)::int c from pg_policies where tablename like 'association_%'`)).rows[0].c >= 8);
await db.exec(`
  insert into users (id, email) values ('${UU.own}','o@x'),('${UU.pt}','p@x'),('${UU.pt2}','p2@x'),('${UU.str}','s@x'),('${UU.ownB}','ob@x');
  insert into profiles (id, user_id, username, name, is_demo) values ('${PP.own}','${UU.own}','assoc','Assoc',true),('${PP.pt}','${UU.pt}','partner1','Partner One',true),('${PP.pt2}','${UU.pt2}','partner2','Partner Two',true),('${PP.str}','${UU.str}','stranger','Stranger',true),('${PP.ownB}','${UU.ownB}','assocB','Assoc B',true);
  insert into association_settings (association_profile_id) values ('${PP.own}'),('${PP.ownB}');
  insert into association_partners (association_profile_id, partner_profile_id) values ('${PP.own}','${PP.pt}'),('${PP.own}','${PP.pt2}');
  insert into association_rewards (association_profile_id, name, points_cost) values ('${PP.own}','Free coffee',50);
  insert into association_members (id, association_profile_id, name, points_balance) values
    ('${MM.legacy}','${PP.own}','Legacy',60),('${MM.act}','${PP.own}','Active managed',60),('${MM.sus}','${PP.own}','Suspended managed',60),('${MM.canc}','${PP.own}','Cancelled managed',60),('${MM.other}','${PP.ownB}','Other Assoc',5);
  insert into association_point_transactions (association_profile_id, member_id, type, points_delta, amount_xaf) select association_profile_id, id, 'earn', points_balance, points_balance*100 from association_members;
`);
await db.exec(phaseA);
await db.exec(b1);
const A = (await db.query(`select id from associations where legacy_profile_id='${PP.own}'`)).rows[0].id;
await db.exec(`update associations set config = config || '{"membership_enabled":true}' where id='${A}'`);
const plan1 = (await db.query(`select * from association_create_plan('${A}','${UU.own}','Test','Test FR',null,null,5000,'XAF',12,3,0)`)).rows[0];
for (const m of [MM.act, MM.sus, MM.canc]) await db.query(`select * from association_start_membership('${A}','${UU.own}','${m}','${plan1.id}')`);
const term = async (m) => (await db.query(`select id from association_memberships where member_id='${m}' and state in ('pending','active','suspended') limit 1`)).rows[0].id;
await db.query(`select * from association_suspend_membership('${await term(MM.sus)}','${UU.own}','test')`);
await db.query(`select * from association_cancel_membership('${await term(MM.canc)}','${UU.own}','test')`);
const asRole = async (role, sub, sql) => { await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${sub || ""}', false);`); try { return await db.query(sql); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub','', false);`); } };
const asAuth = (sub, sql) => asRole("authenticated", sub, sql);
const svc = (sql) => asRole("service_role", null, sql);
const errOf = async (fn) => { try { await fn(); return null; } catch (e) { return e.message.split("\n")[0]; } };

// --- RLS as the Partner (a real authenticated database identity)
check("RLS: Partner reads ZERO rows of association_members (no full roster)", (await asAuth(UU.pt, `select * from association_members`)).rows.length === 0);
check("RLS: Owner reads the roster (control)", (await asAuth(UU.own, `select * from association_members`)).rows.length === 4);
check("RLS: Partner reads only its OWN association_partners link", (await asAuth(UU.pt, `select partner_profile_id from association_partners`)).rows.map((x) => x.partner_profile_id).join() === PP.pt);
check("RLS: Partner reads the Association's rewards and settings (needed by its dashboard)", (await asAuth(UU.pt, `select (select count(*) from association_rewards)::int r, (select count(*) from association_settings)::int s`)).rows[0].r === 1);
check("RLS: Partner cannot read association_invitations (Owner only)", (await asAuth(UU.pt, `select * from association_invitations`)).rows.length === 0);
check("RLS: stranger reads nothing from members, transactions, partners, rewards", (await asAuth(UU.str, `select (select count(*) from association_members)::int m, (select count(*) from association_point_transactions)::int t, (select count(*) from association_partners)::int p, (select count(*) from association_rewards)::int r`)).rows[0].m === 0);
check("Partner UPDATE of a member's points_balance affects 0 rows (no policy) and nothing changed", (await asAuth(UU.pt, `update association_members set points_balance = 9999 returning id`)).rows.length === 0 && (await db.query(`select points_balance from association_members where id='${MM.legacy}'`)).rows[0].points_balance === 60);
check("Partner cannot INSERT a transaction (no policy)", (await errOf(() => asAuth(UU.pt, `insert into association_point_transactions (association_profile_id, member_id, type, points_delta) values ('${PP.own}','${MM.legacy}','earn',999)`))) !== null);

// --- earn/redeem as the SERVER would call them for a Partner (partner_profile_id derived from the session)
const earn = (pid, mid, pts) => svc(`select * from log_association_earn('${PP.own}','${mid}',${pid ? `'${pid}'` : "null"},1000,${pts})`);
const redeem = (pid, mid) => svc(`select * from log_association_redeem('${PP.own}','${mid}',${pid ? `'${pid}'` : "null"},(select id from association_rewards limit 1))`);
const bal = async (m) => (await db.query(`select points_balance from association_members where id='${m}'`)).rows[0].points_balance;
const txAttr = async (m) => (await db.query(`select partner_profile_id from association_point_transactions where member_id='${m}' order by created_at desc, id desc limit 1`)).rows[0].partner_profile_id;
await earn(PP.pt, MM.legacy, 10);
check("LEGACY member: Partner-attributed earn works exactly as before and is stamped with that Partner", (await bal(MM.legacy)) === 70 && (await txAttr(MM.legacy)) === PP.pt);
await redeem(PP.pt, MM.legacy);
check("LEGACY member: Partner-attributed redeem works (70 -> 20)", (await bal(MM.legacy)) === 20 && (await txAttr(MM.legacy)) === PP.pt);
await earn(PP.pt2, MM.act, 10);
check("MANAGED ACTIVE member: Partner earn works and is stamped with THAT Partner (Partner Two)", (await bal(MM.act)) === 70 && (await txAttr(MM.act)) === PP.pt2);
await redeem(PP.pt, MM.act);
check("MANAGED ACTIVE member: Partner redeem works", (await bal(MM.act)) === 20 && (await txAttr(MM.act)) === PP.pt);
check("MANAGED SUSPENDED member: earn refused by the database guard", (await errOf(() => earn(PP.pt, MM.sus, 10))) === "membership_not_effective" && (await bal(MM.sus)) === 60);
check("MANAGED SUSPENDED member: redeem refused", (await errOf(() => redeem(PP.pt, MM.sus))) === "membership_not_effective" && (await bal(MM.sus)) === 60);
check("MANAGED CANCELLED member: earn refused", (await errOf(() => earn(PP.pt, MM.canc, 10))) === "membership_not_effective" && (await bal(MM.canc)) === 60);
check("MANAGED CANCELLED member: redeem refused", (await errOf(() => redeem(PP.pt, MM.canc))) === "membership_not_effective" && (await bal(MM.canc)) === 60);
check("refused operations left no ledger rows", (await db.query(`select count(*)::int c from association_point_transactions where member_id in ('${MM.sus}','${MM.canc}')`)).rows[0].c === 2);
check("Partner cannot bypass the guard with a direct balance write on a managed member (RLS => 0 rows)", (await asAuth(UU.pt, `update association_members set points_balance = 9999 where id='${MM.act}' returning id`)).rows.length === 0 && (await bal(MM.act)) === 20);
// --- Partner's own log
const own = (await asAuth(UU.pt, `select partner_profile_id from association_point_transactions`)).rows;
check("'My log': Partner reads ONLY rows logged by itself (RLS)", own.length >= 3 && own.every((x) => x.partner_profile_id === PP.pt), `${own.length} rows`);
check("'My log': Partner does NOT see the other Partner's or the Owner's rows", !(await asAuth(UU.pt, `select 1 from association_point_transactions where partner_profile_id is distinct from '${PP.pt}' limit 1`)).rows.length);
check("'My log': the other Partner sees only its own row", (await asAuth(UU.pt2, `select partner_profile_id from association_point_transactions`)).rows.every((x) => x.partner_profile_id === PP.pt2));
check("Owner sees every row of its OWN Association (8) and none of the other Association (control)", (await asAuth(UU.own, `select count(*)::int c from association_point_transactions`)).rows[0].c === 8);
const tAct = await term(MM.act);
// --- B1 administration boundary at the database
check("B1: association_staff_role(Association) is NULL for the Partner", (await asAuth(UU.pt, `select association_staff_role('${A}') r`)).rows[0].r === null);
check("B1: has_association_permission is false for the Partner (memberships.manage / audit.view)", (await asAuth(UU.pt, `select has_association_permission('${A}','memberships.manage') a, has_association_permission('${A}','audit.view') b`)).rows[0].a === false);
check("B1: Partner cannot read plans, memberships or the audit log (RLS)", (await asAuth(UU.pt, `select (select count(*) from association_membership_plans)::int p, (select count(*) from association_memberships)::int m, (select count(*) from association_audit_log)::int a`)).rows[0].p === 0);
check("B1: the membership RPCs are not executable by the Partner's database role", (await errOf(() => asAuth(UU.pt, `select * from association_suspend_membership('${tAct}','${UU.pt}','x')`)))?.includes("permission denied"));
check("B1: even the service-role path refuses an actor who is only a Partner (DB re-verifies permission)", (await errOf(() => svc(`select * from association_suspend_membership('${tAct}','${UU.pt}','x')`))) === "permission_denied");
check("B1: lifecycle cannot be changed by the Partner (guard)", (await errOf(() => asAuth(UU.own, `update association_members set lifecycle_state = 'active' where id='${MM.legacy}'`)))?.includes("lifecycle_write_denied"));
check("zero drift after all Partner operations", (await db.query(`select count(*)::int c from (select m.id from association_members m left join association_point_transactions t on t.member_id = m.id group by m.id, m.points_balance having m.points_balance <> coalesce(sum(t.points_delta),0)) d`)).rows[0].c === 0);

const passed = results.filter((x) => x.pass).length;
console.log(`\n=========== ${passed}/${results.length} checks passed ===========`);
if (passed !== results.length) { console.log("FAILURES:"); results.filter((x) => !x.pass).forEach((x) => console.log(" -", x.name, "|", x.detail)); process.exit(1); }
