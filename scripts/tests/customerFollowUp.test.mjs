// Customer Follow-Up (admin), the dashboard referral banner and their guards. Fixtures only: no network,
// no database, no real customers.   Run:  node scripts/tests/customerFollowUp.test.mjs
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const nodeRequire = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond });
  if (!cond) console.log("  FAIL:", name, "|", detail);
};

// ------------------------------------------------------------------ a tiny TS/TSX loader (TypeScript's own compiler)
const ts = nodeRequire("typescript");
const cache = new Map();
function resolveLocal(spec, fromDir) {
  const base = spec.startsWith("@/") ? path.join(REPO, "src", spec.slice(2)) : spec.startsWith(".") ? path.resolve(fromDir, spec) : null;
  if (!base) return null;
  for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const f = base + ext;
    if (fs.existsSync(f) && fs.statSync(f).isFile()) return f;
  }
  return null;
}
function loadTs(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const out = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  cache.set(file, mod);
  const req = (spec) => {
    const local = resolveLocal(spec, path.dirname(file));
    return local ? loadTs(local) : nodeRequire(spec);
  };
  new Function("exports", "require", "module", "__filename", out)(mod.exports, req, mod, file);
  return mod.exports;
}
const src = (p) => loadTs(path.join(REPO, "src", p));

const React = nodeRequire("react");
const { renderToStaticMarkup } = nodeRequire("react-dom/server");
const { LanguageProvider } = src("components/LanguageProvider.tsx");
const F = src("lib/customerFollowUp.ts");
const P = src("lib/referralPromo.ts");
const { translations } = src("lib/i18n/translations.ts");
const render = (locale, node) => renderToStaticMarkup(React.createElement(LanguageProvider, { initialLocale: locale }, node));

const NOW = new Date("2026-09-30T12:00:00Z");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const base = () => ({ requests: [], users: [], profiles: [], phones: [], plans: [{ id: "p-free", name: "free" }, { id: "p-pro", name: "pro" }], sales: [], ambassadorProfiles: [], teams: [], pushSubs: [], followUps: [], staff: [{ id: id(900), email: "staff@example.test" }], testUserIds: new Set(), now: NOW });
const req = (n, o = {}) => ({ id: id(n), full_name: `Customer ${n}`, whatsapp_number: "677000000", email: `c${n}@example.test`, status: "pending", customer_paid: false, pending_fapshi_trans_id: null, created_user_id: null, referral_code: null, source: "get_started", ambassador_code: null, requested_plan_id: "p-pro", created_at: "2026-09-29T10:00:00Z", ...o });
const usr = (n, o = {}) => ({ id: id(n), email: `u${n}@example.test`, role: "creator", plan_id: "p-pro", status: "active", created_at: "2026-09-01T10:00:00Z", plan_expires_at: "2027-01-01T00:00:00Z", referred_by: null, affiliate_code: `AFF${n}`, last_active_at: null, last_active_standalone: null, pwa_installed_at: null, ...o });
const one = (input) => F.buildFollowUpRows(input)[0];

// ============================================================ PWA status: positive signals only
{
  const c = (o) => F.classifyPwa({ hasAccount: true, pwaInstalledAt: null, lastActiveStandalone: null, pushUserAgents: [], ...o });
  check("pwa: the appinstalled event confirms an install", c({ pwaInstalledAt: "2026-09-01T00:00:00Z" }).status === "installed" && c({ pwaInstalledAt: "2026-09-01T00:00:00Z" }).reason === "confirmed_install_event");
  check("pwa: opening Ringo in standalone display-mode confirms an install (covers iPhones, which never fire appinstalled)", c({ lastActiveStandalone: true }).status === "installed");
  check("pwa: NO event and NO signal is 'unknown' — never 'not installed'", c({}).status === "unknown" && c({ lastActiveStandalone: false }).status === "unknown");
  check("pwa: a browser visit (standalone=false) does not prove the app is absent", c({ lastActiveStandalone: false }).status !== "not_installed");
  check("pwa: an iPhone/iPad user with no confirmation is 'not detectable' (iOS cannot report installs)", c({ pushUserAgents: ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"] }).status === "not_detectable");
  check("pwa: a confirmed install wins even on iOS", c({ lastActiveStandalone: true, pushUserAgents: ["Mozilla/5.0 (iPhone)"] }).status === "installed");
  check("pwa: 'not installed' is produced only from an explicit current signal, never from absence", c({ currentNotInstalledSignal: true }).status === "not_installed" && c({}).status !== "not_installed");
  check("pwa: a push subscription alone does not make a customer 'installed' (Android/desktop UA)", c({ pushUserAgents: ["Mozilla/5.0 (Linux; Android 14)"] }).status === "unknown");
  check("pwa: no account means nothing to detect (unknown, reason no_account)", F.classifyPwa({ hasAccount: false, pwaInstalledAt: null, lastActiveStandalone: null, pushUserAgents: [] }).reason === "no_account");
  const r = one({ ...base(), users: [usr(1, { last_active_at: "2026-09-20T00:00:00Z" })], pushSubs: [{ user_id: id(1), user_agent: "Chrome Android" }] });
  check("pwa: push subscription and install are reported separately on the row", r.pushSubscribed === true && r.pwa === "unknown");
}

// ============================================================ lifecycle facts stay separate
{
  const awaiting = one({ ...base(), requests: [req(1)] });
  check("lifecycle: an unpaid pending request is awaiting payment, no account, awaiting approval", awaiting.paymentStatus === "awaiting_payment" && awaiting.accountStatus === "awaiting_approval" && !awaiting.hasAccount && F.isAwaitingPayment(awaiting));
  const started = one({ ...base(), requests: [req(1, { pending_fapshi_trans_id: "T1" })] });
  check("lifecycle: a started payment is 'payment started', still awaiting payment (not paid)", started.paymentStatus === "payment_started" && F.isAwaitingPayment(started));
  const paid = one({ ...base(), requests: [req(1, { customer_paid: true })] });
  check("lifecycle: paid but not approved is 'paid, not activated' — payment is not approval", paid.paymentStatus === "paid" && paid.accountStatus === "awaiting_approval" && F.isPaidNotActivated(paid) && !F.isAwaitingPayment(paid));
  const approvedInput = { ...base(), requests: [req(1, { status: "approved", customer_paid: true, created_user_id: id(50) })], users: [usr(50)] };
  const active = one(approvedInput);
  check("lifecycle: an approved request merges with its account into ONE row (active, paid, subscription active)", F.buildFollowUpRows(approvedInput).length === 1 && active.accountStatus === "active" && active.subscriptionStatus === "active" && active.hasAccount && active.paymentStatus === "paid");
  const cash = one({ ...base(), requests: [req(1, { status: "approved", customer_paid: false, created_user_id: id(50) })], users: [usr(50)] });
  check("lifecycle: an account can be active while NO online registration payment is recorded — the two are independent, and it is not mislabelled awaiting/started", cash.accountStatus === "active" && cash.paymentStatus === "not_recorded" && one({ ...base(), requests: [req(1, { status: "approved", pending_fapshi_trans_id: "T9", created_user_id: id(50) })], users: [usr(50)] }).paymentStatus === "not_recorded");
  const free = one({ ...base(), requests: [req(1, { requested_plan_id: "p-free" })] });
  check("lifecycle: a free-plan request needs no payment", free.paymentStatus === "not_required" && !F.isAwaitingPayment(free));
  const expired = one({ ...base(), users: [usr(1, { plan_expires_at: "2026-08-01T00:00:00Z" })] });
  const freeSub = one({ ...base(), users: [usr(1, { plan_id: "p-free", plan_expires_at: null })] });
  check("subscription: past expiry is expired; a free plan is free; a paid plan without expiry is active", expired.subscriptionStatus === "expired" && freeSub.subscriptionStatus === "free" && one({ ...base(), users: [usr(1, { plan_expires_at: null })] }).subscriptionStatus === "active");
  const suspended = one({ ...base(), users: [usr(1, { status: "suspended" })] });
  check("account: a suspended account is reported as suspended, and rejected requests as rejected", suspended.accountStatus === "suspended" && one({ ...base(), requests: [req(1, { status: "rejected" })] }).accountStatus === "rejected");
  const userOnly = one({ ...base(), users: [usr(1)] });
  check("no signup record: payment and source are 'unknown' (not guessed as paid or direct)", userOnly.paymentStatus === "unknown" && userOnly.registrationSource === "unknown" && userOnly.subjectType === "user");
  const withProfile = { ...base(), users: [usr(1)], profiles: [{ id: "pr1", user_id: id(1), name: "Ada", username: "ada" }], phones: [{ profile_id: "pr1", phone_number: "699111222", sort_order: 0 }] };
  check("contact: name/email/phone come from the request, else the profile and its first phone", one(withProfile).phone === "699111222" && one(withProfile).name === "Ada" && one(withProfile).email === "u1@example.test");
  check("last seen comes from last_active_at", one({ ...base(), users: [usr(1, { last_active_at: "2026-09-25T00:00:00Z" })] }).lastSeenAt === "2026-09-25T00:00:00Z");
  const rows = F.buildFollowUpRows({ ...base(), requests: [req(1, { created_user_id: id(60), status: "approved" }), req(2)], users: [usr(60, { role: "creator" }), usr(61, { role: "admin" }), usr(62)], testUserIds: new Set([id(62)]) });
  check("scope: admins and demo/test accounts are never listed as customers", rows.length === 2 && !rows.some((r) => r.subjectId === id(61) || r.subjectId === id(62)));
}

// ============================================================ attribution: authoritative rows only, never guessed
{
  const amb = { id: "amb1", user_id: id(70), team_id: "team1", sales_code: "AMB-ONE" };
  const withTeam = { ...base(), ambassadorProfiles: [amb], teams: [{ id: "team1", team_leader_user_id: id(71), name: "Douala Team" }], profiles: [{ id: "pa", user_id: id(70), name: "Amina Ambassador", username: "amina" }, { id: "pl", user_id: id(71), name: "Tobi Leader", username: "tobi" }], users: [usr(70), usr(71)] };
  const find = (input, n) => F.buildFollowUpRows(input).find((r) => r.subjectId === id(n));
  const bySale = find({ ...withTeam, requests: [req(1)], sales: [{ signup_request_id: id(1), ambassador_id: "amb1", team_id: "team1", customer_user_id: null }] }, 1);
  check("attribution: a recorded ambassador sale names the Ambassador, Team Leader and team", bySale.attribution.kind === "ambassador" && bySale.attribution.via === "sale" && bySale.attribution.ambassadorName === "Amina Ambassador" && bySale.attribution.teamLeaderName === "Tobi Leader" && bySale.attribution.teamName === "Douala Team");
  const byCode = find({ ...withTeam, requests: [req(1, { ambassador_code: "amb-one" })] }, 1);
  check("attribution: the Ambassador code on a not-yet-approved request attributes it (case-insensitive), marked as 'code'", byCode.attribution.kind === "ambassador" && byCode.attribution.via === "code" && byCode.attribution.teamLeaderName === "Tobi Leader");
  const snapshot = find({ ...withTeam, ambassadorProfiles: [{ ...amb, team_id: "team2" }], teams: [...withTeam.teams, { id: "team2", team_leader_user_id: id(72), name: "Other" }], requests: [req(1)], sales: [{ signup_request_id: id(1), ambassador_id: "amb1", team_id: "team1", customer_user_id: null }] }, 1);
  check("attribution: the team on the sale row (snapshot) wins over the Ambassador's current team", snapshot.attribution.teamName === "Douala Team");
  const aff = find({ ...base(), users: [usr(80, { affiliate_code: "AFFCODE" })], requests: [req(1, { referral_code: "affcode" })] }, 1);
  check("attribution: an affiliate referral code attributes the customer to that affiliate (not an Ambassador)", aff.attribution.kind === "affiliate");
  const refBy = find({ ...base(), users: [usr(80), usr(81, { referred_by: id(80) })] }, 81);
  check("attribution: users.referred_by attributes an account with no request", refBy.attribution.kind === "affiliate");
  const un = one({ ...base(), requests: [req(1)] });
  check("attribution: no code, no sale, no referrer = unassigned (never guessed)", un.attribution.kind === "unassigned" && F.isUnassigned(un));
  const unknownCode = one({ ...base(), requests: [req(1, { ambassador_code: "NOPE", referral_code: "NOPE" })] });
  check("attribution: a code that matches nobody stays unassigned", unknownCode.attribution.kind === "unassigned");
  check("attribution: an account with no signup record shows an UNKNOWN source; a form signup shows its real source (the two are not conflated)", one({ ...base(), users: [usr(1)] }).registrationSource === "unknown" && un.registrationSource === "get_started" && one({ ...base(), requests: [req(1, { source: "affiliate" })] }).registrationSource === "affiliate");
}

// ============================================================ filters and summary
{
  const input = { ...base(), requests: [req(1, { created_at: "2026-09-29T10:00:00Z" }), req(2, { customer_paid: true, created_at: "2026-08-01T10:00:00Z" }), req(3, { status: "approved", customer_paid: true, created_user_id: id(53), created_at: "2026-07-01T10:00:00Z", full_name: "Zed Person", whatsapp_number: "655 44 33 22" })], users: [usr(53, { pwa_installed_at: "2026-07-02T00:00:00Z" }), usr(54, { plan_expires_at: "2026-01-01T00:00:00Z", created_at: "2026-06-01T00:00:00Z" })], followUps: [{ subject_type: "request", subject_id: id(1), status: "needs_follow_up", follow_up_date: "2026-10-02", assigned_to: id(900), note: "Call back", updated_at: null }] };
  const rows = F.buildFollowUpRows(input);
  const f = (o) => F.applyFilters(rows, { ...F.DEFAULT_FILTERS, ...o }, NOW).map((r) => r.subjectId);
  check("filter: recent = registered in the last 7 days", JSON.stringify(f({ stage: "recent" })) === JSON.stringify([id(1)]));
  check("filter: awaiting payment", JSON.stringify(f({ stage: "awaiting_payment" })) === JSON.stringify([id(1)]));
  check("filter: paid but not activated", JSON.stringify(f({ stage: "paid_not_activated" })) === JSON.stringify([id(2)]));
  check("filter: awaiting approval covers unpaid and paid pending requests", f({ stage: "awaiting_approval" }).length === 2);
  check("filter: active vs expired subscription", f({ stage: "subscription_active" }).includes(id(3)) && JSON.stringify(f({ stage: "subscription_expired" })) === JSON.stringify([id(54)]));
  check("filter: PWA installed / none confirmed / unknown", JSON.stringify(f({ pwa: "installed" })) === JSON.stringify([id(3)]) && !f({ pwa: "none_confirmed" }).includes(id(3)) && f({ pwa: "unknown" }).includes(id(54)));
  check("filter: unassigned and needs-follow-up", f({ stage: "unassigned" }).length === 4 && JSON.stringify(f({ stage: "needs_follow_up" })) === JSON.stringify([id(1)]));
  check("filter: date range is inclusive", JSON.stringify(f({ from: "2026-07-01", to: "2026-07-31" })) === JSON.stringify([id(3)]));
  check("filter: search matches name, email and phone (digits, ignoring spaces)", JSON.stringify(f({ q: "zed" })) === JSON.stringify([id(3)]) && f({ q: "c1@example" }).includes(id(1)) && JSON.stringify(f({ q: "65544" })) === JSON.stringify([id(3)]));
  const s = F.summarize(rows);
  check("summary: counts each fact separately", s.total === 4 && s.awaitingPayment === 1 && s.paidNotActivated === 1 && s.awaitingApproval === 2 && s.activeAccounts === 2 && s.pwaInstalled === 1 && s.needsFollowUp === 1 && s.unassigned === 4 && s.expiredSubscriptions === 1, JSON.stringify(s));
  check("summary: 'no confirmed install' counts accounts only (a customer without an account cannot have installed)", s.pwaNoneConfirmed === 1 && s.pwaUnknown === 1, JSON.stringify(s));
  const fu = rows.find((r) => r.subjectId === id(1));
  check("follow-up: a saved record shows status, date, assignee and note on the row, and does not change attribution", fu.followUp.assigneeLabel === "staff@example.test" && fu.followUp.note === "Call back" && fu.attribution.kind === "unassigned");
}

// ============================================================ follow-up update validation
{
  const ok = { subjectType: "request", subjectId: id(1), status: "needs_follow_up", followUpDate: "2026-10-02", assignedTo: id(900), note: "  Call  " };
  const p = F.parseFollowUpUpdate(ok);
  check("validation: a well-formed update is accepted and the note is trimmed", p.ok && p.value.note === "Call" && p.value.assignedTo === id(900));
  check("validation: bad subject type / id / status / date / assignee / note are all rejected", ["subjectType", "subjectId", "status", "followUpDate", "assignedTo", "note"].every((k) => !F.parseFollowUpUpdate({ ...ok, [k]: k === "note" ? 5 : "bad" }).ok) && !F.parseFollowUpUpdate(null).ok);
  check("validation: date, assignee and note are optional; an over-long note is capped", F.parseFollowUpUpdate({ subjectType: "user", subjectId: id(2), status: "completed" }).ok && F.parseFollowUpUpdate({ ...ok, note: "x".repeat(900) }).value.note.length === 500);
  check("validation: only the two follow-up statuses exist (nothing can be written into an account's own status)", !F.parseFollowUpUpdate({ ...ok, status: "approved" }).ok && !F.parseFollowUpUpdate({ ...ok, status: "active" }).ok);
}

// ============================================================ server-side authorization, no public exposure, additive DB
{
  const route = strip(read("src/app/api/admin/follow-up/route.ts"));
  check("auth: the write route calls assertAdmin() and returns 403 BEFORE reading the body or touching the database", route.indexOf("assertAdmin()") > -1 && route.indexOf("assertAdmin()") < route.indexOf("request.json") && route.indexOf("assertAdmin()") < route.indexOf("createAdminClient()") && /status: 403/.test(route));
  check("auth: the route only upserts customer_followups and never updates/inserts/deletes signup_requests or users", (route.match(/\.from\([^)]*\)/g) || []).length >= 2 && !/\.(update|insert|delete)\(/.test(route) && /\.upsert\(/.test(route) && /from\("customer_followups"\)/.test(route));
  check("auth: the assignee must be an admin account", /role !== "admin"/.test(route));
  const page = read("src/app/admin/follow-up/page.tsx");
  const layout = read("src/app/admin/layout.tsx");
  check("auth: the page lives under the admin layout, which redirects non-admins on the server", /userRow\?\.role !== "admin"\) redirect/.test(layout) && !/use client/.test(page));
  const loader = strip(read("src/lib/customerFollowUpData.ts"));
  check("privacy: the loader never selects push endpoints/keys, tokens or payout details, and never writes", !/endpoint|p256dh|payout|token|secret/i.test(loader) && !/\.(insert|update|delete|upsert)\(/.test(loader));
  check("privacy: there is no public route for follow-up data and no bulk-messaging code path", !fs.existsSync(path.join(REPO, "src/app/api/follow-up")) && !/sendEmail|sendPush|notifyUser|broadcast/i.test(loader + strip(read("src/components/admin/CustomerFollowUp.tsx"))));
  const mig = read("supabase/migrations/2026-11-30_customer_followups.sql");
  const migCode = mig.replace(/--.*$/gm, "");
  check("migration: creates ONE new table and enables RLS with no policies", (migCode.match(/create table/gi) || []).length === 1 && /customer_followups/.test(migCode) && /enable row level security/i.test(migCode) && !/create policy/i.test(migCode));
  check("migration: purely additive — no alter/drop/update/delete/insert on any existing object", !/alter table (?!public\.customer_followups)/i.test(migCode) && !/\bdrop\b|\bdelete\b|\bupdate\b|\binsert\b|\btruncate\b/i.test(migCode.replace(/on delete set null/gi, "")));
  check("migration: the original attribution columns are not referenced at all", !/ambassador_code|referral_code|ambassador_sales|\bsource\b/.test(migCode));
  check("workflow: the page tolerates the table not existing yet (read-only mode, controls hidden)", /workflowAvailable: !followUps\.error/.test(loader) && /followUps\.error \? \[\]/.test(loader) && /workflowAvailable && \(/.test(read("src/components/admin/CustomerFollowUp.tsx")));
  const shell = read("src/components/admin/AdminShell.tsx");
  check("nav: 'Account Follow-Up' (/admin/follow-up) and 'My Ringo Customers' (/admin/customers) are both translated sidebar labels, in English and French, and clearly distinct", /href: "\/admin\/follow-up"/.test(shell) && /t\.adminFollowUp\.navLabel/.test(shell) && /t\.adminFollowUp\.customersNavLabel/.test(shell) && translations.en.adminFollowUp.navLabel === "Account Follow-Up" && translations.en.adminFollowUp.customersNavLabel === "My Ringo Customers" && translations.fr.adminFollowUp.navLabel === "Suivi des comptes" && translations.fr.adminFollowUp.customersNavLabel === "Clients My Ringo" && !/label: "Customers"/.test(shell) && /href: "\/admin\/customers"/.test(shell));
}

// ============================================================ rendered page (fixtures only)
{
  const rows = F.buildFollowUpRows({ ...base(), requests: [req(1, { full_name: "Ada Lovelace" })], users: [usr(5, { last_active_at: "2026-09-20T00:00:00Z" })] });
  const CF = src("components/admin/CustomerFollowUp.tsx").default;
  const en = render("en", React.createElement(CF, { rows, staff: [], workflowAvailable: false }));
  const fr = render("fr", React.createElement(CF, { rows, staff: [], workflowAvailable: false }));
  check("page (EN): title, unassigned label, unknown app status, customer and the read-only notice all render", /Account Follow-Up/.test(en) && /Unassigned — Follow-up needed/.test(en) && />Unknown</.test(en) && /Ada Lovelace/.test(en) && /not switched on yet/.test(en) && /Awaiting payment/.test(en));
  check("page (FR): the same page renders in French", /Suivi des comptes/.test(fr) && /Non attribué — Suivi nécessaire/.test(fr) && /Inconnu/.test(fr) && /pas encore activés/.test(fr));
  check("page: an account with no install signal is never labelled 'Not installed'", !/>Not installed</.test(en) && !/>Non installée</.test(fr));
  check("page: the table scrolls horizontally on small screens", /overflow-x-auto/.test(en));
  const parity = (a, b) => (typeof a === "string" ? typeof b === "string" : Object.keys(a).every((k) => k in b && parity(a[k], b[k])) && Object.keys(b).every((k) => k in a));
  check("i18n: adminFollowUp and referralPromo exist with identical keys in English and French", parity(translations.en.adminFollowUp, translations.fr.adminFollowUp) && parity(translations.en.referralPromo, translations.fr.referralPromo));
}

// ============================================================ referral banner
{
  const on = { isActingAsStaff: false, affiliateEnabled: true, affiliateSuspended: false, commissionRate: 0.1 };
  check("banner: it quotes the LIVE rate (0.10 → '10'), formatted without trailing zeros", P.getReferralPromo(on).ratePct === "10" && P.getReferralPromo({ ...on, commissionRate: 0.125 }).ratePct === "12.5" && P.formatRatePct(0.2) === "20");
  check("banner: hidden when the affiliate program is off, the account is suspended from it, the rate is zero/invalid, or the person is acting as staff", P.getReferralPromo({ ...on, affiliateEnabled: false }) === null && P.getReferralPromo({ ...on, affiliateSuspended: true }) === null && P.getReferralPromo({ ...on, commissionRate: 0 }) === null && P.getReferralPromo({ ...on, commissionRate: NaN }) === null && P.getReferralPromo({ ...on, isActingAsStaff: true }) === null);
  check("banner: shows only on the dashboard home — never billing, checkout or payment pages", P.referralPromoShowsOn("/dashboard") && !["/dashboard/subscription", "/dashboard/shop", "/dashboard/affiliate", "/dashboard/requests", "/get-started", "/dashboard/ambassador"].some(P.referralPromoShowsOn));
  const comp = strip(read("src/components/dashboard/ReferralPromoBanner.tsx"));
  check("banner: links to the EXISTING Affiliate dashboard, is dismissible per account, and adds no modal, animation or dependency", /href="\/dashboard\/affiliate"/.test(comp) && /localStorage\.setItem\(key/.test(comp) && !/framer-motion|Modal|animate-/.test(comp));
  const html = render("en", React.createElement(src("components/dashboard/ReferralPromoBanner.tsx").default, { userId: "u1", ratePct: "10" }));
  check("banner: server-renders hidden (no flash for someone who already dismissed it)", html === "");
  check("banner copy: EN and FR match the requested wording", translations.en.referralPromo.title === "Refer a friend. Earn {rate}%." && translations.en.referralPromo.body === "Share Ringo Connect with your network and earn eligible referral rewards." && translations.en.referralPromo.cta === "Explore Affiliate Program" && /Parrainez/.test(translations.fr.referralPromo.title) && /\{rate\}/.test(translations.fr.referralPromo.title));
  const layout = strip(read("src/app/dashboard/layout.tsx"));
  check("banner: the layout reads the live settings and passes only a rate string (no new commission rules, no writes)", /getAffiliateSettings\(\)/.test(layout) && /getReferralPromo\(/.test(layout) && /affiliateCommissionRate/.test(layout));
  const lib = strip(read("src/lib/referralPromo.ts"));
  check("banner: the library hard-codes no commission number", !/\b0\.1\b|\b10%|"10"/.test(lib));
  const checkoutFiles = ["src/components/checkout/ProductCheckout.tsx", "src/components/checkout/ProtectionCheckout.tsx", "src/components/GetStartedFlow.tsx", "src/app/dashboard/subscription/page.tsx"].filter((f) => fs.existsSync(path.join(REPO, f)));
  check("banner: no checkout, payment or get-started screen references it", checkoutFiles.length > 0 && checkoutFiles.every((f) => !/ReferralPromoBanner|referralPromo/.test(read(f))));
  check("banner: the Ambassador dashboards are untouched by it", !/referralPromo/.test(read("src/components/dashboard/AmbassadorDashboardView.tsx") + read("src/components/dashboard/TeamLeaderDashboardView.tsx")));
}

const failed = results.filter((x) => !x.pass);
console.log(`\ncustomerFollowUp: ${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
