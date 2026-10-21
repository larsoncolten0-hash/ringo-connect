// Custom profile addresses (name.<profile domain>): helpers, middleware routing, the dashboard API, the additive migration, EN/FR copy and the scope.
// Run: node scripts/tests/profileSubdomain.test.mjs
// No network, no DNS, no real Supabase: the Supabase client is replaced by an in-memory fake, the migration runs on PGlite (npm install --no-save @electric-sql/pglite).
import fs from "fs";
import os from "os";
import path from "path";
import assert from "assert";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const raw = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8").replace(/\r\n/g, "\n");

// ---- in-memory Supabase fake (shared by the middleware and the API route through the @/lib/supabase/server alias) ----
const S = { user: null, profiles: [], subs: [], users: [], retired: [], rpcCalls: [] };
globalThis.__subdomainFake = S;
const fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), "subdomain-fake-"));
const fakeFile = path.join(fakeDir, "server.cjs");
fs.writeFileSync(
  fakeFile,
  `
const S = globalThis.__subdomainFake;
function qb(table) {
  const filters = [];
  const rows = () => ({ profiles: S.profiles, profile_subdomains: S.subs, users: S.users, profile_subdomain_retired: S.retired })[table];
  const match = (r) => filters.every(([c, v]) => r[c] === v);
  const account = (userId) => { const u = S.users.find((x) => x.id === userId); return u ? { status: u.status, plans: { name: u.plan } } : null; };
  const api = {
    select: () => api,
    eq: (c, v) => (filters.push([c, v]), api),
    maybeSingle: async () => {
      const r = rows().find(match);
      if (!r) return { data: null, error: null };
      if (table === "profile_subdomains") { const p = S.profiles.find((x) => x.id === r.profile_id); return { data: { ...r, profiles: p ? { ...p, users: account(p.user_id) } : null }, error: null }; }
      if (table === "users") return { data: account(r.id), error: null };
      return { data: r, error: null };
    },
  };
  return api;
}
// A port of public.claim_profile_subdomain() (the real one is exercised on PGlite further down). JS runs it start to finish without interleaving, like the advisory locks do in Postgres.
function claim(profileId, name, days) {
  if (!/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(name) || name.includes("--")) return "invalid";
  if (!S.profiles.find((p) => p.id === profileId)) return "no_profile";
  if (S.profiles.find((p) => p.username === name && p.id !== profileId)) return "taken";
  if (S.subs.find((r) => r.subdomain === name && r.profile_id !== profileId)) return "taken";
  const ret = S.retired.find((r) => r.subdomain === name);
  if (ret) { if (ret.profile_id !== profileId && new Date(ret.retired_until) > new Date()) return "recently_released"; S.retired.splice(S.retired.indexOf(ret), 1); }
  const mine = S.subs.find((r) => r.profile_id === profileId);
  if (mine && mine.subdomain === name) return "unchanged";
  if (mine) { S.retired.push({ subdomain: mine.subdomain, profile_id: profileId, retired_until: new Date(Date.now() + days * 86400000).toISOString() }); mine.subdomain = name; }
  else S.subs.push({ profile_id: profileId, subdomain: name });
  return "ok";
}
exports.createClient = () => { const user = S.user; return { auth: { getUser: async () => ({ data: { user } }) }, from: (t) => { const q = qb(t); const mine = (u) => S.profiles.filter((p) => p.user_id === (u && u.id)); const orig = q.eq; q.maybeSingle = async () => ({ data: mine(user)[0] || null, error: null }); return q; } }; };
exports.createAdminClient = () => ({ from: (t) => qb(t), rpc: async (fn, a) => { S.rpcCalls.push({ fn, a }); return { data: claim(a.p_profile_id, a.p_subdomain, a.p_reserve_days), error: null }; } });
`
);
const jiti = require("jiti")(import.meta.url, {
  alias: { "@/lib/supabase/server": fakeFile, "@": path.join(REPO, "src") },
  interopDefault: true,
  cache: false,
});

const lib = jiti(path.join(REPO, "src/lib/profileSubdomain.ts"));
const { NextRequest } = require(path.join(REPO, "node_modules/next/server.js"));

let passed = 0;
const failures = [];
const test = async (name, fn) => {
  try {
    await fn();
    passed++;
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
  }
};
const setEnv = (v) => (v === undefined ? delete process.env.NEXT_PUBLIC_PROFILE_DOMAIN : (process.env.NEXT_PUBLIC_PROFILE_DOMAIN = v));
const reset = () => {
  S.user = null;
  S.profiles = [
    { id: "p-david", user_id: "u-david", username: "david", published: true },
    { id: "p-maria", user_id: "u-maria", username: "mariaboutique", published: true },
    { id: "p-draft", user_id: "u-draft", username: "draft", published: false },
  ];
  S.subs = [
    { profile_id: "p-david", subdomain: "david" },
    { profile_id: "p-draft", subdomain: "drafty" },
  ];
  S.retired = [];
  S.rpcCalls = [];
  S.profiles.push({ id: "p-free", user_id: "u-free", username: "freebie", published: true });
  S.users = [
    { id: "u-david", status: "active", plan: "pro" },
    { id: "u-maria", status: "active", plan: "basic" },
    { id: "u-draft", status: "active", plan: "pro" },
    { id: "u-free", status: "active", plan: "free" },
    { id: "u-x", status: "active", plan: "business_pro" },
  ];
};

// ---- helpers ----
await test("normalize: trim + lowercase only", () => {
  assert.equal(lib.normalizeSubdomain("  DaViD "), "david");
  assert.equal(lib.normalizeSubdomain(null), "");
});
await test("validate: accepts good names, normalizes case", () => {
  assert.deepEqual(lib.validateSubdomain("MamasKitchen"), { ok: true, subdomain: "mamaskitchen" });
  assert.equal(lib.validateSubdomain("maria-boutique2").ok, true);
});
await test("validate: rejects every invalid shape with its own code", () => {
  const code = (v) => lib.validateSubdomain(v).code;
  assert.equal(code(""), "empty");
  assert.equal(code("ab"), "too_short");
  assert.equal(code("a".repeat(31)), "too_long");
  assert.equal(code("my_shop"), "invalid_chars");
  assert.equal(code("my.shop"), "invalid_chars");
  assert.equal(code("my shop"), "invalid_chars");
  assert.equal(code("café"), "invalid_chars");
  assert.equal(code("david/../x"), "invalid_chars");
  assert.equal(code("-david"), "edge_hyphen");
  assert.equal(code("david-"), "edge_hyphen");
  assert.equal(code("da--vid"), "double_hyphen");
  assert.equal(code("xn--bcher-kva"), "double_hyphen");
  assert.equal(code(42), "empty");
});
await test("validate: reserved system names are refused, in any case", () => {
  for (const n of ["www", "admin", "API", "dashboard", "auth", "webhook", "billing", "support", "ringo", "stripe", "fapshi", "mail"]) assert.equal(lib.validateSubdomain(n).code, "reserved", n);
});
await test("domain config: missing/blank/malformed disables the feature", () => {
  assert.equal(lib.getProfileDomain({}), null);
  assert.equal(lib.getProfileDomain({ NEXT_PUBLIC_PROFILE_DOMAIN: "  " }), null);
  assert.equal(lib.getProfileDomain({ NEXT_PUBLIC_PROFILE_DOMAIN: "https://ringo.page" }), null);
  assert.equal(lib.getProfileDomain({ NEXT_PUBLIC_PROFILE_DOMAIN: "*.ringo.page" }), null);
  assert.equal(lib.getProfileDomain({ NEXT_PUBLIC_PROFILE_DOMAIN: "ringo.page/x" }), null);
  assert.equal(lib.getProfileDomain({ NEXT_PUBLIC_PROFILE_DOMAIN: "RINGO.page" }), "ringo.page");
  assert.equal(lib.getProfileDomain({ NEXT_PUBLIC_PROFILE_DOMAIN: "localhost" }), "localhost");
});
await test("classifyHost: only <label>.<configured domain> is a profile host", () => {
  const d = "ringo.page";
  assert.deepEqual(lib.classifyHost("david.ringo.page", d), { kind: "profile", subdomain: "david" });
  assert.deepEqual(lib.classifyHost("DAVID.Ringo.Page:443", d), { kind: "profile", subdomain: "david" });
  assert.deepEqual(lib.classifyHost("ringo.page", d), { kind: "apex" });
  assert.deepEqual(lib.classifyHost("www.ringo.page", d), { kind: "apex" });
  assert.deepEqual(lib.classifyHost("a.b.ringo.page", d), { kind: "invalid" });
  assert.deepEqual(lib.classifyHost("admin.ringo.page", d), { kind: "invalid" });
  assert.deepEqual(lib.classifyHost("-x.ringo.page", d), { kind: "invalid" });
  // Never matched: the main site, a look-alike, an injected suffix, a preview host.
  for (const h of ["ringoconnectltd.com", "david.ringo.page.evil.com", "evilringo.page", "david-ringo.page", "ringo-connect.vercel.app", "david.localhost:3000"]) assert.equal(lib.classifyHost(h, d).kind, "off", h);
  assert.deepEqual(lib.classifyHost("david.localhost:3000", "localhost"), { kind: "profile", subdomain: "david" });
});
await test("classifyHost: nothing is a profile host when the domain is not configured", () => {
  assert.equal(lib.classifyHost("david.ringo.page", null).kind, "off");
  assert.equal(lib.classifyHost(null, "ringo.page").kind, "off");
});
await test("routeSubdomainRequest: only the profile root + assets + beacon are served", () => {
  const r = (p, m = "GET") => lib.routeSubdomainRequest(p, m, "david");
  assert.deepEqual(r("/"), { action: "rewrite", pathname: "/david" });
  assert.equal(r("/_next/static/x.js").action, "next");
  assert.equal(r("/david/manifest.webmanifest").action, "next");
  assert.equal(r("/api/track", "POST").action, "next");
  assert.equal(r("/api/track", "GET").action, "not-found");
  for (const p of ["/dashboard", "/dashboard/billing", "/admin", "/admin/users", "/api/billing/checkout", "/api/webhooks/stripe", "/api/inbox/x", "/auth/login", "/d/token", "/c/token", "/order/1", "/team/x", "/api"]) {
    assert.equal(r(p).action, "not-found", p);
  }
  for (const p of ["/david/book", "/mariaboutique", "/david/item/1"]) assert.equal(r(p).action, "main-site", p);
  assert.equal(r("/x/../dashboard").action, "not-found");
});
await test("profileAddress", () => {
  assert.equal(lib.profileAddress("david", "ringo.page"), "https://david.ringo.page");
  assert.equal(lib.profileAddress("david", null), null);
});

// ---- middleware ----
process.env.NEXT_PUBLIC_SITE_URL = "https://ringoconnectltd.com";
const mw = jiti(path.join(REPO, "src/middleware.ts"));
const event = { waitUntil() {} };
const hit = async (host, p, method = "GET") => {
  const req = new NextRequest(`https://${host}${p}`, { method, headers: { host } });
  return mw.middleware(req, event);
};
const rewriteOf = (res) => res.headers.get("x-middleware-rewrite");
const redirectOf = (res) => res.headers.get("location");

await test("middleware: david.<domain>/ is rewritten to the existing profile page", async () => {
  reset();
  setEnv("ringo.page");
  const res = await hit("david.ringo.page", "/");
  assert.equal(new URL(rewriteOf(res)).pathname, "/david");
});
await test("middleware: unknown, unpublished and reserved names all get the same bare 404", async () => {
  reset();
  setEnv("ringo.page");
  for (const h of ["nobody.ringo.page", "drafty.ringo.page", "admin.ringo.page", "a.b.ringo.page"]) {
    const res = await hit(h, "/");
    assert.equal(res.status, 404, h);
    assert.equal(await res.text(), "Not found", h);
  }
});
await test("middleware: dashboard, admin, API, webhook and payment routes are 404 on a subdomain (even for a real profile)", async () => {
  reset();
  setEnv("ringo.page");
  for (const p of ["/dashboard", "/admin", "/api/billing/checkout", "/api/webhooks/stripe", "/api/fapshi/webhook", "/auth/login", "/order/abc"]) {
    const res = await hit("david.ringo.page", p, "POST");
    assert.equal(res.status, 404, p);
    assert.equal(rewriteOf(res), null, p);
  }
});
await test("middleware: other public pages redirect to the CONFIGURED main site, never to the Host", async () => {
  reset();
  setEnv("ringo.page");
  const res = await hit("david.ringo.page", "/david/book");
  assert.equal(res.status, 307);
  assert.equal(redirectOf(res), "https://ringoconnectltd.com/david/book");
  const apex = await hit("www.ringo.page", "/x");
  assert.equal(redirectOf(apex), "https://ringoconnectltd.com/x");
});
await test("middleware: apex/main-site redirects cannot be steered to another host (//evil.com, backslash)", async () => {
  reset();
  setEnv("ringo.page");
  for (const [host, p] of [["www.ringo.page", "//evil.com/x"], ["ringo.page", "/\\evil.com"], ["david.ringo.page", "//evil.com/x"]]) {
    const res = await hit(host, p);
    const loc = redirectOf(res);
    assert.ok(!loc || new URL(loc).origin === "https://ringoconnectltd.com", `${host}${p} -> ${loc}`);
    assert.ok(res.status === 404 || res.status === 307, String(res.status));
  }
});
await test("middleware: a Host that merely contains the domain is not a profile host (no redirect loop, no rewrite)", async () => {
  reset();
  setEnv("ringo.page");
  const res = await hit("david.ringo.page.evil.com", "/");
  assert.equal(rewriteOf(res), null);
  assert.equal(res.status, 200);
});
await test("middleware: no redirect into the profile domain even if the site URL is misconfigured to it (loop guard)", async () => {
  reset();
  setEnv("ringo.page");
  process.env.NEXT_PUBLIC_SITE_URL = "https://ringo.page";
  const res = await hit("david.ringo.page", "/david/book");
  process.env.NEXT_PUBLIC_SITE_URL = "https://ringoconnectltd.com";
  assert.equal(res.status, 404);
});
await test("middleware: main-site profile URLs pass through untouched", async () => {
  reset();
  setEnv("ringo.page");
  for (const p of ["/david", "/david/book", "/api/track", "/api/webhooks/stripe", "/"]) {
    const res = await hit("ringoconnectltd.com", p);
    assert.equal(res.status, 200, p);
    assert.equal(rewriteOf(res), null, p);
    assert.equal(redirectOf(res), null, p);
  }
});
await test("middleware: with NO profile domain configured, a subdomain-looking host is inert (local/test environments)", async () => {
  reset();
  setEnv(undefined);
  const res = await hit("david.ringo.page", "/");
  assert.equal(res.status, 200);
  assert.equal(rewriteOf(res), null);
});
await test("middleware: /dashboard on the main site is still guarded (logged-out redirect to login)", async () => {
  reset();
  setEnv("ringo.page");
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:9";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "x";
  const src = raw("src/middleware.ts");
  assert.ok(src.includes('url.pathname = "/auth/login"') && src.includes('path.startsWith("/dashboard") || path.startsWith("/admin")'));
});

// ---- API route ----
const route = jiti(path.join(REPO, "src/app/api/profile/subdomain/route.ts"));
const post = (user, body) => {
  S.user = user;
  const req = new Request("https://ringoconnectltd.com/api/profile/subdomain", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return route.POST(req);
};
const j = async (res) => ({ status: res.status, ...(await res.json()) });

await test("api: signed-out callers are refused", async () => {
  reset();
  setEnv("ringo.page");
  assert.equal((await j(await post(null, { action: "check", subdomain: "newname" }))).status, 401);
  S.user = null;
  assert.equal((await route.GET()).status, 401);
});
await test("api: disabled (no domain configured) answers 404 and writes nothing", async () => {
  reset();
  setEnv(undefined);
  const r = await j(await post({ id: "u-maria" }, { action: "save", subdomain: "maria" }));
  assert.equal(r.status, 404);
  assert.equal(S.subs.length, 2);
  S.user = { id: "u-maria" };
  assert.equal((await (await route.GET()).json()).enabled, false);
});
await test("api: check reports available, taken, reserved, invalid", async () => {
  reset();
  setEnv("ringo.page");
  const u = { id: "u-maria" };
  assert.equal((await j(await post(u, { action: "check", subdomain: "MariaShop" }))).address, "https://mariashop.ringo.page");
  assert.equal((await j(await post(u, { action: "check", subdomain: "david" }))).code, "taken");
  assert.equal((await j(await post(u, { action: "check", subdomain: "admin" }))).code, "reserved");
  assert.equal((await j(await post(u, { action: "check", subdomain: "a b" }))).code, "invalid_chars");
  assert.equal((await j(await post(u, { action: "nope", subdomain: "x" }))).status, 400);
});
await test("api: save claims the name for the caller's own profile and a repeat is idempotent", async () => {
  reset();
  setEnv("ringo.page");
  const u = { id: "u-maria" };
  const r = await j(await post(u, { action: "save", subdomain: "MariaBoutique" }));
  assert.equal(r.ok, true);
  assert.deepEqual(S.subs.find((s) => s.profile_id === "p-maria").subdomain, "mariaboutique");
  assert.equal((await j(await post(u, { action: "save", subdomain: "mariaboutique" }))).ok, true);
  S.user = u;
  assert.equal((await (await route.GET()).json()).address, "https://mariaboutique.ringo.page");
});
await test("api: a client-supplied profile id / username is ignored; another user's address cannot be changed or taken over", async () => {
  reset();
  setEnv("ringo.page");
  const r = await j(await post({ id: "u-maria" }, { action: "save", subdomain: "mariashop", profileId: "p-david", profile_id: "p-david", username: "david" }));
  assert.equal(r.ok, true);
  assert.equal(S.subs.find((s) => s.profile_id === "p-david").subdomain, "david", "david's address is untouched");
  assert.equal(S.subs.find((s) => s.profile_id === "p-maria").subdomain, "mariashop");
  const steal = await j(await post({ id: "u-maria" }, { action: "save", subdomain: "david" }));
  assert.equal(steal.code, "taken");
  assert.equal(S.subs.find((s) => s.profile_id === "p-david").subdomain, "david");
  // A user without a profile cannot write at all.
  assert.equal((await j(await post({ id: "u-ghost" }, { action: "save", subdomain: "ghostname" }))).status, 401);
});
await test("api: nobody can claim another profile's USERNAME as a subdomain (impersonation), but its owner can", async () => {
  reset();
  setEnv("ringo.page");
  assert.equal((await j(await post({ id: "u-david" }, { action: "save", subdomain: "mariaboutique" }))).code, "taken");
  assert.equal((await j(await post({ id: "u-maria" }, { action: "save", subdomain: "mariaboutique" }))).ok, true);
});
await test("api: concurrent claims of one name - exactly one wins, the loser gets taken (409)", async () => {
  reset();
  setEnv("ringo.page");
  S.profiles.push({ id: "p-x", user_id: "u-x", username: "xuser", published: true });
  const a = post({ id: "u-maria" }, { action: "save", subdomain: "popularname" });
  const b = post({ id: "u-x" }, { action: "save", subdomain: "popularname" });
  const [ra, rb] = await Promise.all([j(await a), j(await b)]);
  const wins = [ra, rb].filter((r) => r.ok).length;
  assert.equal(wins, 1);
  assert.equal([ra, rb].find((r) => !r.ok).status, 409);
  assert.equal(S.subs.filter((s) => s.subdomain === "popularname").length, 1);
});
await test("api: changing the address keeps exactly one row and reserves the old name (it is not instantly free)", async () => {
  reset();
  setEnv("ringo.page");
  assert.equal((await j(await post({ id: "u-maria" }, { action: "save", subdomain: "firstchoice" }))).ok, true);
  assert.equal((await j(await post({ id: "u-david" }, { action: "check", subdomain: "firstchoice" }))).code, "taken");
  assert.equal((await j(await post({ id: "u-maria" }, { action: "save", subdomain: "secondchoice" }))).ok, true);
  assert.equal(S.subs.filter((s) => s.profile_id === "p-maria").length, 1);
  assert.equal((await j(await post({ id: "u-david" }, { action: "check", subdomain: "firstchoice" }))).code, "recently_released");
});


// ---- paid plans only ----
await test("plan rule: only an active account on basic / pro / business_basic / business_pro qualifies (reuses isPaidPlan)", () => {
  const ok = (name, status = "active") => lib.profileSubdomainAllowed({ status, plans: { name } });
  for (const n of ["basic", "pro", "business_basic", "business_pro"]) assert.equal(ok(n), true, n);
  assert.equal(ok("free"), false);
  assert.equal(ok("enterprise"), false, "unknown plan names are not paid");
  assert.equal(ok("pro", "suspended"), false, "a suspended account never qualifies");
  assert.equal(lib.profileSubdomainAllowed(null), false);
  assert.equal(lib.profileSubdomainAllowed({ status: "active", plans: null }), false);
  assert.equal(lib.profileSubdomainAllowed({ status: "active", plans: [{ name: "pro" }] }), true, "an embedded to-many shape is read too");
});
await test("api: a FREE user is refused on check AND save (403 plan_required), GET reports allowed:false, nothing is written", async () => {
  reset();
  setEnv("ringo.page");
  const u = { id: "u-free" };
  for (const action of ["check", "save"]) {
    const r = await j(await post(u, { action, subdomain: "freeshop" }));
    assert.equal(r.status, 403, action);
    assert.equal(r.code, "plan_required", action);
  }
  assert.equal(S.rpcCalls.length, 0);
  assert.equal(S.subs.find((x) => x.profile_id === "p-free"), undefined);
  S.user = u;
  assert.deepEqual(await (await route.GET()).json(), { enabled: true, allowed: false });
});
await test("api: the plan is read from the database, never from the request (a forged plan in the body changes nothing)", async () => {
  reset();
  setEnv("ringo.page");
  const r = await j(await post({ id: "u-free" }, { action: "save", subdomain: "freeshop", plan: "pro", plans: { name: "pro" }, isPaid: true, status: "active" }));
  assert.equal(r.status, 403);
});
await test("api: every paid plan can claim", async () => {
  for (const plan of ["basic", "pro", "business_basic", "business_pro"]) {
    reset();
    setEnv("ringo.page");
    S.users.find((x) => x.id === "u-maria").plan = plan;
    assert.equal((await j(await post({ id: "u-maria" }, { action: "save", subdomain: "mariashop" }))).ok, true, plan);
  }
});
await test("api: a user downgraded to Free (expired after grace / self-service / admin) is refused on the very next request, and the stored address is kept", async () => {
  reset();
  setEnv("ringo.page");
  assert.equal((await j(await post({ id: "u-maria" }, { action: "save", subdomain: "mariashop" }))).ok, true);
  S.users.find((x) => x.id === "u-maria").plan = "free";
  assert.equal((await j(await post({ id: "u-maria" }, { action: "save", subdomain: "mariashop2" }))).code, "plan_required");
  assert.equal((await j(await post({ id: "u-maria" }, { action: "check", subdomain: "mariashop2" }))).status, 403);
  S.user = { id: "u-maria" };
  assert.equal((await (await route.GET()).json()).allowed, false);
  assert.equal(S.subs.find((x) => x.profile_id === "p-maria").subdomain, "mariashop", "nothing was deleted or changed");
  S.users.find((x) => x.id === "u-maria").plan = "pro";
  S.user = { id: "u-maria" };
  assert.equal((await (await route.GET()).json()).subdomain, "mariashop", "re-subscribing brings the same address back");
});
await test("api: a suspended paid account is refused", async () => {
  reset();
  setEnv("ringo.page");
  S.users.find((x) => x.id === "u-maria").status = "suspended";
  assert.equal((await j(await post({ id: "u-maria" }, { action: "save", subdomain: "mariashop" }))).code, "plan_required");
});
await test("api: unauthenticated and profile-less callers are refused before any plan lookup", async () => {
  reset();
  setEnv("ringo.page");
  assert.equal((await j(await post(null, { action: "save", subdomain: "abc" }))).status, 401);
  assert.equal((await j(await post({ id: "u-nobody" }, { action: "save", subdomain: "abc" }))).status, 401);
  assert.equal(S.rpcCalls.length, 0);
});

// ---- changing the name ----
await test("api: a paid user can change to another available name; the old name is retired (kept), not deleted, and the profile row is untouched", async () => {
  reset();
  setEnv("ringo.page");
  const u = { id: "u-maria" };
  assert.equal((await j(await post(u, { action: "save", subdomain: "firstchoice" }))).ok, true);
  const before = JSON.stringify(S.profiles.find((p) => p.id === "p-maria"));
  const r = await j(await post(u, { action: "save", subdomain: "secondchoice" }));
  assert.equal(r.ok, true);
  assert.equal(r.address, "https://secondchoice.ringo.page");
  assert.equal(S.subs.filter((x) => x.profile_id === "p-maria").length, 1);
  assert.equal(S.subs.find((x) => x.profile_id === "p-maria").subdomain, "secondchoice");
  const kept = S.retired.find((x) => x.subdomain === "firstchoice");
  assert.ok(kept && kept.profile_id === "p-maria" && new Date(kept.retired_until) > new Date(Date.now() + 80 * 86400000), "old name retired for ~90 days");
  assert.equal(JSON.stringify(S.profiles.find((p) => p.id === "p-maria")), before, "profile content untouched");
  assert.equal(S.rpcCalls.at(-1).a.p_reserve_days, lib.SUBDOMAIN_RESERVE_DAYS);
});
await test("api: a released name stays reserved for its previous owner; others get recently_released on check and save; the previous owner can take it back", async () => {
  reset();
  setEnv("ringo.page");
  await post({ id: "u-maria" }, { action: "save", subdomain: "firstchoice" });
  await post({ id: "u-maria" }, { action: "save", subdomain: "secondchoice" });
  assert.equal((await j(await post({ id: "u-david" }, { action: "check", subdomain: "firstchoice" }))).code, "recently_released");
  assert.equal((await j(await post({ id: "u-david" }, { action: "save", subdomain: "firstchoice" }))).code, "recently_released");
  assert.equal(S.subs.find((x) => x.profile_id === "p-david").subdomain, "david");
  assert.equal((await j(await post({ id: "u-maria" }, { action: "save", subdomain: "firstchoice" }))).ok, true, "back to the old name");
  assert.equal(S.retired.find((x) => x.subdomain === "firstchoice"), undefined);
  assert.ok(S.retired.find((x) => x.subdomain === "secondchoice"), "the name just left is now the retired one");
});
await test("api: after the reservation ends the name is free for anyone", async () => {
  reset();
  setEnv("ringo.page");
  await post({ id: "u-maria" }, { action: "save", subdomain: "firstchoice" });
  await post({ id: "u-maria" }, { action: "save", subdomain: "secondchoice" });
  S.retired.find((x) => x.subdomain === "firstchoice").retired_until = new Date(Date.now() - 1000).toISOString();
  assert.equal((await j(await post({ id: "u-david" }, { action: "save", subdomain: "firstchoice" }))).ok, true);
});
await test("api: changing to an unavailable name (taken / reserved / invalid) fails and keeps the current address", async () => {
  reset();
  setEnv("ringo.page");
  const u = { id: "u-maria" };
  await post(u, { action: "save", subdomain: "firstchoice" });
  for (const [name, code] of [["david", "taken"], ["freebie", "taken"], ["admin", "reserved"], ["a_b", "invalid_chars"], ["ab", "too_short"]]) {
    assert.equal((await j(await post(u, { action: "save", subdomain: name }))).code, code, name);
  }
  assert.equal(S.subs.find((x) => x.profile_id === "p-maria").subdomain, "firstchoice");
  assert.equal(S.retired.length, 0, "nothing retired by a failed change");
});

// ---- middleware: plan + retired names ----
await test("middleware: an owner downgraded to Free is forwarded to the SAME profile on the main site (not deleted, not served, no loop)", async () => {
  reset();
  setEnv("ringo.page");
  S.users.find((x) => x.id === "u-david").plan = "free";
  const res = await hit("david.ringo.page", "/");
  assert.equal(res.status, 307);
  assert.equal(redirectOf(res), "https://ringoconnectltd.com/david");
  assert.equal(rewriteOf(res), null);
  assert.equal(S.subs.find((x) => x.profile_id === "p-david").subdomain, "david", "row kept");
  S.users.find((x) => x.id === "u-david").plan = "pro";
  assert.equal(new URL(rewriteOf(await hit("david.ringo.page", "/"))).pathname, "/david", "paid again: served again");
});
await test("middleware: a suspended owner's address is a bare 404", async () => {
  reset();
  setEnv("ringo.page");
  S.users.find((x) => x.id === "u-david").status = "suspended";
  assert.equal((await hit("david.ringo.page", "/")).status, 404);
});
await test("middleware: a recently released address forwards to its owner's CURRENT address; an expired or never-used one is a 404", async () => {
  reset();
  setEnv("ringo.page");
  await post({ id: "u-maria" }, { action: "save", subdomain: "firstchoice" });
  await post({ id: "u-maria" }, { action: "save", subdomain: "secondchoice" });
  const res = await hit("firstchoice.ringo.page", "/");
  assert.equal(res.status, 307);
  assert.equal(redirectOf(res), "https://secondchoice.ringo.page/");
  S.retired.find((x) => x.subdomain === "firstchoice").retired_until = new Date(Date.now() - 1000).toISOString();
  assert.equal((await hit("firstchoice.ringo.page", "/")).status, 404);
  assert.equal((await hit("neverused.ringo.page", "/")).status, 404);
});
await test("middleware: the forwarding target is built from the stored label + configured domain only (no Host, no path from the request)", async () => {
  reset();
  setEnv("ringo.page");
  await post({ id: "u-maria" }, { action: "save", subdomain: "firstchoice" });
  await post({ id: "u-maria" }, { action: "save", subdomain: "secondchoice" });
  const res = await hit("firstchoice.ringo.page", "//evil.com/x?next=https://evil.com");
  assert.equal(redirectOf(res), "https://secondchoice.ringo.page/");
});

// ---- migration (PGlite) ----
{
  let PGlite = null;
  try {
    ({ PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite"));
  } catch {}
  if (!PGlite) {
    failures.push("PGlite missing: npm install --no-save @electric-sql/pglite (the migration checks cannot run without it)");
  } else {
    const MIG = raw("supabase/migrations/2026-12-25_profile_subdomains.sql");
    const ROLL = raw("supabase/support/2026-12-25_profile_subdomains.rollback.sql");
    const VER = raw("supabase/support/2026-12-25_profile_subdomains.verify.sql");
    const db = new PGlite();
    await db.exec("create role anon; create role authenticated; create role service_role; create table public.profiles (id uuid primary key default gen_random_uuid(), username text unique);");
    await db.exec("insert into public.profiles (id, username) values ('00000000-0000-0000-0000-000000000001','a'), ('00000000-0000-0000-0000-000000000002','b');");
    const A = "00000000-0000-0000-0000-000000000001";
    const B = "00000000-0000-0000-0000-000000000002";
    const fails = async (q) => { try { await db.exec(q); return false; } catch (e) { return e.message; } };
    const PRE = raw("supabase/support/2026-12-25_profile_subdomains.preflight.sql");
    await test("migration: the preflight is all true BEFORE applying, and false for 'no object of this name' once applied", async () => {
      const pre = await db.query(PRE);
      assert.ok(pre.rows.length >= 7 && pre.rows.every((r) => r.ok === true), JSON.stringify(pre.rows));
    });
    await test("migration: applies, is idempotent, and its verify script is all true", async () => {
      await db.exec(MIG);
      await db.exec(MIG);
      const v = await db.query(VER);
      assert.ok(v.rows.length >= 7 && v.rows.every((r) => r.ok === true), JSON.stringify(v.rows));
      const again = await db.query(PRE);
      assert.equal(again.rows.find((r) => r.check.startsWith("no object of this name")).ok, false, "the preflight notices an already-applied migration");
    });
    await test("migration: unique subdomain (duplicate claim refused), one address per profile", async () => {
      await db.exec(`insert into public.profile_subdomains (profile_id, subdomain) values ('${A}', 'david')`);
      assert.ok(await fails(`insert into public.profile_subdomains (profile_id, subdomain) values ('${B}', 'david')`));
      assert.ok(await fails(`insert into public.profile_subdomains (profile_id, subdomain) values ('${A}', 'other')`));
    });
    await test("migration: the format CHECK refuses uppercase, dots, double hyphens, edges and bad lengths", async () => {
      for (const bad of ["David", "da.vid", "da--vid", "-david", "david-", "ab", "a".repeat(31), "xn--bcher-kva", "a b c"]) {
        assert.ok(await fails(`insert into public.profile_subdomains (profile_id, subdomain) values ('${B}', '${bad}')`), bad);
      }
      await db.exec(`insert into public.profile_subdomains (profile_id, subdomain) values ('${B}', 'ok-name1')`);
    });
    await test("migration: browser roles have no access; deleting the profile removes its address", async () => {
      assert.ok(await fails("set role anon; select * from public.profile_subdomains;").then(async (m) => { await db.exec("reset role"); return m; }));
      assert.ok(await fails("set role authenticated; insert into public.profile_subdomains (profile_id, subdomain) values (gen_random_uuid(), 'zzz');").then(async (m) => { await db.exec("reset role"); return m; }));
      await db.exec(`delete from public.profiles where id = '${B}'`);
      assert.equal((await db.query("select count(*)::int as n from public.profile_subdomains where subdomain = 'ok-name1'")).rows[0].n, 0);
    });
    const C = "00000000-0000-0000-0000-0000000000c1";
    const D = "00000000-0000-0000-0000-0000000000d1";
    const E = "00000000-0000-0000-0000-0000000000e1";
    await db.exec(`insert into public.profiles (id, username) values ('${C}', 'carol'), ('${D}', 'dave'), ('${E}', 'erin')`);
    const claim = async (id, name, days = 90) => (await db.query("select public.claim_profile_subdomain($1::uuid, $2, $3) as r", [id, name, days])).rows[0].r;
    await test("function: claims, is idempotent, changes, and retires the old name in the same transaction", async () => {
      assert.equal(await claim(C, "carolshop"), "ok");
      assert.equal(await claim(C, "carolshop"), "unchanged");
      assert.equal(await claim(C, "carolshop2"), "ok");
      const cur = (await db.query("select subdomain from public.profile_subdomains where profile_id = $1", [C])).rows;
      assert.deepEqual(cur.map((r) => r.subdomain), ["carolshop2"]);
      const ret = (await db.query("select subdomain, profile_id, retired_until > now() + interval '89 days' as long from public.profile_subdomain_retired")).rows;
      assert.deepEqual(ret.map((r) => [r.subdomain, r.profile_id, r.long]), [["carolshop", C, true]]);
    });
    await test("function: another profile cannot take a held name or a recently released one; the previous owner can take it back", async () => {
      assert.equal(await claim(D, "carolshop2"), "taken");
      assert.equal(await claim(D, "carolshop"), "recently_released");
      assert.equal((await db.query("select count(*)::int as n from public.profile_subdomains where profile_id = $1", [D])).rows[0].n, 0);
      assert.equal(await claim(C, "carolshop"), "ok");
      assert.equal((await db.query("select count(*)::int as n from public.profile_subdomain_retired where subdomain = 'carolshop'")).rows[0].n, 0);
      assert.equal((await db.query("select count(*)::int as n from public.profile_subdomain_retired where subdomain = 'carolshop2'")).rows[0].n, 1);
    });
    await test("function: a reservation that has run out frees the name for anyone", async () => {
      await db.exec("update public.profile_subdomain_retired set retired_until = now() - interval '1 second' where subdomain = 'carolshop2'");
      assert.equal(await claim(D, "carolshop2"), "ok");
      assert.equal((await db.query("select count(*)::int as n from public.profile_subdomain_retired where subdomain = 'carolshop2'")).rows[0].n, 0);
    });
    await test("function: a name equal to ANOTHER profile's username is refused (impersonation); the owner of that username may use it", async () => {
      assert.equal(await claim(D, "erin"), "taken");
      assert.equal(await claim(E, "erin"), "ok");
    });
    await test("function: invalid names and unknown profiles are refused and write nothing", async () => {
      const before = (await db.query("select count(*)::int as n from public.profile_subdomains")).rows[0].n;
      for (const bad of ["Dave", "da--ve", "-dave", "ab", "a.b", "", "x".repeat(31)]) assert.equal(await claim(D, bad), "invalid", bad);
      assert.equal(await claim("00000000-0000-0000-0000-0000000000ff", "ghostname"), "no_profile");
      assert.equal((await db.query("select count(*)::int as n from public.profile_subdomains")).rows[0].n, before);
    });
    await test("function: a failed change leaves the current address and creates no reservation", async () => {
      const retiredBefore = (await db.query("select count(*)::int as n from public.profile_subdomain_retired")).rows[0].n;
      assert.equal(await claim(E, "carolshop"), "taken");
      assert.equal((await db.query("select subdomain from public.profile_subdomains where profile_id = $1", [E])).rows[0].subdomain, "erin");
      assert.equal((await db.query("select count(*)::int as n from public.profile_subdomain_retired")).rows[0].n, retiredBefore);
    });
    await test("function: a name held by another profile is refused and the caller's own address is unchanged (the UNIQUE constraint behind it is proven above; a true parallel race needs two connections, which PGlite does not offer)", async () => {
      await db.exec("update public.profile_subdomains set subdomain = 'racedname' where profile_id = '" + D + "'");
      assert.equal(await claim(E, "racedname"), "taken");
      assert.equal((await db.query("select subdomain from public.profile_subdomains where profile_id = $1", [E])).rows[0].subdomain, "erin");
    });
    await test("function: only service_role may run it; anon and authenticated are refused", async () => {
      for (const role of ["anon", "authenticated"]) {
        const m = await fails(`set role ${role}; select public.claim_profile_subdomain('${C}'::uuid, 'hijack1', 90);`);
        await db.exec("reset role");
        assert.ok(m && /permission denied/i.test(m), role + ": " + m);
      }
      await db.exec("set role service_role");
      assert.equal(await claim(C, "carolshop"), "unchanged");
      await db.exec("reset role");
    });
    await test("function: deleting a profile removes its address and its reservations (cascade)", async () => {
      await db.exec(`delete from public.profiles where id = '${C}'`);
      assert.equal((await db.query("select count(*)::int as n from public.profile_subdomains where profile_id = $1", [C])).rows[0].n, 0);
      assert.equal((await db.query("select count(*)::int as n from public.profile_subdomain_retired where profile_id = $1", [C])).rows[0].n, 0);
    });
    await test("migration: rollback removes only the new objects (two tables, one function); existing tables and rows stay", async () => {
      const profilesBefore = (await db.query("select count(*)::int as n from public.profiles")).rows[0].n;
      await db.exec(ROLL);
      assert.equal((await db.query("select to_regclass('public.profile_subdomains') as t")).rows[0].t, null);
      assert.equal((await db.query("select to_regclass('public.profile_subdomain_retired') as t")).rows[0].t, null);
      assert.equal((await db.query("select to_regprocedure('public.claim_profile_subdomain(uuid,text,integer)') as f")).rows[0].f, null);
      assert.equal((await db.query("select count(*)::int as n from public.profiles")).rows[0].n, profilesBefore);
    });
    await test("migration: is additive (two new tables + one new function; no alter/drop of anything existing)", () => {
      const code = MIG.replace(/--[^\n]*/g, "");
      assert.ok(!/\balter\s+table\s+(?!public\.profile_subdomains\b|public\.profile_subdomain_retired\b)/i.test(code));
      assert.ok(!/\bdrop\s+/i.test(code.replace(/-- .*/g, "")) || !/\bdrop\s+(table|function|index|policy|trigger|column|constraint)\b/i.test(code));
      assert.equal((code.match(/create table/gi) || []).length, 2);
      assert.equal((code.match(/create or replace function/gi) || []).length, 1);
      assert.ok(/security definer/i.test(code) && /set search_path = public, pg_temp/i.test(code) && /pg_advisory_xact_lock/.test(code));
      assert.ok(/revoke all on function public\.claim_profile_subdomain[\s\S]*from public, anon, authenticated/.test(code) && /grant execute on function public\.claim_profile_subdomain[\s\S]*to service_role/.test(code));
    });
  }
}

// ---- EN / FR ----
await test("i18n: every profile-address string exists in English and French, with the same keys and placeholders", () => {
  const { translations } = jiti(path.join(REPO, "src/lib/i18n/translations.ts"));
  const en = translations.en.editor.profileAddress;
  const fr = translations.fr.editor.profileAddress;
  const keys = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (typeof v === "object" ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
  assert.deepEqual(keys(en).sort(), keys(fr).sort());
  const flat = (o) => Object.fromEntries(keys(o).map((k) => [k, k.split(".").reduce((x, s) => x[s], o)]));
  const fe = flat(en), ff = flat(fr);
  for (const k of Object.keys(fe)) {
    assert.ok(fe[k] && ff[k], k);
    assert.equal(fe[k].includes("{address}"), ff[k].includes("{address}"), k);
  }
  for (const code of ["empty", "too_short", "too_long", "invalid_chars", "edge_hyphen", "double_hyphen", "reserved", "taken", "generic"]) assert.ok(en.errors[code] && fr.errors[code], code);
  assert.notEqual(fe["errors.taken"], ff["errors.taken"]);
});

// ---- wiring ----
await test("wiring: the editor section is gated on the configured domain and uses the section's single Save", () => {
  const editor = raw("src/components/Editor.tsx");
  assert.ok(editor.includes("getProfileDomain() && profileSubdomainAllowed({ plans: plan }) && ("), "hidden unless the domain is configured AND the plan is paid");
  const card = raw("src/components/editor/ProfileAddressCard.tsx");
  assert.ok(card.includes("useSectionSave(save)"));
  assert.ok(!/>\s*\{t\.editor\.save\}/.test(card), "no second Save button");
});
await test("wiring: canonical URLs stay on the main site (profileMetadata untouched)", () => {
  const seo = raw("src/lib/seo.ts");
  assert.ok(seo.includes("alternates: { canonical: path }"));
});
await test("wiring: .env.example documents the variable, empty by default; ringo.page is not hardcoded in source", () => {
  assert.match(raw(".env.example"), /^NEXT_PUBLIC_PROFILE_DOMAIN=$/m);
  for (const f of ["src/middleware.ts", "src/lib/profileSubdomain.ts", "src/app/api/profile/subdomain/route.ts", "src/components/editor/ProfileAddressCard.tsx", "src/components/Editor.tsx"]) {
    assert.ok(!raw(f).replace(/\/\/.*$/gm, "").includes("ringo.page"), f);
  }
});

fs.rmSync(fakeDir, { recursive: true, force: true });
console.log(`${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log("  FAIL:", f);
process.exit(failures.length ? 1 : 0);
