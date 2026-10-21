// Shared behavioural check of src/middleware.ts for the MAIN site (any host that is not a profile-domain host). It replaces the old literal assertion
// `matcher: ["/dashboard/:path*", "/admin/:path*"]`: the matcher was widened so the middleware can see the Host of every request (custom profile addresses, see
// docs/profile-subdomains.md), so what must stay true is the BEHAVIOUR, which this runs for real:
//   - /dashboard and /admin still redirect a signed-out visitor to /auth/login (with ?next=), and a signed-in one passes;
//   - every other main-site path (public share links /d/*, /c/*, profiles, robots.txt, /api/* webhooks, /auth/*) passes through untouched, with no auth lookup at all;
//   - this holds with the profile domain both unset and configured.
// Supabase is replaced by stubs; no network. Throws (assert) on the first violation.
import fs from "fs";
import os from "os";
import path from "path";
import assert from "assert";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));

export async function assertMainSiteMiddlewareBehaviour() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mw-main-"));
  const state = { user: null, authCalls: 0 };
  globalThis.__mwMainState = state;
  const ssr = path.join(dir, "ssr.cjs");
  const server = path.join(dir, "server.cjs");
  fs.writeFileSync(ssr, `exports.createServerClient = () => ({ auth: { getUser: async () => { const s = globalThis.__mwMainState; s.authCalls++; return { data: { user: s.user } }; } } });`);
  fs.writeFileSync(server, `exports.createAdminClient = () => ({ from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }) });`);
  // The real @supabase/ssr is swapped in the module cache (jiti hands node_modules imports to native require), so the middleware gets the stub client.
  const ssrPath = require.resolve("@supabase/ssr", { paths: [REPO] });
  const savedSsr = require.cache[ssrPath];
  require.cache[ssrPath] = { id: ssrPath, filename: ssrPath, loaded: true, exports: require(ssr) };
  const jiti = require("jiti")(import.meta.url, { alias: { "@/lib/supabase/server": server, "@": path.join(REPO, "src") }, interopDefault: true, cache: false });
  const { NextRequest } = require(path.join(REPO, "node_modules/next/server.js"));
  const savedEnv = { ...process.env };
  try {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:9";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "x";
    process.env.NEXT_PUBLIC_SITE_URL = "https://ringoconnectltd.com";
    const mw = jiti(path.join(REPO, "src/middleware.ts"));
    const event = { waitUntil() {} };
    const hit = (p, host = "ringoconnectltd.com") => mw.middleware(new NextRequest(`https://${host}${p}`, { headers: { host } }), event);
    for (const domain of [undefined, "ringo.page"]) {
      if (domain) process.env.NEXT_PUBLIC_PROFILE_DOMAIN = domain; else delete process.env.NEXT_PUBLIC_PROFILE_DOMAIN;
      const tag = `profile domain ${domain || "unset"}`;
      state.user = null;
      for (const p of ["/dashboard", "/dashboard/billing", "/admin", "/admin/users"]) {
        const before = state.authCalls;
        const res = await hit(`${p}?a=1`);
        assert.equal(res.status, 307, `${tag}: signed-out ${p} must redirect`);
        const loc = new URL(res.headers.get("location"));
        assert.equal(loc.pathname, "/auth/login", `${tag}: ${p}`);
        assert.equal(loc.searchParams.get("next"), `${p}?a=1`, `${tag}: ${p} keeps its destination`);
        assert.ok(state.authCalls > before, `${tag}: ${p} checks the session`);
      }
      for (const p of ["/d/sharetoken", "/c/cardtoken", "/ada", "/ada/book", "/robots.txt", "/sitemap.xml", "/auth/login", "/get-started", "/api/webhooks/stripe", "/api/track", "/api/cron/downgrade-expired", "/"]) {
        const before = state.authCalls;
        const res = await hit(p);
        assert.equal(res.status, 200, `${tag}: ${p} must pass through`);
        assert.equal(res.headers.get("location"), null, `${tag}: ${p} must not redirect`);
        assert.equal(res.headers.get("x-middleware-rewrite"), null, `${tag}: ${p} must not be rewritten`);
        assert.equal(state.authCalls, before, `${tag}: ${p} must not touch auth`);
      }
      state.user = { id: "u1" };
      assert.equal((await hit("/dashboard")).status, 200, `${tag}: signed-in /dashboard passes`);
      assert.equal((await hit("/admin")).status, 200, `${tag}: signed-in /admin passes (page-level admin checks still apply)`);
    }
    // The widened matcher still excludes Next's build assets.
    const cfg = require("fs").readFileSync(path.join(REPO, "src/middleware.ts"), "utf8");
    assert.ok(/matcher: \["\/\(\(\?!_next\/static\|_next\/image\)\.\*\)"\]/.test(cfg), "matcher excludes only _next/static and _next/image");
  } finally {
    if (savedSsr) require.cache[ssrPath] = savedSsr; else delete require.cache[ssrPath];
    for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
    Object.assign(process.env, savedEnv);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
