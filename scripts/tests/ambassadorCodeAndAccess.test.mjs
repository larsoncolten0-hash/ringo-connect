// Ambassador / Team Leader: editing your own code, the admin approval-access switch in
// Admin -> Ambassadors, scrollable tables, and links that open. No network, no database.
//
//   Run:  node scripts/tests/ambassadorCodeAndAccess.test.mjs
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const jiti = require("jiti")(import.meta.url, { alias: { "@": path.join(REPO, "src") }, interopDefault: true });
const load = (p) => jiti(path.join(REPO, "src", p));
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond });
  if (!cond) console.log("  FAIL:", name, "|", detail);
};
const quiet = async (fn) => {
  const o = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = o;
  }
};

// ------------------------------------------------------------------ fake service-role client
function makeFakeAdmin(seed = {}, { uniqueOnUpdate = {}, failUpdateWith = null } = {}) {
  const tables = new Map();
  for (const [name, rows] of Object.entries(seed)) tables.set(name, new Map(rows.map((r, i) => [r.id ?? `seed_${name}_${i}`, { ...r }])));
  const calls = { writes: [], rpc: [] };
  let autoId = 1;
  const from = (table) => {
    if (!tables.has(table)) tables.set(table, new Map());
    const store = tables.get(table);
    const filters = [];
    let op = "select";
    let payload;
    let max = Infinity;
    const b = {
      select: () => b,
      order: () => b,
      limit(n) {
        max = n;
        return b;
      },
      eq(k, v) {
        filters.push((r) => r[k] === v);
        return b;
      },
      in(k, vals) {
        filters.push((r) => vals.includes(r[k]));
        return b;
      },
      insert(p) {
        op = "insert";
        payload = Array.isArray(p) ? p : [p];
        return b;
      },
      update(p) {
        op = "update";
        payload = p;
        return b;
      },
      single: async () => resolve(true),
      maybeSingle: async () => resolve(true),
      then(res, rej) {
        return Promise.resolve(resolve(false)).then(res, rej);
      },
    };
    const matches = (row) => filters.every((f) => f(row));
    function resolve(single) {
      if (op !== "select") calls.writes.push({ table, op, payload });
      if (op === "insert") {
        const rows = payload.map((p) => ({ id: p.id || `auto_${autoId++}`, ...p }));
        for (const r of rows) store.set(r.id, r);
        return { data: single ? rows[0] : rows, error: null };
      }
      if (op === "update") {
        if (failUpdateWith && table === failUpdateWith.table) return { data: null, error: failUpdateWith.error };
        const rows = Array.from(store.values()).filter(matches);
        const col = uniqueOnUpdate[table];
        if (col && payload[col] !== undefined && Array.from(store.values()).some((r) => r[col] === payload[col] && !rows.includes(r))) return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
        for (const r of rows) Object.assign(r, payload);
        return { data: single ? rows[0] ?? null : rows, error: null };
      }
      const rows = Array.from(store.values()).filter(matches).slice(0, max);
      return { data: single ? rows[0] ?? null : rows, error: null };
    }
    return b;
  };
  return { _tables: tables, _calls: calls, from, rpc: async (n, a) => (calls.rpc.push({ name: n, args: a }), { data: { ok: true }, error: null }) };
}

const codeLib = load("lib/ambassadorCode.ts");
const { changeMySalesCode } = load("lib/ambassador/codeEdit.ts");
const serverMod = load("lib/supabase/server.ts");
const assertAdminMod = load("lib/assertAdmin.ts");
const { translations } = load("lib/i18n/translations.ts");

// ================================================================== the format rules
{
  const ok = ["ABCD", "ringo23", "  JOHN2024  ", "A1B2C3D4E5F6", "abcd"];
  const bad = ["ABC", "ABCDEFGHIJKLM", "AB CD", "AB-CD", "ÉCOLE1", "", "   ", "AB\nCD", "<script>"];
  check("format: 4–12 letters/numbers are valid; input is uppercased and trimmed", ok.every((c) => codeLib.isValidAmbassadorCodeFormat(codeLib.normalizeAmbassadorCode(c))) && codeLib.normalizeAmbassadorCode("  ringo23 ") === "RINGO23");
  check("format: too short, too long, spaces, symbols, accents and markup are all rejected", bad.every((c) => !codeLib.isValidAmbassadorCodeFormat(codeLib.normalizeAmbassadorCode(c))), bad.filter((c) => codeLib.isValidAmbassadorCodeFormat(codeLib.normalizeAmbassadorCode(c))).join());
  const m18 = read("supabase/migrations/2026-11-18_ambassador_foundation.sql");
  check("format: the allowed range sits inside the database's own 4–20 length check and the column is unique", codeLib.AMBASSADOR_CODE_MIN_LENGTH >= 4 && codeLib.AMBASSADOR_CODE_MAX_LENGTH <= 20 && /sales_code text not null unique check \(char_length\(sales_code\) between 4 and 20\)/.test(m18));
}

// ================================================================== changing your own code
const world = () =>
  makeFakeAdmin(
    {
      ambassador_profiles: [
        { id: "amb1", user_id: "uA1", status: "active", sales_code: "OLDCODE1" },
        { id: "amb2", user_id: "uA2", status: "active", sales_code: "TAKEN123" },
        { id: "ambP", user_id: "uP", status: "pending", sales_code: "PENDING1" },
        { id: "ambI", user_id: "uI", status: "inactive", sales_code: "INACTIV1" },
        { id: "ambS", user_id: "uS", status: "suspended", sales_code: "SUSPEND1" },
        { id: "ambL", user_id: "uL1", team_id: "T1", status: "active", sales_code: "LEADER01" }, // a Team Leader's own Ambassador profile
      ],
      ambassador_sales: [{ id: "s1", ambassador_id: "amb1", signup_request_id: "sr1" }],
      ambassador_admin_actions: [],
    },
    { uniqueOnUpdate: { ambassador_profiles: "sales_code" } }
  );
const codeOf = (a, id) => a._tables.get("ambassador_profiles").get(id).sales_code;
{
  const a = world();
  const r = await changeMySalesCode(a, "uA1", "  ringo23 ");
  check("edit: an active Ambassador changes their own code (stored uppercase)", r.ok && r.code === "RINGO23" && r.changed === true && codeOf(a, "amb1") === "RINGO23");
  const audit = Array.from(a._tables.get("ambassador_admin_actions").values());
  check("edit: it is audited with the before/after codes, under the Ambassador's own id", audit.length === 1 && audit[0].action === "ambassador_code_changed" && audit[0].actor_user_id === "uA1" && audit[0].before.sales_code === "OLDCODE1" && audit[0].after.sales_code === "RINGO23");
  check("edit: only the code changed — the profile's team/status are untouched, and no sale was rewritten (attribution is by profile id)", !a._calls.writes.some((w) => w.table === "ambassador_sales") && a._tables.get("ambassador_profiles").get("amb1").status === "active" && a._calls.writes.filter((w) => w.table === "ambassador_profiles").every((w) => JSON.stringify(Object.keys(w.payload)) === '["sales_code"]'));
  check("edit: the old code no longer identifies anyone", ![...a._tables.get("ambassador_profiles").values()].some((p) => p.sales_code === "OLDCODE1"));
  const same = await changeMySalesCode(a, "uA1", "ringo23");
  check("edit: saving the same code again changes and writes nothing", same.ok && same.changed === false && a._calls.writes.filter((w) => w.table === "ambassador_profiles").length === 1);
}
{
  const a = world();
  const taken = await changeMySalesCode(a, "uA1", "taken123");
  check("edit: a code another Ambassador holds is refused (case-insensitive) and nothing changes", taken.code === "taken" && codeOf(a, "amb1") === "OLDCODE1" && !a._calls.writes.length);
  // Two people save the same free code at the same instant: the pre-check passes for both, the unique constraint decides.
  const b = world();
  const [x, y] = await Promise.all([changeMySalesCode(b, "uA1", "RACECODE"), changeMySalesCode(b, "uA2", "RACECODE")]);
  const winners = [x, y].filter((r) => r.ok);
  check("edit: two simultaneous saves of the same free code — exactly one wins, the other is told it is taken", winners.length === 1 && [x, y].filter((r) => r.code === "taken").length === 1 && [...b._tables.get("ambassador_profiles").values()].filter((p) => p.sales_code === "RACECODE").length === 1);
}
{
  const cases = [
    ["a pending Ambassador", "uP", "not_active"],
    ["an inactive Ambassador", "uI", "not_active"],
    ["a suspended Ambassador", "uS", "not_active"],
    ["someone who is not an Ambassador", "uNobody", "not_ambassador"],
  ];
  let all = true;
  for (const [name, uid, code] of cases) {
    const a = world();
    const r = await changeMySalesCode(a, uid, "NEWCODE9");
    if (r.code !== code || a._calls.writes.length) {
      all = false;
      console.log("  not refused:", name, JSON.stringify(r));
    }
  }
  check("edit: pending, inactive and suspended Ambassadors — and non-Ambassadors — cannot change a code, and nothing is written", all);
  const a = world();
  const invalid = await Promise.all(["abc", "TOOLONGCODE123", "no spaces", "sym$bol", "", null, 123, { code: "x" }].map((c) => changeMySalesCode(a, "uA1", c)));
  check("edit: malformed, non-string and out-of-range codes are refused before any database access", invalid.every((r) => r.code === "invalid_code") && !a._calls.writes.length);
  const tl = world();
  const tlr = await changeMySalesCode(tl, "uL1", "LEAD2024");
  check("edit: a Team Leader who added their own Ambassador profile edits THEIR code the same way", tlr.ok && codeOf(tl, "ambL") === "LEAD2024");
  const tlNone = await changeMySalesCode(world(), "uNoProfileLeader", "LEAD2024");
  check("edit: a Team Leader WITHOUT an Ambassador profile has no code to edit", tlNone.code === "not_ambassador");
}
{
  // A suspension landing between the check and the write must win: the write is guarded by status = 'active'.
  const a = world();
  const realFrom = a.from;
  let flipped = false;
  a.from = (table) => {
    const b = realFrom(table);
    if (table !== "ambassador_profiles") return b;
    const realMaybe = b.maybeSingle;
    b.maybeSingle = async () => {
      const out = await realMaybe();
      if (!flipped && out.data?.sales_code === "OLDCODE1" && out.data?.status === "active" && !b._u) {
        // right after the profile is read, an admin suspends them
        flipped = true;
        a._tables.get("ambassador_profiles").get("amb1").status = "suspended";
        return { data: { ...out.data }, error: null };
      }
      return out;
    };
    return b;
  };
  const r = await changeMySalesCode(a, "uA1", "LATECODE");
  check("edit: a suspension that lands between the check and the write still wins (guarded update)", r.ok === false && r.code === "not_active" && codeOf(a, "amb1") === "OLDCODE1");
  const broken = makeFakeAdmin({ ambassador_profiles: [{ id: "amb1", user_id: "uA1", status: "active", sales_code: "OLDCODE1" }] }, { failUpdateWith: { table: "ambassador_profiles", error: { message: "connection reset" } } });
  const e = await quiet(() => changeMySalesCode(broken, "uA1", "NEWCODE9"));
  check("edit: a database error becomes a generic 'unavailable' and leaks no internals", e.code === "unavailable");
}
{
  const { POST } = load("app/api/ambassador/code/route.ts");
  const a = world();
  serverMod.createAdminClient = () => a;
  serverMod.createClient = () => ({ auth: { getUser: async () => ({ data: { user: null } }) } });
  check("route: 401 without a session", (await POST({ json: async () => ({ code: "NEWCODE9" }) })).status === 401);
  serverMod.createClient = () => ({ auth: { getUser: async () => ({ data: { user: { id: "uA1" } } }) } });
  const res = await POST({ json: async () => ({ code: "NEWCODE9", user_id: "uA2", id: "amb2", status: "active", team_id: "T9" }) });
  check("route: only the code is read from the body — it edits the SESSION user's own profile, never another's", res.status === 200 && codeOf(a, "amb1") === "NEWCODE9" && codeOf(a, "amb2") === "TAKEN123" && JSON.stringify(await res.clone().json()) === JSON.stringify({ ok: true, code: "NEWCODE9" }));
  const taken = await POST({ json: async () => ({ code: "TAKEN123" }) });
  check("route: a taken code answers 409, an invalid one 400", taken.status === 409 && (await POST({ json: async () => ({ code: "x" }) })).status === 400);
  serverMod.createClient = () => ({ auth: { getUser: async () => ({ data: { user: { id: "uP" } } }) } });
  check("route: a pending Ambassador gets 403", (await POST({ json: async () => ({ code: "NEWCODE7" }) })).status === 403);
  const m20 = read("supabase/migrations/2026-11-20_ambassador_sales_attribution.sql").replace(/--.*$/gm, "");
  check("links: attribution resolves a code by upper(trim(code)) and stores the sale against the profile ID — so a renamed code never disturbs existing sales, and the old code simply stops resolving", /where sales_code = upper\(trim\(p_ambassador_code\)\) and status = 'active'/.test(m20) && /ambassador_id/.test(m20));
}

// ================================================================== the admin approval-access switch
{
  const a = makeFakeAdmin({
    ambassador_profiles: [
      { id: "amb1", user_id: "uA1", team_id: "T1", status: "active", sales_code: "C1", created_at: "2026-01-01" },
      { id: "amb2", user_id: "uA2", team_id: "T1", status: "pending", sales_code: "C2", created_at: "2026-01-02" },
    ],
    ambassador_teams: [{ id: "T1", team_leader_user_id: "uL1", name: "Team One", status: "active" }],
    users: [
      { id: "uA1", can_approve_requests: true },
      { id: "uA2", can_approve_requests: false },
      { id: "uL1", can_approve_requests: true },
      { id: "uOther", can_approve_requests: true },
    ],
    platform_settings: [{ id: "ps", ambassador_min_payout_xaf: 500 }],
  });
  serverMod.createAdminClient = () => a;
  const { getAmbassadorAdminOverview } = load("lib/ambassador/admin.ts");
  const o = await getAmbassadorAdminOverview();
  const byId = Object.fromEntries(o.ambassadors.map((x) => [x.id, x]));
  check("admin data: each Ambassador row says whether they currently have approval access", byId.amb1.canApprove === true && byId.amb2.canApprove === false);
  check("admin data: each Team Leader (team row) says whether THEY have it", o.teams[0].canApprove === true);
  check("admin data: it is read only for the people on screen (an unrelated user's flag is never fetched)", !JSON.stringify(o).includes("uOther"));

  // The switch itself: the existing admin-only route behind Admin -> Users.
  const { PATCH } = load("app/api/admin/users/[id]/route.ts");
  const users = makeFakeAdmin({ users: [{ id: "uA1", can_approve_requests: false }], admin_audit_log: [] });
  serverMod.createAdminClient = () => users;
  assertAdminMod.assertAdmin = async () => null;
  const denied = await PATCH({ json: async () => ({ can_approve_requests: true }) }, { params: { id: "uA1" } });
  check("switch: a non-admin cannot flip it (403)", denied.status === 403 && users._tables.get("users").get("uA1").can_approve_requests === false);
  assertAdminMod.assertAdmin = async () => ({ id: "adm" });
  const granted = await PATCH({ json: async () => ({ can_approve_requests: true }) }, { params: { id: "uA1" } });
  check("switch: an admin grants it, and the change is written to the admin audit log", granted.status === 200 && users._tables.get("users").get("uA1").can_approve_requests === true && users._tables.get("admin_audit_log").size === 1);
  await PATCH({ json: async () => ({ can_approve_requests: false }) }, { params: { id: "uA1" } });
  check("switch: an admin revokes it just as easily", users._tables.get("users").get("uA1").can_approve_requests === false);
}
{
  const view = strip(read("src/components/admin/AdminAmbassadorsView.tsx"));
  check("admin screen: the switch is a column in BOTH the Ambassadors and the Teams (Team Leaders) tables", (view.match(/<ApprovalAccessCell/g) || []).length === 2 && (view.match(/t\.adminAmbassadorAccess\.column/g) || []).length === 2);
  check("admin screen: it is disabled until the Ambassador / team is active (but an existing grant can always be revoked)", /disabled=\{busy \|\| \(disabled && !enabled\)\}/.test(view) && /disabled=\{a\.status !== "active"\}/.test(view) && /disabled=\{t\.status !== "active"\}/.test(view));
  check("admin screen: it sends only can_approve_requests to the existing admin-only users route, and reflects the result for that person everywhere", /body: JSON\.stringify\(\{ can_approve_requests: !current \}\)/.test(view) && /fetch\(`\/api\/admin\/users\/\$\{userId\}`/.test(view) && /a\.userId === userId/.test(view) && /tm\.teamLeaderUserId === userId/.test(view));
}

// ================================================================== tables scroll sideways
{
  const files = ["src/components/admin/AdminAmbassadorsView.tsx", "src/components/dashboard/AmbassadorDashboardView.tsx", "src/components/dashboard/TeamLeaderDashboardView.tsx", "src/components/dashboard/AmbassadorPayoutPanel.tsx"];
  let tables = 0;
  const offenders = [];
  for (const f of files) {
    const lines = read(f).split(/\r?\n/);
    lines.forEach((l, i) => {
      if (!/<table\b/.test(l)) return;
      tables++;
      const wrapper = lines.slice(Math.max(0, i - 7), i).join("\n");
      if (!/overflow-x-auto/.test(wrapper) || /overflow-hidden/.test(lines[i - 1] || "") || !/min-w-max/.test(l)) offenders.push(`${f}:${i + 1}`);
    });
  }
  check("scrolling: every table on the Ambassador, Team Leader, payout and admin screens sits in a horizontally scrollable wrapper and keeps its natural width", tables === 10 && offenders.length === 0, `tables=${tables} offenders=${offenders.join(",")}`);
  check("scrolling: no table is left clipped by an overflow-hidden wrapper", !files.some((f) => /overflow-hidden">\s*\r?\n\s*<table/.test(read(f))));
  check("scrolling: the admin tab bar already scrolls sideways", /overflow-x-auto border-b/.test(read("src/components/admin/AdminAmbassadorsView.tsx")));
}

// ================================================================== links open, and the code they carry is the live one
{
  const amb = read("src/components/dashboard/AmbassadorDashboardView.tsx");
  const tl = read("src/components/dashboard/TeamLeaderSelfSellCard.tsx");
  for (const [name, src] of [["Ambassador dashboard", amb], ["Team Leader card", tl]]) {
    check(`links: the ${name} link is a real anchor that opens in a new tab, so it can be clicked to test`, /<a\s+href=\{link\}\s+target="_blank"\s+rel="noopener noreferrer"/.test(src));
    check(`links: the ${name} link is built from the current code (/get-started-cards?amb=CODE) and shows the editor`, /\/get-started-cards\?amb=\$\{/.test(src) && /<AmbassadorCodeEditor/.test(src));
  }
  check("links: the editor rebuilds the link after a save (router.refresh) and warns that the old code stops working", /router\.refresh\(\)/.test(read("src/components/dashboard/AmbassadorCodeEditor.tsx")) && /c\.changeWarning/.test(read("src/components/dashboard/AmbassadorCodeEditor.tsx")));

  // What a click actually does in the browser: capture ?amb= once, keep it, hand it to the signup form.
  const store = new Map();
  globalThis.window = { location: { search: "?amb=ringo23" }, localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) } };
  const ref = load("lib/ambassadorReferral.ts");
  ref.captureAmbassadorCodeFromUrl();
  check("click: opening the link stores the code from ?amb= for the signup form to send", ref.getAmbassadorCode() === "ringo23");
  globalThis.window.location.search = "?amb=SOMEONE";
  ref.captureAmbassadorCodeFromUrl();
  check("click: first touch wins — a later link never replaces the stored code", ref.getAmbassadorCode() === "ringo23");
  globalThis.window.location.search = "?amb=" + "X".repeat(200);
  ref.clearAmbassadorCode();
  ref.captureAmbassadorCodeFromUrl();
  check("click: an absurdly long value is capped, never stored whole", ref.getAmbassadorCode().length <= 40);
  delete globalThis.window;
  const layout = read("src/app/layout.tsx");
  const flow = read("src/components/onboarding/GetStartedFlow.tsx");
  check("click: the capture runs on every page from the root layout, and the signup form submits it as ambassador_code", /<AmbassadorCodeCapture \/>/.test(layout) && /ambassador_code: ambassadorCode\.trim\(\) \|\| null/.test(flow) && /getAmbassadorCode\(\)/.test(flow));
  check("click: the target page exists and is public (no login redirect for it in the middleware)", fs.existsSync(path.join(REPO, "src/app/get-started-cards/page.tsx")) && !/get-started/.test(read("src/middleware.ts")));
}

// ================================================================== i18n
{
  const shape = (o) => (typeof o === "function" ? "fn" : o && typeof o === "object" ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, shape(v)])) : "str");
  check("i18n: ambassadorCode and adminAmbassadorAccess have identical keys in English and French", JSON.stringify(shape(translations.en.ambassadorCode)) === JSON.stringify(shape(translations.fr.ambassadorCode)) && JSON.stringify(shape(translations.en.adminAmbassadorAccess)) === JSON.stringify(shape(translations.fr.adminAmbassadorAccess)));
  const codes = [...read("src/lib/ambassador/codeEdit.ts").split("export type CodeEditErrorCode =")[1].split(";")[0].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  check("i18n: every code-edit error has English AND French text", codes.length === 5 && codes.every((c) => translations.en.ambassadorCode.errors[c] && translations.fr.ambassadorCode.errors[c]), codes.join());
  check("i18n: the French copy is genuinely translated", translations.fr.ambassadorCode.changeWarning !== translations.en.ambassadorCode.changeWarning && translations.fr.adminAmbassadorAccess.grant !== translations.en.adminAmbassadorAccess.grant && translations.fr.ambassadorCode.errors.taken !== translations.en.ambassadorCode.errors.taken);
}

const failed = results.filter((x) => !x.pass);
console.log(`\nambassadorCodeAndAccess: ${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
