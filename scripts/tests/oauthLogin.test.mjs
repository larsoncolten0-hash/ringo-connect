// "Continue with Google / Apple" on the Log in page: existing accounts only. No network, no database, no provider:
// Supabase is a fake. Pure rules are called directly; the callback and login routes run against the fake; the
// button component is server-rendered in EN and FR. Real provider sign-in needs external configuration and is NOT
// covered here (see the final report).
//   Run:  node scripts/tests/oauthLogin.test.mjs
import fs from "fs";
import path from "path";
import assert from "assert";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const jiti = require("jiti")(import.meta.url, { alias: { "@": SRC }, interopDefault: true, cache: false });
const { transform } = require("sucrase");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

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
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const src = (rel) => strip(fs.readFileSync(path.join(REPO, rel), "utf8").replace(/\r\n/g, "\n"));

const O = jiti(path.join(SRC, "lib/auth/oauthLogin.ts"));
const { translations } = jiti(path.join(SRC, "lib/i18n/translations.ts"));
const serverMod = jiti(path.join(SRC, "lib/supabase/server.ts"));
const callback = jiti(path.join(SRC, "app/auth/callback/route.ts"));
const loginRoute = jiti(path.join(SRC, "app/api/auth/login/route.ts"));

// ------------------------------------------------------------------ pure rules
await test("providers: Google always, Apple only when the flag is exactly 'true'", () => {
  assert.deepEqual(O.enabledProviders(undefined), ["google"]);
  for (const v of ["", "false", "TRUE", "1", "yes", " true"]) assert.deepEqual(O.enabledProviders(v), ["google"], v);
  assert.deepEqual(O.enabledProviders("true"), ["google", "apple"]);
});
await test("next: only a same-site absolute path is accepted; every open-redirect shape is refused", () => {
  assert.equal(O.safeNextPath("/dashboard"), "/dashboard");
  assert.equal(O.safeNextPath("/dashboard/shop?group=to_fulfill#x"), "/dashboard/shop?group=to_fulfill#x");
  for (const bad of ["//evil.com", "https://evil.com", "http://evil.com/x", "/\\evil.com", "\\\\evil.com", "javascript:alert(1)", "data:text/html,x", "evil.com", "", "/a\nb", "/a\u0000b", "/auth/callback?next=/x", null, undefined, 5, "/" + "a".repeat(600)])
    assert.equal(O.safeNextPath(bad), null, String(bad).slice(0, 30));
});
await test("invite token: base64url only, bounded; anything that could carry a path, scheme or query is dropped", () => {
  const token = "abcDEF0123456789_-abcDEF0123456789_-abc";
  assert.equal(O.safeInviteToken(token), token);
  for (const bad of ["a", "../x", "x/y", "https://evil.com", "a b", "tok?x=1", "tok#x", "", null, undefined, "x".repeat(200)]) assert.equal(O.safeInviteToken(bad), null, String(bad).slice(0, 20));
});
await test("destination: invitation first, then a safe next, then the role's home (same order as the email login)", () => {
  const t = "abcDEF0123456789_-abcDEF0123456789_-abc";
  assert.equal(O.resolveDestination({ role: "creator" }), "/dashboard/home"); // everyone lands on Ringo Home, not the editor
  assert.equal(O.resolveDestination({ role: "admin" }), "/admin");
  assert.equal(O.resolveDestination({ role: undefined }), "/dashboard/home");
  assert.equal(O.resolveDestination({ role: "admin", invite: t }), `/team/invite/${t}`);
  assert.equal(O.resolveDestination({ role: "creator", next: "/dashboard/shop" }), "/dashboard/shop");
  assert.equal(O.resolveDestination({ role: "creator", invite: t, next: "/dashboard/shop" }), `/team/invite/${t}`);
  assert.equal(O.resolveDestination({ role: "creator", next: "//evil.com" }), "/dashboard/home");
  assert.equal(O.resolveDestination({ role: "admin", invite: "../../x", next: "https://evil.com" }), "/admin");
});
await test("provider errors map to our keys: cancelled, no_account (Database error saving new user), failed; no error gives null", () => {
  const p = (o) => ({ get: (k) => o[k] ?? null });
  assert.equal(O.oauthErrorFromParams(p({})), null);
  assert.equal(O.oauthErrorFromParams(p({ error: "access_denied" })), "cancelled");
  assert.equal(O.oauthErrorFromParams(p({ error_code: "user_cancelled" })), "cancelled");
  assert.equal(O.oauthErrorFromParams(p({ error: "server_error", error_code: "unexpected_failure", error_description: "Database error saving new user" })), "no_account");
  assert.equal(O.oauthErrorFromParams(p({ error: "server_error", error_description: "something else" })), "failed");
  assert.equal(O.oauthErrorFromParams(p({ error: "<script>alert(1)</script>" })), "failed");
  assert.ok(O.isOAuthErrorKey("no_account") && !O.isOAuthErrorKey("<script>") && !O.isOAuthErrorKey(undefined));
});
await test("an existing Ringo account is recognised by its email identity; an OAuth-only user is not", () => {
  assert.equal(O.hasEmailIdentity({ identities: [{ provider: "email" }, { provider: "google" }] }), true);
  assert.equal(O.hasEmailIdentity({ identities: [{ provider: "google" }] }), false);
  assert.equal(O.hasEmailIdentity({ identities: [{ provider: "apple" }] }), false);
  for (const v of [{ identities: [] }, { identities: null }, {}, null, undefined]) assert.equal(O.hasEmailIdentity(v), false);
});

// ------------------------------------------------------------------ the callback route against a fake Supabase
const TOKEN = "abcDEF0123456789_-abcDEF0123456789_-abc";
function fake({ exchangeError = null, user = null, row = undefined } = {}) {
  const calls = { signOut: 0, exchanged: null, deleted: 0 };
  const client = {
    auth: {
      exchangeCodeForSession: async (code) => ((calls.exchanged = code), { error: exchangeError }),
      getUser: async () => ({ data: { user } }),
      signOut: async () => void calls.signOut++,
      admin: { deleteUser: async () => void calls.deleted++ },
    },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: row ?? null }) }) }) }),
  };
  serverMod.createClient = () => client;
  // the service-role client used only by the guarded stray clean-up: here a profile exists, so no guard lets a delete through
  serverMod.createAdminClient = () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: "creator" }, error: null }), then: (resolve) => resolve({ count: 1, error: null }) }) }) }),
    auth: { admin: { deleteUser: async () => void calls.deleted++ } },
  });
  return calls;
}
const get = async (query) => {
  const res = await callback.GET(new Request(`https://ringoconnectltd.com/auth/callback${query}`));
  return { status: res.status, location: res.headers.get("location") };
};
const EXISTING = { id: "u1", identities: [{ provider: "email" }, { provider: "google" }] };
const NEW_ONLY = { id: "u2", identities: [{ provider: "google" }] };

await test("callback: an existing account (email identity linked to Google) is signed in and sent to its dashboard", async () => {
  const calls = fake({ user: EXISTING, row: { role: "creator", status: "active" } });
  const r = await get("?code=abc");
  assert.equal(r.location, "https://ringoconnectltd.com/dashboard/home");
  assert.equal(calls.exchanged, "abc");
  assert.equal(calls.signOut, 0);
});
await test("callback: an admin goes to /admin; a pending invitation wins; a safe next is honoured; an unsafe next is ignored", async () => {
  fake({ user: EXISTING, row: { role: "admin", status: "active" } });
  assert.equal((await get("?code=abc")).location, "https://ringoconnectltd.com/admin");
  assert.equal((await get(`?code=abc&invite=${TOKEN}`)).location, `https://ringoconnectltd.com/team/invite/${TOKEN}`);
  assert.equal((await get("?code=abc&next=/dashboard/shop")).location, "https://ringoconnectltd.com/dashboard/shop");
  for (const next of ["//evil.com", "https://evil.com", "javascript:alert(1)"]) {
    const loc = (await get(`?code=abc&next=${encodeURIComponent(next)}`)).location;
    assert.ok(new URL(loc).origin === "https://ringoconnectltd.com", next);
    assert.equal(new URL(loc).pathname, "/admin", next);
  }
  assert.equal(new URL((await get("?code=abc&next=%2F%255Cevil.com")).location).origin, "https://ringoconnectltd.com", "a percent-encoded backslash is just a same-site path");
});
await test("callback: a person who exists ONLY through this OAuth sign-in is refused and signed out (and not deleted while a clean-up guard fails; the clean-up itself is covered in oauthCleanup.test.mjs)", async () => {
  const calls = fake({ user: NEW_ONLY, row: { role: "creator", status: "active" } });
  const r = await get("?code=abc");
  assert.equal(r.location, "https://ringoconnectltd.com/auth/login?oauth_error=no_account");
  assert.equal(calls.signOut, 1);
  assert.equal(calls.deleted, 0);
});
await test("callback: no users row, or a suspended account, is refused with the right key and a signed-out session", async () => {
  let calls = fake({ user: EXISTING, row: undefined });
  assert.equal((await get("?code=abc")).location, "https://ringoconnectltd.com/auth/login?oauth_error=no_account");
  assert.equal(calls.signOut, 1);
  calls = fake({ user: EXISTING, row: { role: "creator", status: "suspended" } });
  assert.equal((await get("?code=abc")).location, "https://ringoconnectltd.com/auth/login?oauth_error=suspended");
  assert.equal(calls.signOut, 1);
});
await test("callback: cancel / provider error / missing code / failed exchange / no user all end on Log in safely, nothing is exchanged when there is an error", async () => {
  let calls = fake({ user: EXISTING, row: { role: "creator" } });
  assert.equal((await get("?error=access_denied&error_description=The+user+denied")).location, "https://ringoconnectltd.com/auth/login?oauth_error=cancelled");
  assert.equal(calls.exchanged, null);
  assert.equal((await get("?error=server_error&error_code=unexpected_failure&error_description=Database+error+saving+new+user")).location, "https://ringoconnectltd.com/auth/login?oauth_error=no_account");
  assert.equal((await get("")).location, "https://ringoconnectltd.com/auth/login?oauth_error=failed");
  calls = fake({ exchangeError: { message: "bad code" }, user: EXISTING, row: { role: "creator" } });
  assert.equal((await get("?code=bad")).location, "https://ringoconnectltd.com/auth/login?oauth_error=failed");
  calls = fake({ user: null });
  assert.equal((await get("?code=abc")).location, "https://ringoconnectltd.com/auth/login?oauth_error=failed");
});
await test("callback: the invitation survives a refusal (so a retry keeps it) and a hostile invite never reaches the URL", async () => {
  fake({ user: NEW_ONLY, row: { role: "creator" } });
  assert.equal((await get(`?code=abc&invite=${TOKEN}`)).location, `https://ringoconnectltd.com/auth/login?oauth_error=no_account&invite=${TOKEN}`);
  assert.equal((await get("?code=abc&invite=../../evil")).location, "https://ringoconnectltd.com/auth/login?oauth_error=no_account");
});
await test("callback source: never creates or edits anything and never touches provider tokens; its only delete goes through the one guarded helper", () => {
  const s = src("src/app/auth/callback/route.ts");
  assert.ok(!/\.(insert|update|delete|upsert|rpc)\(|\.auth\.admin|deleteUser|provider_token|provider_refresh_token/.test(s));
  assert.match(s, /loadAccountAccess\(supabase, user\.id\)/);
  assert.match(s, /removeStrayOAuthUser\(createAdminClient\(\), user\)/);
});

// ------------------------------------------------------------------ the email login keeps its behaviour
function fakeLogin({ signIn = { data: { user: { id: "u1" } }, error: null }, row = { role: "creator", status: "active" } } = {}) {
  const calls = { signOut: 0 };
  serverMod.createClient = () => ({
    auth: { signInWithPassword: async () => signIn, signOut: async () => void calls.signOut++ },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: row }) }) }) }),
  });
  return calls;
}
const login = async (body) => {
  const res = await loginRoute.POST(new Request("https://x/api/auth/login", { method: "POST", body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
};
await test("email login: same results as before through the shared check (ok creator, ok admin, suspended 403 + signOut, wrong password 401)", async () => {
  fakeLogin();
  assert.deepEqual(await login({ identifier: "a@b.com", password: "x" }), { status: 200, body: { ok: true, role: "creator" } });
  fakeLogin({ row: { role: "admin", status: "active" } });
  assert.deepEqual((await login({ identifier: "a@b.com", password: "x" })).body, { ok: true, role: "admin" });
  fakeLogin({ row: null });
  assert.deepEqual((await login({ identifier: "a@b.com", password: "x" })).body, { ok: true, role: "creator" }, "a missing row keeps the old default role");
  const calls = fakeLogin({ row: { role: "creator", status: "suspended" } });
  assert.deepEqual(await login({ identifier: "a@b.com", password: "x" }), { status: 403, body: { error: "suspended" } });
  assert.equal(calls.signOut, 1);
  fakeLogin({ signIn: { data: { user: null }, error: { message: "Invalid login credentials" } } });
  assert.deepEqual(await login({ identifier: "a@b.com", password: "x" }), { status: 401, body: { error: "generic" } });
  fakeLogin({ signIn: { data: { user: null }, error: { message: "Email not confirmed" } } });
  assert.deepEqual((await login({ identifier: "a@b.com", password: "x" })).body, { error: "unconfirmed", email: "a@b.com" });
});
await test("email login source: the suspended check is the shared helper, nothing else in the route changed shape", () => {
  const s = src("src/app/api/auth/login/route.ts");
  assert.match(s, /loadAccountAccess\(supabase, data\.user\.id\)/);
  assert.match(s, /if \(access\.suspended\)/);
  assert.ok(!/userRow/.test(s));
  assert.match(s, /signInWithPassword\(\{ email, password \}\)/);
});

// ------------------------------------------------------------------ the buttons (server-rendered, EN and FR)
let LOCALE = "en";
let QUERY = "";
const cache = new Map();
const resolveSrc = (id) => {
  const base = path.join(SRC, id.slice(2));
  for (const ext of ["", ".tsx", ".ts", "/index.tsx", "/index.ts"]) if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return base + ext;
  throw new Error("cannot resolve " + id);
};
const stubs = {
  "@/components/LanguageProvider": { useLanguage: () => ({ locale: LOCALE, t: translations[LOCALE], setLocale() {} }) },
  "next/navigation": { useSearchParams: () => new URLSearchParams(QUERY) },
  "@/lib/supabase/client": { createClient: () => ({ auth: { signInWithOAuth: async () => ({ error: null }) } }) },
};
function load(file) {
  if (!file.endsWith(".tsx")) return jiti(file);
  if (cache.has(file)) return cache.get(file).exports;
  const mod = { exports: {} };
  cache.set(file, mod);
  const code = transform(fs.readFileSync(file, "utf8"), { transforms: ["typescript", "jsx", "imports"], jsxRuntime: "automatic", production: true }).code;
  const req = (id) => (stubs[id] ? stubs[id] : id.startsWith("@/") ? load(resolveSrc(id)) : require(id));
  new Function("require", "module", "exports", code)(req, mod, mod.exports);
  return mod.exports;
}
const OAuthButtons = load(path.join(SRC, "components/auth/OAuthButtons.tsx")).default;
const render = (lang, query = "", apple) => {
  LOCALE = lang;
  QUERY = query;
  if (apple === undefined) delete process.env.NEXT_PUBLIC_APPLE_LOGIN_ENABLED;
  else process.env.NEXT_PUBLIC_APPLE_LOGIN_ENABLED = apple;
  return renderToStaticMarkup(React.createElement(OAuthButtons)).replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&");
};

await test("buttons: Google is shown, Apple is hidden by default, in English and French", () => {
  for (const [lang, g] of [["en", "Continue with Google"], ["fr", "Continuer avec Google"]]) {
    const h = render(lang);
    assert.ok(h.includes(g), lang);
    assert.ok(!/Apple/.test(h), `${lang}: Apple hidden without the flag`);
    assert.equal((h.match(/<button/g) || []).length, 1);
  }
});
await test("buttons: Apple appears only when the flag is 'true', as a second full-width button", () => {
  assert.ok(!/Apple/.test(render("en", "", "false")));
  const en = render("en", "", "true");
  assert.ok(en.includes("Continue with Google") && en.includes("Continue with Apple"));
  assert.equal((en.match(/<button/g) || []).length, 2);
  assert.ok(render("fr", "", "true").includes("Continuer avec Apple"));
});
await test("buttons: 44px full-width targets, button type, group label, divider is decorative", () => {
  const h = render("en", "", "true");
  for (const b of h.match(/<button[^>]*>/g)) assert.ok(/type="button"/.test(b) && /w-full/.test(b) && /min-h-\[44px\]/.test(b), b);
  assert.match(h, /role="group" aria-label="Log in with another account"/);
  assert.match(h, /aria-hidden="true"><span class="h-px/);
  assert.ok(render("fr").includes('aria-label="Se connecter avec un autre compte"'));
});
await test("buttons: every OAuth error key from the URL is worded in the visitor's language; unknown keys show nothing", () => {
  for (const [key, field] of [["cancelled", "cancelled"], ["failed", "failed"], ["no_account", "noAccount"], ["suspended", "suspended"]]) {
    for (const lang of ["en", "fr"]) {
      const h = render(lang, `oauth_error=${key}`);
      assert.ok(h.includes(translations[lang].oauthLogin[field]), `${lang} ${key}`);
      assert.match(h, /border-red-500\/30/);
      assert.match(h, /role="status"/);
    }
  }
  assert.ok(!/border-red-500/.test(render("en", "oauth_error=%3Cscript%3E")));
  assert.ok(!/border-red-500/.test(render("en", "")));
});
await test("buttons source: PKCE sign-in with a same-origin /auth/callback redirect, Apple scopes name+email, loading and disabled states, no tokens stored", () => {
  const s = src("src/components/auth/OAuthButtons.tsx");
  assert.match(s, /redirectTo = `\$\{window\.location\.origin\}\/auth\/callback/);
  assert.match(s, /signInWithOAuth\(\{\s*provider,\s*options: \{ redirectTo, \.\.\.\(provider === "apple" \? \{ scopes: "name email" \} : \{\}\) \}/);
  assert.match(s, /disabled=\{busy !== null\}/);
  assert.match(s, /aria-busy=\{busy === provider\}/);
  assert.match(s, /c\.redirecting/);
  assert.ok(!/localStorage|sessionStorage|provider_token|access_token/.test(s));
  assert.ok(!/>\s*Continue with|>\s*Redirecting/.test(s), "no hard-coded English labels");
});

// ------------------------------------------------------------------ placement and scope
await test("placement: only the Log in page, under the unchanged form; /auth/signup, /get-started and the middleware are untouched", () => {
  const login = src("src/app/auth/login/page.tsx");
  const form = login.indexOf("</form>");
  const buttons = login.indexOf("<OAuthButtons />");
  const create = login.indexOf("Don't have a page yet?");
  assert.ok(form > 0 && buttons > form && create > buttons, "form, then the buttons, then the 'Create one' link");
  for (const keep of ['label="Email or username"', 'label="Password"', "Forgot password?", "<SubmitButton", "/api/auth/login"]) assert.ok(login.includes(keep), keep);
  for (const f of ["src/app/auth/signup/page.tsx", "src/components/GetStartedFlow.tsx", "src/middleware.ts"]) if (fs.existsSync(path.join(REPO, f))) assert.ok(!/OAuthButtons|signInWithOAuth/.test(src(f)), f);
  assert.match(src("src/middleware.ts"), /matcher: \["\/dashboard\/:path\*", "\/admin\/:path\*"\]/);
});
await test("EN/FR: oauthLogin has the same keys in both languages, every text differs, nothing is empty", () => {
  const en = translations.en.oauthLogin;
  const fr = translations.fr.oauthLogin;
  assert.deepEqual(Object.keys(en).sort(), Object.keys(fr).sort());
  for (const k of Object.keys(en)) {
    assert.ok(typeof en[k] === "string" && en[k].length > 0 && typeof fr[k] === "string" && fr[k].length > 0, k);
    assert.notEqual(en[k], fr[k], k);
  }
  assert.equal(fr.continueGoogle, "Continuer avec Google");
  assert.equal(fr.continueApple, "Continuer avec Apple");
});
await test("env: the Apple flag is documented and off by default", () => {
  const env = fs.readFileSync(path.join(REPO, ".env.example"), "utf8");
  assert.match(env, /^NEXT_PUBLIC_APPLE_LOGIN_ENABLED=false$/m);
  assert.match(env, /expires every\s*\n#\s*6 months/);
  assert.ok(!/BEGIN (EC |RSA )?PRIVATE KEY|GOCSPX-|eyJhbGciOi/.test(env), "no secret, key or client-secret JWT is committed in the example file");
});

// ------------------------------------------------------------------ dot-segment / normalization regression (open redirect)
// The URL parser resolves "." and ".." segments (also as %2e / %2E). A value such as "/.//evil.com" therefore NORMALIZES to
// "//evil.com", which `new URL(path, origin)` turns into https://evil.com/. These tests assert the property on the real
// normalized URL, not on the raw string.
const SITE = "https://ringoconnectltd.com";
const staysOnSite = (path) => {
  const u = new URL(path, SITE);
  return u.origin === SITE && path.startsWith("/") && !path.startsWith("//");
};

await test("next: dot-segment forms that normalize to a protocol-relative URL are refused (every one of them)", () => {
  for (const bad of [
    "/.//evil.com",
    "/%2e//evil.com",
    "/%2E%2E//evil.com",
    "/%2e%2e//evil.com",
    "/a/..//evil.com",
    "/a/b/../..//evil.com",
    "/dashboard/..//evil.com",
    "/././/evil.com",
    "/%2e/%2e//evil.com",
    "/.//",
    "/..//",
    "/.//\\evil.com",
    "/..;/..//evil.com",
  ])
    assert.equal(O.safeNextPath(bad), null, bad);
});
await test("next: other normalizing forms that stay on the site are accepted ONLY as the safe normalized path", () => {
  assert.equal(O.safeNextPath("/./"), "/");
  assert.equal(O.safeNextPath("/./evil.com"), "/evil.com");
  assert.equal(O.safeNextPath("/dashboard/../admin"), "/admin");
  assert.equal(O.safeNextPath("/a/b/../c"), "/a/c");
  assert.equal(O.safeNextPath("/dashboard/../../evil.com"), "/evil.com", "stays a path on this site, never another host");
  assert.equal(O.safeNextPath("//"), null);
  assert.equal(O.safeNextPath("///"), null);
});
await test("next: percent-encoded slashes and backslashes in the path are refused", () => {
  for (const bad of ["/%2F%2Fevil.com", "/%2f%2fevil.com", "/%5cevil.com", "/%5Cevil.com", "/a%2F%2Fevil.com", "/a/%5c%5cevil.com"]) assert.equal(O.safeNextPath(bad), null, bad);
});
await test("next: ordinary internal paths are accepted unchanged", () => {
  for (const ok of ["/", "/dashboard", "/dashboard?x=1", "/admin", "/some/internal/path", "/some/internal/path?foo=bar", "/dashboard/shop?group=to_fulfill#x"]) assert.equal(O.safeNextPath(ok), ok, ok);
});
await test("next: PROPERTY — for ~10,000 generated paths made of dot-segments, slashes, encodings and hosts, an accepted value never leaves the site", () => {
  const parts = ["/", "/.", "/..", "/%2e", "/%2E%2E", "/%2e%2e", "//", "/evil.com", "/a", "/dashboard", "?x=1", "#f", "%2F", "%5c", ";", "/..;"];
  let accepted = 0;
  let total = 0;
  const walk = (prefix, depth) => {
    total++;
    const r = O.safeNextPath(prefix);
    if (r !== null) {
      accepted++;
      assert.ok(staysOnSite(r), `${JSON.stringify(prefix)} -> ${JSON.stringify(r)} escapes the origin`);
    }
    if (depth === 0) return;
    for (const p of parts) walk(prefix + p, depth - 1);
  };
  for (const start of parts) walk(start, 3);
  assert.ok(total > 10000 && accepted > 100, `total ${total}, accepted ${accepted}`);
});
await test("destination: resolveDestination never returns anything that can leave the site, whatever next is", () => {
  for (const next of ["/.//evil.com", "/%2e//evil.com", "/a/..//evil.com", "//evil.com", "https://evil.com", "/.//"]) {
    const d = O.resolveDestination({ role: "creator", next });
    assert.equal(d, "/dashboard/home", next);
  }
  assert.equal(O.resolveDestination({ role: "admin", next: "/./" }), "/");
});
await test("redirect guard: sameOriginRedirect keeps same-site targets and replaces anything else with the safe fallback", () => {
  assert.equal(O.sameOriginRedirect("/dashboard?x=1", SITE).href, `${SITE}/dashboard?x=1`);
  assert.equal(O.sameOriginRedirect("//evil.com", SITE).href, `${SITE}/dashboard`);
  assert.equal(O.sameOriginRedirect("https://evil.com/x", SITE).href, `${SITE}/dashboard`);
  assert.equal(O.sameOriginRedirect("http://[bad", SITE).href, `${SITE}/dashboard`);
  assert.equal(O.sameOriginRedirect("//evil.com", SITE, "/admin").href, `${SITE}/admin`);
  assert.equal(O.sameOriginRedirect("https://ringoconnectltd.com.evil.com/", SITE).href, `${SITE}/dashboard`);
  assert.equal(O.sameOriginRedirect("/team/invite/x", "https://preview-abc.vercel.app").href, "https://preview-abc.vercel.app/team/invite/x");
});
await test("callback: for EVERY next value the final redirect stays on the request's origin (and never errors), accepted or not", async () => {
  fake({ user: EXISTING, row: { role: "creator", status: "active" } });
  const accepted = { "/": "/", "/dashboard": "/dashboard", "/dashboard?x=1": "/dashboard?x=1", "/admin": "/admin", "/some/internal/path": "/some/internal/path", "/some/internal/path?foo=bar": "/some/internal/path?foo=bar", "/./": "/" };
  for (const [next, path] of Object.entries(accepted)) {
    const r = await get(`?code=abc&next=${encodeURIComponent(next)}`);
    assert.equal(r.location, `https://ringoconnectltd.com${path}`, next);
  }
  const hostile = ["/.//evil.com", "/%2e//evil.com", "/%2E%2E//evil.com", "/a/..//evil.com", "/.//", "//", "///", "//evil.com", "https://evil.com", "http://evil.com", "/%2F%2Fevil.com", "/%5cevil.com", "/\\evil.com", "/a\r\nb", "/auth/callback", "/auth/callback?x=1", "javascript:alert(1)", "/" + "a".repeat(700)];
  for (const next of hostile) {
    const r = await get(`?code=abc&next=${encodeURIComponent(next)}`);
    assert.equal(r.status, 307, next);
    assert.equal(new URL(r.location).origin, "https://ringoconnectltd.com", next);
    assert.equal(new URL(r.location).pathname, "/dashboard/home", `${next}: refused values fall back to the role's home`);
  }
});
await test("callback: a preview or proxy origin is respected (the redirect always stays on whatever origin the request came from)", async () => {
  fake({ user: EXISTING, row: { role: "creator", status: "active" } });
  const res = await callback.GET(new Request("https://preview-abc.vercel.app/auth/callback?code=abc&next=%2F.%2F%2Fevil.com"));
  assert.equal(new URL(res.headers.get("location")).origin, "https://preview-abc.vercel.app");
  assert.equal(new URL(res.headers.get("location")).pathname, "/dashboard/home");
});
await test("callback source: the final redirect goes through the same-origin guard, not a bare new URL(...)", () => {
  const s = src("src/app/auth/callback/route.ts");
  assert.match(s, /NextResponse\.redirect\(sameOriginRedirect\(resolveDestination\(/);
  assert.ok(!/NextResponse\.redirect\(new URL\(resolveDestination/.test(s));
});

console.log(`\noauthLogin: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFAILURES:\n" + failures.map((f) => " - " + f).join("\n"));
  process.exit(1);
}
