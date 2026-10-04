// The guarded clean-up of a stray OAuth-only account (lib/auth/removeStrayOAuthUser) and the admin approve route's
// "email already exists" 409. No network, no database: Supabase is a fake. Every guard is tested failing ON ITS OWN,
// the delete-error path, the existing-account path, the single-helper rule, and the approve route's mapping.
//   Run:  node scripts/tests/oauthCleanup.test.mjs
import fs from "fs";
import path from "path";
import assert from "assert";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const jiti = require("jiti")(import.meta.url, { alias: { "@": SRC }, interopDefault: true, cache: false });

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
const quiet = async (fn) => {
  const original = console.error;
  const lines = [];
  console.error = (...a) => lines.push(a.join(" "));
  try {
    return { value: await fn(), lines };
  } finally {
    console.error = original;
  }
};

const { isStrayOAuthUser, STRAY_MAX_AGE_MS } = jiti(path.join(SRC, "lib/auth/strayOAuthUser.ts"));
const { removeStrayOAuthUser } = jiti(path.join(SRC, "lib/auth/removeStrayOAuthUser.ts"));
const { isEmailExistsError, EMAIL_EXISTS_MESSAGE } = jiti(path.join(SRC, "lib/auth/createUserError.ts"));
const serverMod = jiti(path.join(SRC, "lib/supabase/server.ts"));
const callback = jiti(path.join(SRC, "app/auth/callback/route.ts"));
const approve = jiti(path.join(SRC, "app/api/admin/requests/[id]/approve/route.ts"));

const NOW = Date.parse("2026-12-10T10:00:00.000Z");
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const GOOD = { identities: [{ provider: "google" }], createdAt: iso(5_000), role: "creator", profileCount: 0, paymentCount: 0, now: NOW };

// ------------------------------------------------------------------ the pure decision: each guard failing alone
await test("all guards holding: a brand-new, Google-only, empty, payment-free creator account is a stray", () => {
  assert.equal(isStrayOAuthUser(GOOD), true);
  assert.equal(isStrayOAuthUser({ ...GOOD, identities: [{ provider: "apple" }] }), true);
  assert.equal(isStrayOAuthUser({ ...GOOD, identities: [{ provider: "google" }, { provider: "apple" }] }), true);
});
await test("guard: identities. An email identity, any other provider, no identity at all, or a missing list is never a stray", () => {
  for (const identities of [[{ provider: "email" }], [{ provider: "google" }, { provider: "email" }], [{ provider: "github" }], [{ provider: "phone" }], [{ provider: "google" }, null], [], null, undefined, [{}], [{ provider: null }]])
    assert.equal(isStrayOAuthUser({ ...GOOD, identities }), false, JSON.stringify(identities));
});
await test("guard: profiles. Any profile, or an unreadable count, is never a stray", () => {
  for (const profileCount of [1, 2, null, undefined, -1]) assert.equal(isStrayOAuthUser({ ...GOOD, profileCount }), false, String(profileCount));
});
await test("guard: payment records. Any payment_transactions row, or an unreadable count, is never a stray", () => {
  for (const paymentCount of [1, 5, null, undefined]) assert.equal(isStrayOAuthUser({ ...GOOD, paymentCount }), false, String(paymentCount));
});
await test("guard: role. Only a creator row qualifies (admin, unknown, missing are not)", () => {
  for (const role of ["admin", "owner", "", null, undefined]) assert.equal(isStrayOAuthUser({ ...GOOD, role }), false, String(role));
});
await test("guard: age. Older than 60 s, unparseable, missing, or from the future is never a stray; the 60 s edge still is", () => {
  assert.equal(STRAY_MAX_AGE_MS, 60_000);
  assert.equal(isStrayOAuthUser({ ...GOOD, createdAt: iso(60_000) }), true);
  for (const createdAt of [iso(60_001), iso(3_600_000), iso(-6_000), "not a date", "", null, undefined]) assert.equal(isStrayOAuthUser({ ...GOOD, createdAt }), false, String(createdAt));
  assert.equal(isStrayOAuthUser({ ...GOOD, createdAt: iso(-4_000) }), true, "small clock skew is tolerated");
});

// ------------------------------------------------------------------ the helper against a fake service-role client
function fakeAdmin({ profiles = { count: 0, error: null }, owner = { data: { role: "creator" }, error: null }, payments = { count: 0, error: null }, del = { error: null }, throwOn = null } = {}) {
  const calls = { deleted: [], reads: [] };
  const admin = {
    from: (table) => {
      calls.reads.push(table);
      const result = table === "profiles" ? profiles : table === "payment_transactions" ? payments : owner;
      const b = {
        select: () => b,
        eq: () => b,
        maybeSingle: async () => {
          if (throwOn === table) throw new Error("boom");
          return result;
        },
        then: (resolve) => {
          if (throwOn === table) throw new Error("boom");
          return resolve(result);
        },
      };
      return b;
    },
    auth: {
      admin: {
        deleteUser: async (id) => {
          calls.deleted.push(id);
          if (throwOn === "delete") throw new Error("network down");
          return del;
        },
      },
    },
  };
  return { admin, calls };
}
const STRAY_USER = { id: "u-stray", identities: [{ provider: "google" }], created_at: new Date().toISOString() };

await test("helper: every guard holding deletes the user once, by id", async () => {
  const { admin, calls } = fakeAdmin();
  assert.equal(await removeStrayOAuthUser(admin, STRAY_USER), "deleted");
  assert.deepEqual(calls.deleted, ["u-stray"]);
  assert.deepEqual([...calls.reads].sort(), ["payment_transactions", "profiles", "users"]);
});
await test("helper: each guard failing on its own means NO delete", async () => {
  const cases = {
    "email identity present": [{}, { ...STRAY_USER, identities: [{ provider: "email" }, { provider: "google" }] }],
    "unsupported provider only": [{}, { ...STRAY_USER, identities: [{ provider: "github" }] }],
    "a profile exists": [{ profiles: { count: 1, error: null } }, STRAY_USER],
    "a payment record exists": [{ payments: { count: 1, error: null } }, STRAY_USER],
    "payment count unreadable": [{ payments: { count: null, error: { message: "x" } } }, STRAY_USER],
    "payment count missing": [{ payments: { count: null, error: null } }, STRAY_USER],
    "profile count unreadable": [{ profiles: { count: null, error: { message: "x" } } }, STRAY_USER],
    "role row unreadable": [{ owner: { data: null, error: { message: "x" } } }, STRAY_USER],
    "no users row": [{ owner: { data: null, error: null } }, STRAY_USER],
    "admin role": [{ owner: { data: { role: "admin" }, error: null } }, STRAY_USER],
    "older than 60 s": [{}, { ...STRAY_USER, created_at: new Date(Date.now() - 120_000).toISOString() }],
  };
  for (const [label, [opts, user]] of Object.entries(cases)) {
    const { admin, calls } = fakeAdmin(opts);
    const { value } = await quiet(() => removeStrayOAuthUser(admin, user));
    assert.notEqual(value, "deleted", label);
    assert.equal(calls.deleted.length, 0, `${label}: nothing deleted`);
  }
});
await test("helper: an unreadable guard is reported as such (and logged without any email or id)", async () => {
  const { admin } = fakeAdmin({ payments: { count: null, error: { message: "permission denied for payment_transactions" } } });
  const { value, lines } = await quiet(() => removeStrayOAuthUser(admin, STRAY_USER));
  assert.equal(value, "unreadable");
  assert.ok(lines.some((l) => /user not deleted/.test(l)) && !lines.join(" ").includes("u-stray"));
});
await test("helper: a refused delete (rolled back by the database) is logged and returned, never thrown", async () => {
  const { admin, calls } = fakeAdmin({ del: { error: { message: 'update or delete on table "users" violates foreign key constraint' } } });
  const { value, lines } = await quiet(() => removeStrayOAuthUser(admin, STRAY_USER));
  assert.equal(value, "failed");
  assert.equal(calls.deleted.length, 1);
  assert.ok(lines.some((l) => /oauth stray cleanup failed/.test(l) && /foreign key/.test(l)));
});
await test("helper: any thrown error (a read or the delete itself) is caught and logged", async () => {
  for (const throwOn of ["profiles", "users", "payment_transactions", "delete"]) {
    const { admin } = fakeAdmin({ throwOn });
    const { value, lines } = await quiet(() => removeStrayOAuthUser(admin, STRAY_USER));
    assert.equal(value, "failed", throwOn);
    assert.ok(lines.some((l) => /oauth stray cleanup threw/.test(l)), throwOn);
  }
});

// ------------------------------------------------------------------ the callback, end to end on the fakes
function fakeCallback({ user, row = { role: "creator", status: "active" }, admin }) {
  const events = [];
  serverMod.createClient = () => ({
    auth: {
      exchangeCodeForSession: async () => ({ error: null }),
      getUser: async () => ({ data: { user } }),
      signOut: async () => void events.push("signOut"),
    },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: row }) }) }) }),
  });
  const made = { count: 0 };
  serverMod.createAdminClient = () => {
    made.count++;
    if (admin === "throw") throw new Error("no service key");
    return admin.admin;
  };
  return { events, made };
}
const callbackGet = async (query = "?code=abc") => {
  const res = await callback.GET(new Request(`https://ringoconnectltd.com/auth/callback${query}`));
  return res.headers.get("location");
};
const OAUTH_ONLY = { id: "u-stray", identities: [{ provider: "google" }], created_at: new Date().toISOString() };

await test("callback: a real stray is refused, signed out FIRST, then removed once, and lands on no_account", async () => {
  const fa = fakeAdmin();
  const { events } = fakeCallback({ user: OAUTH_ONLY, admin: fa });
  fa.admin.auth.admin.deleteUser = async (id) => (events.push("delete:" + id), { error: null });
  assert.equal(await callbackGet(), "https://ringoconnectltd.com/auth/login?oauth_error=no_account");
  assert.deepEqual(events, ["signOut", "delete:u-stray"]);
});
await test("callback: when the delete errors, it is logged and the person STILL gets no_account", async () => {
  const fa = fakeAdmin({ del: { error: { message: "fk violation" } } });
  fakeCallback({ user: OAUTH_ONLY, admin: fa });
  const { value, lines } = await quiet(() => callbackGet());
  assert.equal(value, "https://ringoconnectltd.com/auth/login?oauth_error=no_account");
  assert.equal(fa.calls.deleted.length, 1);
  assert.ok(lines.some((l) => /oauth stray cleanup failed/.test(l)));
});
await test("callback: if the service-role client cannot even be made, the refusal still goes out and nothing is deleted", async () => {
  fakeCallback({ user: OAUTH_ONLY, admin: "throw" });
  const { value, lines } = await quiet(() => callbackGet());
  assert.equal(value, "https://ringoconnectltd.com/auth/login?oauth_error=no_account");
  assert.ok(lines.some((l) => /could not start/.test(l)));
});
await test("callback: an existing account (email identity present) never reaches the clean-up, whatever its state", async () => {
  const existing = { id: "u-existing", identities: [{ provider: "email" }, { provider: "google" }], created_at: new Date().toISOString() };
  for (const row of [{ role: "creator", status: "active" }, { role: "admin", status: "active" }, { role: "creator", status: "suspended" }, undefined]) {
    const fa = fakeAdmin();
    const { made } = fakeCallback({ user: existing, row, admin: fa });
    await callbackGet();
    assert.equal(made.count, 0, "no service-role client is even created");
    assert.equal(fa.calls.deleted.length, 0);
    assert.equal(fa.calls.reads.length, 0);
  }
});
await test("callback: cancel, provider errors, a missing code and a failed exchange never reach the clean-up", async () => {
  const fa = fakeAdmin();
  const { made } = fakeCallback({ user: OAUTH_ONLY, admin: fa });
  for (const q of ["?error=access_denied", "?error=server_error&error_description=x", "", "?code="]) await callbackGet(q);
  assert.equal(made.count, 0);
  assert.equal(fa.calls.deleted.length, 0);
});

// ------------------------------------------------------------------ source rules
await test("source: deleteUser is called from exactly one place in the sign-in code, and nowhere in the callback or the approve route", () => {
  const all = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && /\.auth\.admin\.deleteUser\(|deleteUser\(/.test(strip(fs.readFileSync(p, "utf8")))) all.push(path.relative(REPO, p).replace(/\\/g, "/"));
    }
  };
  walk(SRC);
  assert.deepEqual(all.sort(), ["src/app/api/cron/cleanup-demo-accounts/route.ts", "src/app/api/demo/create/route.ts", "src/lib/auth/removeStrayOAuthUser.ts"], "only the helper was added to the pre-existing demo-account clean-up callers");
  assert.equal((src("src/lib/auth/removeStrayOAuthUser.ts").match(/deleteUser\(/g) || []).length, 1);
  assert.ok(!/deleteUser/.test(src("src/app/auth/callback/route.ts")));
  assert.ok(!/deleteUser|\.auth\.admin\.(delete|update)/.test(src("src/app/api/admin/requests/[id]/approve/route.ts")), "the approve route never deletes a user");
});
await test("source: the helper and the callback keep their guards and types (no `any`)", () => {
  const helper = src("src/lib/auth/removeStrayOAuthUser.ts");
  const decision = src("src/lib/auth/strayOAuthUser.ts");
  assert.ok(!/\bany\b/.test(helper + decision + src("src/lib/auth/createUserError.ts")), "no any in the new auth helpers");
  assert.match(helper, /from\("payment_transactions"\)\.select\("id", \{ count: "exact", head: true \}\)\.eq\("user_id", user\.id\)/);
  assert.match(helper, /if \(profiles\.error \|\| owner\.error \|\| payments\.error\)/);
  assert.match(decision, /candidate\.profileCount !== 0 \|\| candidate\.paymentCount !== 0/);
  const cb = src("src/app/auth/callback/route.ts");
  assert.equal((cb.match(/removeStrayOAuthUser\(/g) || []).length, 1);
  const branch = cb.slice(cb.indexOf("if (!hasEmailIdentity(user))"), cb.indexOf("const access = await loadAccountAccess"));
  assert.match(branch, /await supabase\.auth\.signOut\(\);\s*await cleanUpStray\(user\);\s*return toLogin\("no_account"\);/);
});

// ------------------------------------------------------------------ the approve route's 409
await test("mapping: Supabase's email-exists error is recognised by code and by message; unrelated errors are not", () => {
  for (const err of [
    { code: "email_exists", message: "x" },
    { message: "A user with this email address has already been registered" },
    { message: "User already registered" },
    { message: "Email address already exists" },
  ]) assert.equal(isEmailExistsError(err), true, JSON.stringify(err));
  for (const err of [null, undefined, {}, { message: "Database error creating new user" }, { message: "username_taken" }, { message: "Username already exists" }, { message: "Password should be at least 6 characters" }, { code: "weak_password" }])
    assert.equal(isEmailExistsError(err), false, JSON.stringify(err));
});
function runApprove(createResult) {
  const calls = { created: 0, deleted: 0 };
  serverMod.createClient = () => ({
    auth: { getUser: async () => ({ data: { user: { id: "admin-1" } } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { role: "admin", can_approve_requests: true, affiliate_code: null } }) }) }) }),
  });
  const rows = { signup_requests: { id: "r1", status: "pending", referral_code: null }, plans: { id: "p1", price_usd: 0 }, profiles: null };
  serverMod.createAdminClient = () => ({
    from: (table) => {
      const b = new Proxy({}, {
        get(_t, prop) {
          if (prop === "single" || prop === "maybeSingle") return async () => ({ data: rows[table] ?? null, error: null });
          if (prop === "then") return (resolve) => resolve({ data: [], error: null });
          return () => b;
        },
      });
      return b;
    },
    auth: { admin: { createUser: async () => (calls.created++, createResult), deleteUser: async () => void calls.deleted++ } },
  });
  const body = { username: "ada", email: "ada@example.com", password: "secret-pw-1", fullName: "Ada", whatsappNumber: "+237677000000", planId: "p1", paymentMethod: "none" };
  const request = new Request("https://x/api/admin/requests/r1/approve", { method: "POST", body: JSON.stringify(body) });
  return approve.POST(request, { params: { id: "r1" } }).then(async (res) => ({ status: res.status, body: await res.json(), calls }));
}
await test("approve route: an existing email gives a clear 409 (code email_exists), nothing created, nothing deleted", async () => {
  for (const error of [{ code: "email_exists", message: "A user with this email address has already been registered", status: 422 }, { message: "User already registered" }]) {
    const r = await runApprove({ data: { user: null }, error });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, "email_exists");
    assert.equal(r.body.error, EMAIL_EXISTS_MESSAGE);
    assert.equal(r.calls.created, 1);
    assert.equal(r.calls.deleted, 0);
  }
  assert.match(EMAIL_EXISTS_MESSAGE, /still pending/);
});
await test("approve route: any other create-user failure is still the old 500 with the real message", async () => {
  const r = await runApprove({ data: { user: null }, error: { message: "Database error creating new user" } });
  assert.equal(r.status, 500);
  assert.deepEqual(r.body, { error: "Database error creating new user" });
  const r2 = await runApprove({ data: { user: null }, error: null });
  assert.equal(r2.status, 500);
  assert.equal(r2.body.error, "Could not create the account.");
  assert.equal(r2.calls.deleted, 0);
});
await test("approve route source: the 409 sits between the create-user call and the generic failure, and the rest of the route is untouched", () => {
  const s = src("src/app/api/admin/requests/[id]/approve/route.ts");
  const create = s.indexOf("adminClient.auth.admin.createUser(");
  const nine = s.indexOf("isEmailExistsError(createError)");
  const generic = s.indexOf("if (createError || !created.user)");
  assert.ok(create > 0 && nine > create && generic > nine);
  assert.match(s, /isEmailExistsError\(createError\)\) \{\s*return NextResponse\.json\(\{ error: EMAIL_EXISTS_MESSAGE, code: "email_exists" \}, \{ status: 409 \}\);/);
  assert.match(s, /fapshiGetStatus\(signupRequest\.pending_fapshi_trans_id\)/, "the payment re-verification is still there, before the user is created");
  assert.ok(s.indexOf("fapshiGetStatus(") < create);
});

console.log(`\noauthCleanup: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFAILURES:\n" + failures.map((f) => " - " + f).join("\n"));
  process.exit(1);
}
