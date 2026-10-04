// Phase 4B: robots.txt and sitemap.xml. No network, no database: the service-role client is a fake that
// applies the same filters (eq / in / order / range) the real queries use.
//   Run:  node scripts/tests/seoRobotsSitemap.test.mjs
import fs from "fs";
import path from "path";
import assert from "assert";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const jiti = require("jiti")(import.meta.url, { alias: { "@": path.join(REPO, "src") }, interopDefault: true, cache: false });
const load = (p) => jiti(path.join(REPO, "src", p));
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const src = (p) => strip(fs.readFileSync(path.join(REPO, p), "utf8").replace(/\r\n/g, "\n"));

process.env.NEXT_PUBLIC_SITE_URL = "https://ringoconnectltd.com/";

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
  } catch (e) {
    failures.push(`${name}\n    ${String(e.message).split("\n").join("\n    ")}`);
  }
}
const quiet = async (fn) => {
  const o = console.error;
  const lines = [];
  console.error = (...a) => lines.push(a.join(" "));
  try {
    return { value: await fn(), lines };
  } finally {
    console.error = o;
  }
};

// A fake of the slice of the Supabase query builder the sitemap uses.
function fakeAdmin({ profiles = [], users = [], failProfiles = false, failUsers = false }) {
  const calls = { selects: [] };
  const from = (table) => {
    const state = { filters: [], inIds: null, range: null, cols: null };
    const b = {
      select(cols) {
        state.cols = cols;
        calls.selects.push(`${table}:${cols}`);
        return b;
      },
      eq(k, v) {
        state.filters.push([k, v]);
        return b;
      },
      in(k, ids) {
        state.inIds = [k, ids];
        return b;
      },
      order() {
        return b;
      },
      range(a, z) {
        state.range = [a, z];
        return b;
      },
      then(resolve) {
        if ((table === "profiles" && failProfiles) || (table === "users" && failUsers)) return resolve({ data: null, error: { message: "boom" } });
        let rows = table === "profiles" ? profiles : users;
        for (const [k, v] of state.filters) rows = rows.filter((r) => r[k] === v);
        if (state.inIds) rows = rows.filter((r) => state.inIds[1].includes(r[state.inIds[0]]));
        if (state.range) rows = rows.slice(state.range[0], state.range[1] + 1);
        const cols = state.cols.split(",").map((c) => c.trim());
        return resolve({ data: rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]]))), error: null });
      },
    };
    return b;
  };
  return { from, calls };
}

const P = (username, user_id, extra = {}) => ({ username, user_id, published: true, is_demo: false, private_note: "x", ...extra });
const U = (id, status = "active") => ({ id, status });

const robotsMod = load("app/robots.ts");
const sitemapMod = load("app/sitemap.ts");
const serverMod = load("lib/supabase/server.ts");

// ------------------------------------------------------------------ robots
await test("robots: public pages crawlable, private route families disallowed, sitemap listed with the configured origin", () => {
  const r = robotsMod.default();
  const rule = Array.isArray(r.rules) ? r.rules[0] : r.rules;
  assert.equal(rule.userAgent, "*");
  assert.equal(rule.allow, "/");
  for (const p of ["/dashboard", "/admin", "/auth", "/api/", "/my-ringo", "/scanner/", "/d/", "/order/", "/shop/orders", "/team/", "/association/", "/community/manage", "/m-card/", "/dev-preview-"])
    assert.ok(rule.disallow.includes(p), p);
  assert.equal(r.sitemap, "https://ringoconnectltd.com/sitemap.xml");
});
await test("robots: profiles and their canonical-bearing secondary pages are NOT blocked (a crawler must read their canonical / noindex)", () => {
  const rule = robotsMod.default().rules[0];
  for (const p of ["/", "/ada", "/r/", "/m/", "/get-started", "/ada/book", "/ada/item/1"])
    assert.ok(!rule.disallow.some((d) => p === d || p.startsWith(d)), p);
});
await test("robots is guidance only: no auth, middleware or route code was changed to make it work", () => {
  const s = src("src/app/robots.ts");
  assert.match(fs.readFileSync(path.join(REPO, "src/app/robots.ts"), "utf8"), /NOT access control/);
  assert.ok(!/middleware|supabase/.test(s));
  assert.match(src("src/middleware.ts"), /matcher: \["\/dashboard\/:path\*", "\/admin\/:path\*"\]/);
});

// ------------------------------------------------------------------ sitemap filtering
await test("sitemap: the homepage plus published, non-demo, non-suspended profiles, as absolute canonical URLs", async () => {
  const admin = fakeAdmin({
    profiles: [P("ada", "u1"), P("bob", "u2"), P("draft", "u3", { published: false }), P("demo", "u4", { is_demo: true }), P("sam", "u5"), P("ghost", "u6")],
    users: [U("u1"), U("u2", "active"), U("u3"), U("u4"), U("u5", "suspended")], // u6 has no users row
  });
  serverMod.createAdminClient = () => admin;
  const entries = await sitemapMod.default();
  assert.deepEqual(entries.map((e) => e.url), ["https://ringoconnectltd.com/", "https://ringoconnectltd.com/ada", "https://ringoconnectltd.com/bob"]);
});
await test("sitemap: published=false and is_demo=true are excluded by the query itself; suspended by the owner's status", async () => {
  const admin = fakeAdmin({ profiles: [P("a", "u1")], users: [U("u1")] });
  assert.deepEqual(await sitemapMod.listPublicUsernames(admin), ["a"]);
  const s = src("src/app/sitemap.ts");
  assert.match(s, /\.eq\("published", true\)/);
  assert.match(s, /\.eq\("is_demo", false\)/);
  assert.match(s, /u\.status !== "suspended"/);
});
await test("sitemap: no private field leaves the query (only username and user_id are read; only usernames are returned)", async () => {
  const admin = fakeAdmin({ profiles: [P("a", "u1")], users: [U("u1")] });
  const out = await sitemapMod.listPublicUsernames(admin);
  assert.deepEqual(out, ["a"]);
  assert.deepEqual(admin.calls.selects, ["profiles:username, user_id", "users:id, status"]);
  serverMod.createAdminClient = () => admin;
  const json = JSON.stringify(await sitemapMod.default());
  assert.ok(!/user_id|private_note|u1/.test(json));
});
await test("sitemap: only the homepage and profile pages: no /get-started, item, /r, /m, booking, checkout or private routes", async () => {
  serverMod.createAdminClient = () => fakeAdmin({ profiles: [P("ada", "u1")], users: [U("u1")] });
  for (const e of await sitemapMod.default()) assert.match(e.url, /^https:\/\/ringoconnectltd\.com(\/|\/[a-z0-9%_.-]+)$/i);
  const s = src("src/app/sitemap.ts");
  assert.ok(!/get-started|\/item\/|\/r\/|\/m\/|book|checkout/.test(s));
});

// ------------------------------------------------------------------ fail closed
await test("sitemap fails closed: a failed profile read lists only the homepage", async () => {
  serverMod.createAdminClient = () => fakeAdmin({ profiles: [P("ada", "u1")], users: [U("u1")], failProfiles: true });
  const { value, lines } = await quiet(() => sitemapMod.default());
  assert.deepEqual(value.map((e) => e.url), ["https://ringoconnectltd.com/"]);
  assert.ok(lines.some((l) => /profile read failed/.test(l)));
});
await test("sitemap fails closed: a failed owner-status read lists no profile on a guess", async () => {
  serverMod.createAdminClient = () => fakeAdmin({ profiles: [P("ada", "u1")], users: [U("u1")], failUsers: true });
  const { value } = await quiet(() => sitemapMod.default());
  assert.deepEqual(value.map((e) => e.url), ["https://ringoconnectltd.com/"]);
});
await test("sitemap fails closed: an owner with an unreadable (missing / null) status is left out", async () => {
  const admin = fakeAdmin({ profiles: [P("a", "u1"), P("b", "u2"), P("c", "u3")], users: [U("u1"), { id: "u2", status: null }] });
  assert.deepEqual(await sitemapMod.listPublicUsernames(admin), ["a"]);
});
await test("sitemap: a thrown client error degrades to the homepage only, never to a 500 or a wrong list", async () => {
  serverMod.createAdminClient = () => {
    throw new Error("no service key");
  };
  const { value } = await quiet(() => sitemapMod.default());
  assert.deepEqual(value.map((e) => e.url), ["https://ringoconnectltd.com/"]);
});

// ------------------------------------------------------------------ scale and caching
await test("sitemap reads every page of profiles (not just the first 1000) and chunks the owner lookups", async () => {
  const profiles = Array.from({ length: 2300 }, (_, i) => P(`p${String(i).padStart(5, "0")}`, `u${i}`));
  const users = profiles.map((p) => U(p.user_id));
  const admin = fakeAdmin({ profiles, users });
  const out = await sitemapMod.listPublicUsernames(admin);
  assert.equal(out.length, 2300);
  assert.equal(admin.calls.selects.filter((s) => s.startsWith("profiles")).length, 3, "1000 + 1000 + 300");
  assert.equal(admin.calls.selects.filter((s) => s.startsWith("users")).length, 12, "2300 ids / 200 per lookup");
});
await test("sitemap is cached and read-only; the 50,000-URL protocol limit is the only cap", () => {
  const s = src("src/app/sitemap.ts");
  assert.match(s, /export const revalidate = 3600/);
  assert.match(s, /SITEMAP_URL_LIMIT = 50000/);
  assert.ok(!/\.(insert|update|delete|upsert|rpc)\(/.test(s), "read-only");
  assert.ok(!/force-dynamic/.test(s));
});

console.log(`\nseoRobotsSitemap: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFAILURES:\n" + failures.map((f) => " - " + f).join("\n"));
  process.exit(1);
}
