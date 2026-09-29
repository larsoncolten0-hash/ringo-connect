// A suspended account's public profile must be unavailable to view.
// No network, no database: the service-role client is a fake. Behaviour of the helper, the profile
// metadata and the manifest route is exercised directly; the page routes (which import React
// components) are checked statically to make sure every one of them is gated before it renders.
//
//   Run:  node scripts/tests/suspendedProfile.test.mjs
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const jiti = require("jiti")(import.meta.url, { alias: { "@": path.join(REPO, "src") }, interopDefault: true });
const load = (p) => jiti(path.join(REPO, "src", p));
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond });
  if (!cond) console.log("  FAIL:", name, "|", detail);
};
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

// ------------------------------------------------------------------ fake admin client
function fakeAdmin({ profiles = [], users = [], failOn = null } = {}) {
  const tables = { profiles, users };
  const calls = [];
  return {
    _calls: calls,
    from(table) {
      const filters = [];
      const q = {
        select: () => q,
        eq(k, v) {
          filters.push((r) => r[k] === v);
          return q;
        },
        maybeSingle: async () => {
          calls.push(table);
          if (failOn === table) return { data: null, error: { message: `${table} down` } };
          if (failOn === "throw") throw new Error("boom");
          return { data: tables[table].find((r) => filters.every((f) => f(r))) ?? null, error: null };
        },
      };
      return q;
    },
  };
}
const serverMod = load("lib/supabase/server.ts");
const { isPublicProfileSuspended } = load("lib/publicProfileVisibility.ts");

const PROFILES = [
  { username: "active-amy", user_id: "u-active" },
  { username: "suspended-sam", user_id: "u-susp" },
  { username: "orphan", user_id: null },
];
const USERS = [
  { id: "u-active", status: "active" },
  { id: "u-susp", status: "suspended" },
];

// ================================================================== the helper
{
  serverMod.createAdminClient = () => fakeAdmin({ profiles: PROFILES, users: USERS });
  check("helper: a suspended owner's profile is reported suspended", (await isPublicProfileSuspended("suspended-sam")) === true);
  check("helper: an active owner's profile is not", (await isPublicProfileSuspended("active-amy")) === false);
  check("helper: an unknown username is not (the route's own 404 handles it)", (await isPublicProfileSuspended("nobody")) === false);
  check("helper: a profile with no owner is not reported suspended", (await isPublicProfileSuspended("orphan")) === false);

  // Live, not stored: un-suspending restores it with no other change.
  const users = [{ id: "u-susp", status: "suspended" }];
  serverMod.createAdminClient = () => fakeAdmin({ profiles: PROFILES, users });
  const before = await isPublicProfileSuspended("suspended-sam");
  users[0].status = "active";
  const after = await isPublicProfileSuspended("suspended-sam");
  check("helper: it reads users.status live — un-suspending immediately restores the profile", before === true && after === false);

  // Fail open, and say so in the log.
  serverMod.createAdminClient = () => fakeAdmin({ profiles: PROFILES, users: USERS, failOn: "users" });
  const r1 = await quiet(() => isPublicProfileSuspended("suspended-sam"));
  serverMod.createAdminClient = () => fakeAdmin({ profiles: PROFILES, users: USERS, failOn: "profiles" });
  const r2 = await quiet(() => isPublicProfileSuspended("suspended-sam"));
  serverMod.createAdminClient = () => fakeAdmin({ failOn: "throw" });
  const r3 = await quiet(() => isPublicProfileSuspended("x"));
  check("helper: if the lookup errors (either query, or a throw) it fails OPEN — a database hiccup must not blank every profile — and logs it", r1.value === false && r2.value === false && r3.value === false && r1.lines.length === 1 && r2.lines.length === 1 && r3.lines.length === 1);
  const src = read("src/lib/publicProfileVisibility.ts");
  check("helper: it only reads (select), never writes, and never touches the profile's published flag", !/\.(update|insert|delete|upsert)\(/.test(src) && !/published/.test(src.replace(/\/\/.*$/gm, "")));
}

// ================================================================== profile metadata (title, icons, theme colour)
{
  const supabaseStub = (profile) => ({ from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: profile }) }) }) }) }) });
  const PROFILE = { name: "Sam", username: "suspended-sam", avatar_url: "https://x/avatar.png", bio: "secret bio", theme_color: "#ff0000", category: "x", is_demo: false };
  const meta = load("lib/profileMetadata.ts");

  serverMod.createClient = () => supabaseStub(PROFILE);
  serverMod.createAdminClient = () => fakeAdmin({ profiles: PROFILES, users: USERS });
  const suspendedMeta = await meta.generateMetadata({ params: { username: "suspended-sam" } }, undefined);
  const suspendedViewport = await meta.generateViewport({ params: { username: "suspended-sam" } });
  check("metadata: a suspended profile leaks no title, description, icon or manifest link", JSON.stringify(suspendedMeta) === "{}", JSON.stringify(suspendedMeta));
  check("metadata: ...and its viewport carries the default theme colour, not the profile's", suspendedViewport.themeColor === "#4F46E5", suspendedViewport.themeColor);

  const ACTIVE = { ...PROFILE, name: "Amy", username: "active-amy", theme_color: "#00ff00" };
  serverMod.createClient = () => supabaseStub(ACTIVE);
  const activeMeta = await meta.generateMetadata({ params: { username: "active-amy" } }, undefined);
  const activeViewport = await meta.generateViewport({ params: { username: "active-amy" } });
  check("metadata: an active profile is completely unchanged (title, manifest, theme colour)", activeMeta.title === "Amy | Ringo Connect" && activeMeta.manifest === "/active-amy/manifest.webmanifest" && activeViewport.themeColor === "#00ff00");
}

// ================================================================== the PWA manifest route (installability)
{
  const { GET } = load("app/[username]/manifest.webmanifest/route.ts");
  const stub = (profile) => ({ from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: profile }) }) }) }) }) });
  const base = { name: "X", username: "u", avatar_url: null, theme_color: "#111111", background_color: "#ffffff", published: true };

  serverMod.createClient = () => stub({ ...base, username: "suspended-sam" });
  serverMod.createAdminClient = () => fakeAdmin({ profiles: PROFILES, users: USERS });
  const denied = await GET(new Request("http://x"), { params: { username: "suspended-sam" } });
  check("manifest: a suspended profile is not installable — 404, same as a profile that doesn't exist", denied.status === 404 && (await denied.json()).error === "Not found");

  serverMod.createClient = () => stub({ ...base, username: "active-amy" });
  const allowed = await GET(new Request("http://x"), { params: { username: "active-amy" } });
  check("manifest: an active profile still returns its manifest (200)", allowed.status === 200);
  serverMod.createClient = () => stub(null);
  const missing = await GET(new Request("http://x"), { params: { username: "nobody" } });
  check("manifest: an unknown profile still 404s as before", missing.status === 404);
}

// ================================================================== every public profile route is gated
{
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const routes = {
    "src/app/[username]/page.tsx": /if \(!profile\) return notFound\(\);\s*if \(await isPublicProfileSuspended\(params\.username\)\) return notFound\(\);/,
    "src/app/[username]/item/[id]/page.tsx": /if \(!profile\) return null;\s*if \(await isPublicProfileSuspended\(username\)\) return null;/,
    "src/app/[username]/item/[id]/checkout/page.tsx": /if \(!profile\) return null;\s*if \(await isPublicProfileSuspended\(username\)\) return null;/,
    "src/app/[username]/book/page.tsx": /bookings_enabled\) return notFound\(\);\s*if \(await isPublicProfileSuspended\(params\.username\)\) return notFound\(\);/,
    "src/app/[username]/community/page.tsx": /isCommunityEnabled\(profile\)\) return notFound\(\);\s*if \(await isPublicProfileSuspended\(params\.username\)\) return notFound\(\);/,
    "src/app/[username]/manifest.webmanifest/route.ts": /isPublicProfileSuspended\(params\.username\)/,
    "src/app/r/[username]/page.tsx": /restaurant_food"\)\) return notFound\(\);\s*if \(await isPublicProfileSuspended\(params\.username\)\) return notFound\(\);/,
    "src/app/r/[username]/item/[id]/page.tsx": /restaurant_food"\)\) return null;\s*if \(await isPublicProfileSuspended\(username\)\) return null;/,
    "src/app/m/[username]/page.tsx": /profileHasTicketing\(profile\)\) return notFound\(\);\s*if \(await isPublicProfileSuspended\(params\.username\)\) return notFound\(\);/,
    "src/app/m/[username]/[type]/[id]/page.tsx": /profileHasTicketing\(profile\)\) return notFound\(\);\s*if \(await isPublicProfileSuspended\(params\.username\)\) return notFound\(\);/,
  };
  for (const [file, re] of Object.entries(routes)) {
    const s = strip(read(file));
    check(`route gated: ${file}`, re.test(s) && /import \{ isPublicProfileSuspended \} from "@\/lib\/publicProfileVisibility"/.test(s));
  }
  check("route gated: book and m/[type]/[id] also gate the extra metadata query that could leak a title", (read("src/app/[username]/book/page.tsx").match(/isPublicProfileSuspended/g) || []).length >= 3 && (read("src/app/m/[username]/[type]/[id]/page.tsx").match(/isPublicProfileSuspended/g) || []).length >= 3);
  check("route gated: the shared metadata helper used by every profile page is gated", /isPublicProfileSuspended\(username\)/.test(strip(read("src/lib/profileMetadata.ts"))));

  // Scope: what deliberately is NOT hidden.
  check("scope: buyers' own documents (receipt, ticket pass) are not touched by this change", !/isPublicProfileSuspended/.test(read("src/app/m/[username]/receipt/[id]/page.tsx")) && !/isPublicProfileSuspended/.test(read("src/app/m/[username]/ticket-pass/[code]/page.tsx")));
  check("scope: login behaviour is unchanged (suspended accounts are still refused at login)", /userRow\?\.status === "suspended"/.test(read("src/app/api/auth/login/route.ts")));
  check("scope: no schema change and no migration for this feature", !fs.readdirSync(path.join(REPO, "supabase/migrations")).some((f) => /suspend.*profile|profile.*suspend/i.test(f)));
}

const failed = results.filter((x) => !x.pass);
console.log(`\nsuspendedProfile: ${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
