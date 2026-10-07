// Business Toolkit Phase 3 (debtors, credit sales, reminders): the application layer. The REAL validation, error mapping, message builders, API
// handlers, cron run and route files run here against in-memory fakes; only the session resolver, the email sender, notifications and push are
// stubbed. No network, no database, nothing applied. The SQL itself is covered by supabase/support/tests/receivables_foundation.test.mjs (PGlite).
//   Run:  node scripts/tests/receivables.test.mjs
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { execFileSync } from "child_process";
import { createRequire } from "module";
import { isPhase8AuthFile } from "./phase8Files.mjs"; // Phase 8: the exact auth / env files of "Continue with Google / Apple" (see phase8Files.mjs)
import { isPhase21Migration } from "./phase21Files.mjs"; // Phase 6 security: the one un-applied payout-concurrency migration (exact path)
import { isPhase18Migration } from "./phase18Files.mjs"; // Phase 3 security: the one un-applied private-file-path migration (exact path)
import { isPhase17Migration } from "./phase17Files.mjs"; // Phase 2 security: the one un-applied team-ceiling migration (exact path)
import { isPhase16ProtectedFile, isPhase16Migration } from "./phase16Files.mjs"; // security remediation: the exact files (billing webhook / upgrade stub, package files, next-env.d.ts) it changes on purpose
import { fileURLToPath } from "url";
// Record Sale (standalone receipts, branding, payment details, print, footer, navigation): the files that release changes on purpose. See recordSaleUnit.test.mjs / recordSaleSql.test.mjs.
const RECORD_SALE_FILES = /^(src\/(lib\/(sales\/|documents\/pdf\/(logo|render|templates\/v[12])|documents\/(handlers|http|snapshot|types|validation|brand|actions|publicShare)\.ts$|bookkeeping\/(saleReceiptGuard|recordEntry)\.ts$|corrections\/entries\.ts$)|components\/(sales\/|documents\/(BusinessProfileForm|DocumentActions|DocumentView|PublicDocumentView|PrintButton|shared)\.tsx$|overview\/OverviewView\.tsx$|reports\/ReportsTabs\.tsx$|dashboard\/DashboardShell\.tsx$)|app\/(api\/sales\/|d\/\[token\]\/(page\.tsx$|logo\/)|dashboard\/(sales|bookkeeping)\/|dashboard\/layout\.tsx$|dashboard\/reports\/entries\/page\.tsx$|api\/bookkeeping\/entries\/\[id\]\/void\/route\.ts$))|supabase\/(migrations|support)\/2026-12-06_record_sale_receipts_branding)/;

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8").replace(/\r\n/g, "\n");
const strip = (s) => s.replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, "");

const tmp = [];
const mk = (name, body) => { const f = path.join(os.tmpdir(), `recv_${name}_${process.pid}.cjs`); fs.writeFileSync(f, body); tmp.push(f); return f; };
const accessStub = mk("access", "module.exports = { resolveBookkeepingOwner: async () => globalThis.__owner };");
const serverStub = mk("server", "module.exports = { createAdminClient: () => globalThis.__admin };");
const emailStub = mk("email", "module.exports = { sendEmail: async (i) => { globalThis.__sent.push(i); return { ok: true }; } };");
const notifStub = mk("notif", "module.exports = { notifyUser: async (u, i) => { globalThis.__notified.push([u, i]); } };");
const pushStub = mk("push", "module.exports = { sendPushToUser: async (a, u, p) => { globalThis.__pushed.push([u, p]); } };");
const jiti = require("jiti")(import.meta.url, { alias: { "@/lib/bookkeeping/access": accessStub, "@/lib/supabase/server": serverStub, "@/lib/email/provider": emailStub, "@/lib/notifications": notifStub, "@/lib/push/send": pushStub, "@": SRC }, interopDefault: true, cache: false });
const V = jiti(path.join(SRC, "lib/receivables/validation.ts"));
const E = jiti(path.join(SRC, "lib/receivables/http.ts"));
const UE = jiti(path.join(SRC, "lib/receivables/uiErrors.ts"));
const M = jiti(path.join(SRC, "lib/receivables/reminderMessages.ts"));
const H = jiti(path.join(SRC, "lib/receivables/handlers.ts"));
const C = jiti(path.join(SRC, "lib/receivables/cron.ts"));
const K = jiti(path.join(SRC, "lib/receivables/constants.ts"));
const { translations } = jiti(path.join(SRC, "lib/i18n/translations.ts"));
const route = (p) => jiti(path.join(SRC, "app/api", p, "route.ts"));

console.error = () => {};
let pass = 0, fail = 0;
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", name, "|", String(detail).slice(0, 300)); } };
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

const ID = (n) => `44444444-4444-4444-8444-${String(n).padStart(12, "0")}`;
const RID = (n) => `55555555-5555-4555-8555-${String(n).padStart(12, "0")}`;
const OWNER = { userId: "11111111-1111-4111-8111-111111111111", profileId: "22222222-2222-4222-8222-222222222222" };

// ------------------------------------------------------------------------ fakes
const makeAdmin = (responses = {}) => { const calls = []; return { calls, rpc: async (name, args) => { calls.push([name, args]); const r = responses[name]; return typeof r === "function" ? r(args) : r ?? { data: null, error: null }; } }; };
const makeDb = (tables = {}) => ({ from(table) {
  const q = { f: [] };
  const rows = () => (tables[table] || []).filter((r) => q.f.every(([c, v]) => r[c] === v));
  const chain = { select() { return chain; }, eq(c, v) { q.f.push([c, v]); return chain; }, is() { return chain; }, order() { return chain; }, limit() { return chain; },
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }), then(res, rej) { return Promise.resolve({ data: rows(), error: null }).then(res, rej); } };
  return chain;
} });
const mkOwner = (responses = {}, tables = {}) => ({ userId: OWNER.userId, profile: { id: OWNER.profileId, currency: "XAF" }, supabase: makeDb(tables), admin: makeAdmin(responses) });
const ctx = (o = {}) => ({ reminder_id: RID(1), number: "INV-2026-0001", locale: "fr", currency: "XAF", amount_due: "5000.000", due_date: "2026-10-20", kind: "manual", days_overdue: 0,
  to: "client@x.test", phone: "237677123456", customer_name: "Chantal", seller_name: "Boutique Elise", reply_to: "elise@shop.test", include_link: false, profile_id: OWNER.profileId, ...o });
const TOKEN = crypto.randomBytes(32).toString("base64url");
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

// ======================================================================== validation
{
  const c = (b, creating = true) => V.parseContactBody(b, creating);
  check("contact: valid body passes with text kept", c({ name: " Chantal ", phone: "677 12 34 56", email: "a@b.co", notes: "n", client_request_id: RID(1) }).ok);
  for (const [label, body, code] of [["blank name", { name: " ", client_request_id: RID(1) }, "invalid_customer_name"], ["121-char name", { name: "x".repeat(121), client_request_id: RID(1) }, "invalid_customer_name"],
    ["bad email", { name: "A", email: "nope", client_request_id: RID(1) }, "invalid_email"], ["long notes", { name: "A", notes: "n".repeat(501), client_request_id: RID(1) }, "invalid_notes"],
    ["long phone", { name: "A", phone: "1".repeat(41), client_request_id: RID(1) }, "invalid_phone"], ["no request id on create", { name: "A" }, "request_id_required"], ["bad request id", { name: "A", client_request_id: "x" }, "request_id_required"]]) {
    const r = c(body); check(`contact rejected: ${label}`, !r.ok && r.details.includes(code), JSON.stringify(r));
  }
  check("contact: an update needs no request id", c({ name: "A" }, false).ok);
  const s = (o = {}) => V.parseSettingsBody({ auto_email_enabled: false, remind_before_days: null, remind_on_due: false, overdue_every_days: 7, max_auto_per_invoice: 3, owner_alerts_enabled: false, ...o });
  check("settings: defaults pass; the whole approved range passes", s().ok && s({ remind_before_days: 1 }).ok && s({ remind_before_days: 14 }).ok && s({ overdue_every_days: 3 }).ok && s({ overdue_every_days: 60 }).ok && s({ max_auto_per_invoice: 6 }).ok && s({ overdue_every_days: null }).ok);
  for (const [label, o] of [["before 0", { remind_before_days: 0 }], ["before 15", { remind_before_days: 15 }], ["every 2", { overdue_every_days: 2 }], ["every 61", { overdue_every_days: 61 }], ["max 0", { max_auto_per_invoice: 0 }], ["max 7", { max_auto_per_invoice: 7 }],
    ["fraction", { overdue_every_days: 7.5 }], ["string", { overdue_every_days: "7" }], ["non-boolean auto", { auto_email_enabled: "yes" }]]) check(`settings rejected: ${label}`, !s(o).ok);
  check("settings: a non-object is rejected", !V.parseSettingsBody(null).ok);
  eq("link body: uuid, null and garbage", [V.parseLinkBody({ customer_id: ID(1) }).ok, V.parseLinkBody({ customer_id: null }).ok, V.parseLinkBody({ customer_id: "x" }).ok, V.parseLinkBody({}).ok], [true, true, false, false]);
  eq("share token extraction: url, pdf url, bare token; never garbage, wrong paths or short tokens", [V.extractShareToken(`https://ringo.test/d/${TOKEN}`), V.extractShareToken(`https://ringo.test/d/${TOKEN}/pdf`), V.extractShareToken(TOKEN), V.extractShareToken("https://x/d/short"), V.extractShareToken(`https://x/other/${TOKEN}`), V.extractShareToken(5), V.extractShareToken("javascript:alert(1)")], [TOKEN, TOKEN, TOKEN, null, null, null, null]);
  const rb = (o = {}) => V.parseReminderBody({ channel: "email", client_request_id: RID(1), ...o });
  check("reminder body: channels email and whatsapp_manual only; a request id is required; a bad link is rejected", rb().ok && rb({ channel: "whatsapp_manual" }).ok && !rb({ channel: "sms" }).ok && !rb({ client_request_id: "x" }).ok && !rb({ share_link: "nonsense" }).ok && rb({ share_link: `https://x/d/${TOKEN}` }).value.share_token === TOKEN);
}

// ======================================================================== error mapping
{
  const st = (message, code = "") => E.recvError({ message, code });
  eq("database codes map to precise statuses", [["customer_not_found", 404], ["duplicate_customer", 409], ["invoice_not_open", 409], ["no_email", 409], ["email_suppressed", 409], ["reminder_too_soon", 429], ["daily_cap_reached", 429], ["invoice_reminder_cap", 429], ["business_email_required", 409], ["share_link_invalid", 400], ["invalid_setting", 400]].map(([m]) => st(m).status), [404, 409, 409, 409, 409, 429, 429, 429, 409, 400, 400]);
  eq("a missing function/table is a clean 503", [st("x", "PGRST202").body.error, st("could not find the table 'public.bk_reminders'").status], ["receivables_unavailable", 503]);
  eq("Phase 2 codes fall through (document_not_found 404, not_owner 403, toolkit_not_enabled 403)", [st("document_not_found").status, st("not_owner").status, st("toolkit_not_enabled").status], [404, 403, 403]);
  eq("an unknown failure is a generic 500 with no detail", [st("some internal postgres text").status, st("some internal postgres text").body], [500, { error: "internal_error" }]);
  check("every known code has a translated message (or a Phase 2 one) and a raw code is never shown", E.KNOWN_RECEIVABLES_ERRORS.every((c) => UE.recvErrorKey(c) !== null || ["reminder_not_found", "not_an_invoice"].includes(c)) && UE.recvErrorKey("totally_unknown") === null);
  for (const lang of ["en", "fr"]) {
    const errs = translations[lang].receivables.errors;
    check(`${lang}: every mapped error key has a message`, [...new Set(E.KNOWN_RECEIVABLES_ERRORS.map(UE.recvErrorKey).filter(Boolean).concat(["unavailable", "emailFailed", "shareLinkInvalid"]))].every((k) => typeof errs[k] === "string" && errs[k].length > 5));
  }
}

// ======================================================================== messages
{
  const fr = M.renderReminderEmail(ctx(), null), en = M.renderReminderEmail(ctx({ locale: "en" }), null);
  check("French email: subject, greeting, exact amount, due date, reply hint and the 'on behalf' footer", fr.subject === "Relance de paiement : facture INV-2026-0001 de Boutique Elise" && /Bonjour Chantal/.test(fr.html) && /5 000 FCFA/.test(fr.html) && /20\/10\/2026|20 oct/i.test(fr.html) && /répondre à cet e-mail/.test(fr.html) && /au nom de Boutique Elise/.test(fr.html));
  check("English email: English subject and amount format", en.subject === "Payment reminder: invoice INV-2026-0001 from Boutique Elise" && /FCFA 5,000/.test(en.html) && /Amount Due/.test(en.html));
  check("an automatic reminder (no link) contains no link at all", !/<a\s|href=|https?:\/\//i.test(M.renderReminderEmail(ctx({ kind: "overdue", days_overdue: 3 }), null).html.replace(/https?:\/\/(www\.)?ringo[^"' <]*/gi, "")) || !/href=/.test(M.renderReminderEmail(ctx(), null).html));
  check("a supplied link renders as the single button, escaped", (() => { const h = M.renderReminderEmail(ctx(), `https://ringo.test/d/${TOKEN}`).html; return (h.match(/href=/g) || []).length === 1 && h.includes(`/d/${TOKEN}`) && /Voir votre facture/.test(h); })());
  const hostile = M.renderReminderEmail(ctx({ customer_name: "<script>alert(1)</script>", seller_name: "A&B \"Shop\"" }), null).html;
  check("customer and seller text is HTML-escaped", !/<script>/.test(hostile) && /&lt;script&gt;/.test(hostile) && /A&amp;B &quot;Shop&quot;/.test(hostile));
  check("timing notes: overdue days, due today, upcoming", /3 jours de retard/.test(M.renderReminderEmail(ctx({ days_overdue: 3 }), null).html) && /aujourd'hui|aujourd&#39;hui/.test(M.renderReminderEmail(ctx({ kind: "due_today" }), null).html) && /1 day overdue/.test(M.renderReminderEmail(ctx({ locale: "en", days_overdue: 1 }), null).html));
  check("no reply-to: no 'reply to this email' sentence; the email never claims verification", !/répondre à cet e-mail/.test(M.renderReminderEmail(ctx({ reply_to: null }), null).html) && !/verif|vérifi|confirmed by ringo/i.test(fr.html + en.html));
  eq("amount formatting is exact from the decimal text (KWD 3 decimals, USD 2)", [M.amountText({ amount_due: "12.345", currency: "KWD", locale: "en" }), M.amountText({ amount_due: "1234.50", currency: "USD", locale: "fr" })], ["KWD 12.345", "1 234,50 USD"]);
  const wa = M.buildWhatsAppReminder(ctx(), null);
  check("WhatsApp draft: wa.me with international digits, encoded French text, no link unless supplied", wa.href.startsWith("https://wa.me/237677123456?text=") && decodeURIComponent(wa.href.split("text=")[1]) === wa.text && /Montant dû 5 000 FCFA/.test(wa.text) && !/https?:\/\/(?!wa\.me)/.test(wa.text));
  check("WhatsApp draft with a link includes exactly that link; with a bad phone there is no draft", M.buildWhatsAppReminder(ctx(), "https://ringo.test/d/abc").text.includes("https://ringo.test/d/abc") && M.buildWhatsAppReminder(ctx({ phone: null }), null) === null && M.buildWhatsAppReminder(ctx({ phone: "12" }), null) === null && M.buildWhatsAppReminder(ctx({ phone: "+237 6" }), null) === null);
  check("the WhatsApp text never says sent or delivered", !/\b(sent|delivered|envoy|livr)/i.test(wa.text + M.buildWhatsAppReminder(ctx({ locale: "en" }), null).text));
  const al = M.overdueAlertText(ctx({ locale: "en" }));
  check("owner alert text is bilingual and short", /is overdue/.test(al.title) && /Amount Due of FCFA 5,000/.test(al.body) && /est en retard/.test(M.overdueAlertText(ctx()).title));
}

// ======================================================================== handlers
{
  const owner = mkOwner({ bk_customer_save: { data: { customer: { id: ID(1) }, created: true, duplicate: false }, error: null } });
  let r = await H.saveContact(owner, null, { name: "Chantal", client_request_id: RID(1), profile_id: "evil", p_profile_id: "evil" });
  const [fn, args] = owner.admin.calls[0];
  check("create contact: 201, controlled function called with the SESSION's profile and user (a profile id in the body is ignored)", r.status === 201 && fn === "bk_customer_save" && args.p_profile_id === OWNER.profileId && args.p_actor_user_id === OWNER.userId && !JSON.stringify(args).includes("evil"));
  const dup = mkOwner({ bk_customer_save: { data: { created: false, duplicate: false, duplicate_of: { id: ID(7), name: "Existing" } }, error: null } });
  r = await H.saveContact(dup, null, { name: "Chantal", phone: "677", client_request_id: RID(2) });
  check("an existing phone/email is REPORTED (409 duplicate_customer + the existing contact), never merged", r.status === 409 && r.body.error === "duplicate_customer" && r.body.existing.id === ID(7));
  const rep = mkOwner({ bk_customer_save: { data: { customer: { id: ID(1) }, created: false, duplicate: true }, error: null } });
  check("a repeated request id returns the original (200)", (await H.saveContact(rep, null, { name: "C", client_request_id: RID(3) })).status === 200);
  const bad = mkOwner();
  check("invalid input and non-uuid ids never reach the database", (await H.saveContact(bad, null, { name: "" })).status === 400 && (await H.saveContact(bad, "nope", { name: "A" })).status === 404 && (await H.setContactArchived(bad, "nope", { archived: true })).status === 404
    && (await H.setDocumentCustomer(bad, "x", { customer_id: null })).status === 404 && (await H.sendReminder(bad, "x", {}, { send: async () => ({ ok: true }), origin: "" })).status === 404 && bad.admin.calls.length === 0);
  const lk = mkOwner({ doc_set_document_customer: { data: { changed: true }, error: null } });
  await H.setDocumentCustomer(lk, ID(5), { customer_id: ID(6) });
  eq("linking passes the session identity, the document and the contact", lk.admin.calls[0], ["doc_set_document_customer", { p_profile_id: OWNER.profileId, p_actor_user_id: OWNER.userId, p_document_id: ID(5), p_customer_id: ID(6) }]);
  const arch = mkOwner({ bk_customer_set_archived: { data: { changed: true }, error: null }, bk_customer_set_auto_paused: { data: { changed: true }, error: null } });
  await H.setContactArchived(arch, ID(1), { archived: true }); await H.setContactAutoPaused(arch, ID(1), { paused: true });
  check("archive and pause use their controlled functions; non-boolean bodies are rejected", arch.admin.calls.map((c) => c[0]).join() === "bk_customer_set_archived,bk_customer_set_auto_paused" && (await H.setContactArchived(mkOwner(), ID(1), { archived: "yes" })).status === 400);

  const sumOwner = mkOwner({ doc_receivables_summary: { data: { today: "2026-10-01", profile_currency: "XAF", currencies: [{ currency: "XAF", can_record_payment: true, outstanding: "18500.000", overdue: "0", invoice_count: 4, overdue_count: 0,
    aging: { not_due: { amount: "18500.000", count: 4 } }, customers: [{ customer_id: ID(1), name: "A", archived: false, auto_paused: true, outstanding: "11500.000", overdue: "0", invoice_count: 2, oldest_due_date: "2026-10-05", last_reminder_at: null }],
    unassigned: { outstanding: "3000.000", overdue: "0", invoice_count: 1 } }, { currency: "KWD", can_record_payment: false, outstanding: "12.345", overdue: "1.001", invoice_count: 1, overdue_count: 1, aging: {}, customers: [], unassigned: { outstanding: "0", overdue: "0", invoice_count: 0 } }] }, error: null } });
  const sm = (await H.receivablesSummary(sumOwner)).body;
  check("summary: exact decimals become integer minor units per currency (XAF 0, KWD 3 decimals); flags pass through", sm.currencies[0].outstanding_minor === 18500 && sm.currencies[0].customers[0].outstanding_minor === 11500 && sm.currencies[0].unassigned.outstanding_minor === 3000 && sm.currencies[0].aging.not_due.amount_minor === 18500
    && sm.currencies[1].outstanding_minor === 12345 && sm.currencies[1].overdue_minor === 1001 && sm.currencies[1].can_record_payment === false && sm.currencies[0].customers[0].auto_paused === true);
  const invOwner = mkOwner({ doc_receivable_invoices: { data: { total: 1, items: [{ id: ID(2), number: "INV-1", status: "issued", currency: "XAF", total: "5000.000", amount_paid: "1000.000", amount_due: "4000.000", overdue: true, days_overdue: 3, linked: false, has_email: true, has_phone: false, can_record_payment: true }] }, error: null } });
  const iv = await H.receivableInvoices(invOwner, { customer: null, unassigned: "1", overdue: "1", currency: "xaf", limit: "10", offset: "20" });
  check("invoice list: filters are passed safely (currency upper-cased, limits sanitised) and amounts are minor units", iv.body.items[0].amount_due_minor === 4000 && invOwner.admin.calls[0][1].p_currency === "XAF" && invOwner.admin.calls[0][1].p_unassigned === true && invOwner.admin.calls[0][1].p_overdue_only === true && invOwner.admin.calls[0][1].p_limit === 10 && invOwner.admin.calls[0][1].p_offset === 20);
  const odd = mkOwner({ doc_receivable_invoices: { data: { items: [], total: 0 }, error: null } });
  await H.receivableInvoices(odd, { currency: "'; drop", limit: "-5", offset: "abc" });
  check("hostile query values fall back to safe defaults", odd.admin.calls[0][1].p_currency === null && odd.admin.calls[0][1].p_limit === 50 && odd.admin.calls[0][1].p_offset === 0 && (await H.receivableInvoices(mkOwner(), { customer: "x" })).status === 404);
  const st = mkOwner({ doc_customer_statement: { data: { customer: { id: ID(1), name: "A", archived_at: null, auto_reminders_paused: false }, profile_currency: "XAF", invoices: [{ id: ID(2), number: "INV-1", status: "issued", currency: "XAF", total: "5000.000", amount_paid: "0", amount_due: "5000.000", overdue: false }],
    payments: [{ id: ID(3), invoice_id: ID(2), invoice_number: "INV-1", receipt_number: "RCT-1", amount: "1000.000", currency: "XAF", method: "cash", paid_on: "2026-10-01", voided: true }], totals: [{ currency: "XAF", outstanding: "5000.000", overdue: "0" }] }, error: null } });
  const sb = (await H.contactStatement(st, ID(1))).body;
  check("statement: minor units, voided payments flagged, nothing internal leaked", sb.invoices[0].amount_due_minor === 5000 && sb.payments[0].amount_minor === 1000 && sb.payments[0].voided === true && sb.totals[0].outstanding_minor === 5000 && !("archived_at" in sb.customer));

  const sOwner = mkOwner({ doc_upsert_reminder_settings: { data: { auto_email_enabled: false }, error: null } });
  await H.putReminderSettings(sOwner, { auto_email_enabled: false, remind_before_days: null, remind_on_due: false, overdue_every_days: 7, max_auto_per_invoice: 3, owner_alerts_enabled: false });
  check("settings: saved through the controlled function with the session identity; invalid values never reach it", sOwner.admin.calls[0][0] === "doc_upsert_reminder_settings" && sOwner.admin.calls[0][1].p_profile_id === OWNER.profileId && (await H.putReminderSettings(mkOwner(), { auto_email_enabled: true, max_auto_per_invoice: 99 })).status === 400);
  const gs = await H.getReminderSettings(mkOwner({}, { bk_reminder_settings: [], bk_business_profiles: [{ profile_id: OWNER.profileId, email: "b@x.test" }] }));
  check("settings read: defaults are OFF/7 days/3 when no row exists; business email presence is reported", gs.body.settings.auto_email_enabled === false && gs.body.settings.owner_alerts_enabled === false && gs.body.settings.overdue_every_days === 7 && gs.body.settings.max_auto_per_invoice === 3 && gs.body.business_email_present === true && gs.body.limits.autoDailyCap === 30);
}

// ======================================================================== sendReminder (manual)
{
  const sendLog = [];
  const deps = (ok = { ok: true }) => ({ origin: "https://ringo.test", send: async (i) => { sendLog.push(i); return typeof ok === "function" ? ok(i) : ok; } });
  const record = (extra = {}) => ({ data: { duplicate: false, reminder_id: RID(9), channel: "email", status: "claimed", context: ctx({ reminder_id: RID(9), ...extra }) }, error: null });
  const body = (o = {}) => ({ channel: "email", client_request_id: RID(1), ...o });

  sendLog.length = 0;
  let o = mkOwner({ doc_record_manual_reminder: record(), doc_complete_reminder: { data: { status: "sent" }, error: null } });
  let r = await H.sendReminder(o, ID(5), body(), deps());
  check("email: claimed first, then exactly ONE send, then the outcome recorded (in that order)", r.status === 201 && r.body.status === "sent" && sendLog.length === 1 && o.admin.calls.map((c) => c[0]).join() === "doc_record_manual_reminder,doc_complete_reminder" && o.admin.calls[1][1].p_status === "sent");
  check("the send uses the existing email infrastructure contract: recipient, subject, reply-to, and the reminder id as the log/idempotency resource", sendLog[0].to === "client@x.test" && sendLog[0].replyTo === "elise@shop.test" && sendLog[0].log.emailType === "invoice_reminder" && sendLog[0].log.resourceId === RID(9) && /INV-2026-0001/.test(sendLog[0].subject));
  check("no link in the email when none was supplied, and the database was given no token hash", !/href=/.test(sendLog[0].html) && o.admin.calls[0][1].p_share_token_hash === null);
  check("the request identity comes from the session, never from the body", o.admin.calls[0][1].p_profile_id === OWNER.profileId && o.admin.calls[0][1].p_actor_user_id === OWNER.userId);

  sendLog.length = 0;
  o = mkOwner({ doc_record_manual_reminder: record({ include_link: true }), doc_complete_reminder: { data: { status: "sent" }, error: null } });
  r = await H.sendReminder(o, ID(5), body({ share_link: `https://ringo.test/d/${TOKEN}` }), deps());
  const argsJson = JSON.stringify(o.admin.calls);
  check("a pasted link: the DATABASE receives only its SHA-256 hash (never the token), validates it, and only then is it put in the email", o.admin.calls[0][1].p_share_token_hash === sha(TOKEN) && !argsJson.includes(TOKEN) && sendLog[0].html.includes(`https://ringo.test/d/${TOKEN}`) && r.status === 201);
  sendLog.length = 0;
  o = mkOwner({ doc_record_manual_reminder: record({ include_link: false }), doc_complete_reminder: { data: {}, error: null } });
  await H.sendReminder(o, ID(5), body({ share_link: `https://ringo.test/d/${TOKEN}` }), deps());
  check("a link the database did not confirm (include_link false) is NEVER emailed, even if one was pasted", !sendLog[0].html.includes(TOKEN));
  sendLog.length = 0;
  o = mkOwner({ doc_record_manual_reminder: { data: null, error: { message: "share_link_invalid" } } });
  r = await H.sendReminder(o, ID(5), body({ share_link: `https://ringo.test/d/${TOKEN}` }), deps());
  check("an invalid or revoked link is refused (400) and nothing is sent", r.status === 400 && r.body.error === "share_link_invalid" && sendLog.length === 0);

  sendLog.length = 0;
  o = mkOwner({ doc_record_manual_reminder: { data: { duplicate: true, reminder_id: RID(9), channel: "email", status: "sent" }, error: null } });
  r = await H.sendReminder(o, ID(5), body(), deps());
  check("a repeated request returns the original and does NOT send again", r.status === 200 && r.body.duplicate === true && sendLog.length === 0 && o.admin.calls.length === 1);

  for (const [code, status] of [["reminder_too_soon", 429], ["invoice_reminder_cap", 429], ["daily_cap_reached", 429], ["no_email", 409], ["email_suppressed", 409], ["invoice_not_open", 409], ["customer_archived", 409], ["document_not_found", 404]]) {
    sendLog.length = 0;
    o = mkOwner({ doc_record_manual_reminder: { data: null, error: { message: code } } });
    r = await H.sendReminder(o, ID(5), body(), deps());
    check(`database refusal ${code} -> ${status}, nothing sent`, r.status === status && sendLog.length === 0);
  }

  o = mkOwner({ doc_record_manual_reminder: record(), doc_complete_reminder: { data: {}, error: null } });
  r = await H.sendReminder(o, ID(5), body(), deps({ ok: false, error: "all_recipients_suppressed" }));
  check("a suppressed address is recorded as suppressed (409), not as sent", r.status === 409 && r.body.error === "email_suppressed" && o.admin.calls[1][1].p_status === "suppressed");
  o = mkOwner({ doc_record_manual_reminder: record(), doc_complete_reminder: { data: {}, error: null } });
  r = await H.sendReminder(o, ID(5), body(), deps({ ok: false, error: "provider_not_configured" }));
  check("a provider failure is recorded as failed with a short code (502)", r.status === 502 && r.body.error === "email_failed" && o.admin.calls[1][1].p_status === "failed" && o.admin.calls[1][1].p_failure_code === "provider_not_configured");
  o = mkOwner({ doc_record_manual_reminder: record(), doc_complete_reminder: { data: {}, error: null } });
  r = await H.sendReminder(o, ID(5), body(), { origin: "x", send: async () => { throw new Error("boom with details"); } });
  check("a throwing sender is recorded as failed, with no internal text in the response", r.status === 502 && o.admin.calls[1][1].p_failure_code === "send_threw" && !JSON.stringify(r.body).includes("boom"));
  o = mkOwner({ doc_record_manual_reminder: record({ to: null }), doc_complete_reminder: { data: {}, error: null } });
  sendLog.length = 0;
  r = await H.sendReminder(o, ID(5), body(), deps());
  check("no recipient on the claimed context: nothing is sent, recorded as failed", sendLog.length === 0 && r.status === 502 && o.admin.calls[1][1].p_failure_code === "no_recipient");

  // WhatsApp
  sendLog.length = 0;
  o = mkOwner({ doc_record_manual_reminder: { data: { duplicate: false, reminder_id: RID(8), channel: "whatsapp_manual", status: "prepared", context: ctx({ reminder_id: RID(8), include_link: false }) }, error: null } });
  r = await H.sendReminder(o, ID(5), body({ channel: "whatsapp_manual" }), deps());
  check("WhatsApp: only a click-to-chat draft is prepared (status prepared); no email, no completion call, never 'sent'", r.status === 201 && r.body.status === "prepared" && r.body.whatsapp.href.startsWith("https://wa.me/") && sendLog.length === 0 && o.admin.calls.length === 1 && !/sent|delivered/i.test(JSON.stringify(r.body.status)));
  o = mkOwner({ doc_record_manual_reminder: { data: { duplicate: false, reminder_id: RID(8), channel: "whatsapp_manual", status: "prepared", context: ctx({ reminder_id: RID(8), include_link: true }) }, error: null } });
  r = await H.sendReminder(o, ID(5), body({ channel: "whatsapp_manual", share_link: `https://ringo.test/d/${TOKEN}` }), deps());
  check("WhatsApp with a validated link puts that link in the draft, and the token never reaches the database", r.body.whatsapp.text.includes(`https://ringo.test/d/${TOKEN}`) && !JSON.stringify(o.admin.calls).includes(TOKEN));
  o = mkOwner({ doc_record_manual_reminder: { data: null, error: { message: "no_phone" } } });
  check("WhatsApp without a phone is refused (409 no_phone)", (await H.sendReminder(o, ID(5), body({ channel: "whatsapp_manual" }), deps())).status === 409);
}

// ======================================================================== cron
{
  const sent = [], notified = [], pushed = [];
  const mkDeps = (admin, env, extra = {}) => ({ admin, env, send: async (i) => { sent.push(i); return { ok: true }; }, notifyUser: async (u, i) => { notified.push([u, i]); }, pushToUser: async (u, p) => { pushed.push([u, p]); }, ...extra });
  const claimData = { emails: [ctx({ reminder_id: RID(1), kind: "overdue", days_overdue: 3 }), ctx({ reminder_id: RID(2), kind: "due_today", to: "b@x.test" })], alerts: [{ ...ctx({ reminder_id: RID(3), locale: "en" }), owner_user_id: OWNER.userId }] };
  for (const env of [{}, { INVOICE_REMINDERS_CRON_ENABLED: "false" }, { INVOICE_REMINDERS_CRON_ENABLED: "TRUE" }, { INVOICE_REMINDERS_CRON_ENABLED: "1" }, { INVOICE_REMINDERS_CRON_ENABLED: " true" }]) {
    const a = makeAdmin({ doc_claim_due_reminders: { data: claimData, error: null } });
    const res = await C.runInvoiceReminders(mkDeps(a, env));
    check(`DORMANT: with ${JSON.stringify(env)} the run does nothing at all (no claim, no sweep, no send)`, res.enabled === false && a.calls.length === 0 && sent.length === 0);
  }
  const a = makeAdmin({ doc_expire_stale_reminder_claims: { data: 2, error: null }, doc_claim_due_reminders: { data: claimData, error: null }, doc_complete_reminder: { data: {}, error: null } });
  const res = await C.runInvoiceReminders(mkDeps(a, { INVOICE_REMINDERS_CRON_ENABLED: "true" }));
  check("enabled: sweep stale claims, claim, send each email once, record each outcome once, then notify owners (in that order)", a.calls.map((c) => c[0]).join() === "doc_expire_stale_reminder_claims,doc_claim_due_reminders,doc_complete_reminder,doc_complete_reminder,doc_complete_reminder"
    && sent.length === 2 && notified.length === 1 && pushed.length === 1 && res.sent === 2 && res.alerts === 1 && res.claimed === 2 && res.staleClosed === 2);
  check("every automatic email: reminder id as the provider idempotency resource, reply-to set, recipient from the claim, and NO link of any kind", sent.every((s) => s.log.resourceId && s.log.emailType === "invoice_reminder" && s.replyTo === "elise@shop.test" && !/href=|\/d\//.test(s.html)) && sent[0].log.resourceId === RID(1) && sent[1].to === "b@x.test");
  check("outcomes are recorded under the claiming business and status sent", a.calls.filter((c) => c[0] === "doc_complete_reminder").every((c) => c[1].p_profile_id === OWNER.profileId) && a.calls[2][1].p_status === "sent");
  check("the owner alert goes to the owner only (bell + push) pointing at the Debtors page", notified[0][0] === OWNER.userId && notified[0][1].type === "invoice_overdue" && notified[0][1].link === "/dashboard/documents/receivables" && pushed[0][0] === OWNER.userId && pushed[0][1].url === "/dashboard/documents/receivables" && /is overdue/.test(notified[0][1].title));

  sent.length = 0;
  const f = makeAdmin({ doc_claim_due_reminders: { data: { emails: claimData.emails, alerts: [] }, error: null }, doc_complete_reminder: { data: {}, error: null } });
  let n = 0;
  const r2 = await C.runInvoiceReminders(mkDeps(f, { INVOICE_REMINDERS_CRON_ENABLED: "true" }, { send: async () => { n++; return n === 1 ? { ok: false, error: "all_recipients_suppressed" } : { ok: false, error: "provider_request_failed" }; } }));
  check("suppressed and failed sends are recorded with their own status and counted; nothing is retried", r2.suppressed === 1 && r2.failed === 1 && f.calls.filter((c) => c[0] === "doc_complete_reminder").map((c) => c[1].p_status).join() === "suppressed,failed" && n === 2);
  const t = makeAdmin({ doc_claim_due_reminders: { data: { emails: [claimData.emails[0]], alerts: [] }, error: null }, doc_complete_reminder: { data: {}, error: null } });
  const r3 = await C.runInvoiceReminders(mkDeps(t, { INVOICE_REMINDERS_CRON_ENABLED: "true" }, { send: async () => { throw new Error("x"); } }));
  check("a throwing sender is recorded as failed and does not stop the run", r3.failed === 1 && t.calls[t.calls.length - 1][1].p_failure_code === "send_threw");
  sent.length = 0;
  const bad = makeAdmin({ doc_claim_due_reminders: { data: null, error: { message: "boom", code: "XX" } } });
  const r4 = await C.runInvoiceReminders(mkDeps(bad, { INVOICE_REMINDERS_CRON_ENABLED: "true" }));
  check("a failing claim sends nothing and reports claim_failed", r4.error === "claim_failed" && sent.length === 0);
  const noEmail = makeAdmin({ doc_claim_due_reminders: { data: { emails: [ctx({ to: null })], alerts: [] }, error: null }, doc_complete_reminder: { data: {}, error: null } });
  const r5 = await C.runInvoiceReminders(mkDeps(noEmail, { INVOICE_REMINDERS_CRON_ENABLED: "true" }));
  check("a claimed row without a recipient is recorded failed (no_recipient), nothing sent", r5.failed === 1 && sent.length === 0 && noEmail.calls[noEmail.calls.length - 1][1].p_failure_code === "no_recipient");
  const al = makeAdmin({ doc_claim_due_reminders: { data: { emails: [], alerts: claimData.alerts }, error: null }, doc_complete_reminder: { data: {}, error: null } });
  const r6 = await C.runInvoiceReminders(mkDeps(al, { INVOICE_REMINDERS_CRON_ENABLED: "true" }, { notifyUser: async () => { throw new Error("x"); } }));
  check("a failing owner notification is recorded failed and does not count as an alert", r6.alerts === 0 && al.calls[al.calls.length - 1][1].p_status === "failed");
  const lim = makeAdmin({ doc_claim_due_reminders: { data: { emails: [], alerts: [] }, error: null } });
  await C.runInvoiceReminders(mkDeps(lim, { INVOICE_REMINDERS_CRON_ENABLED: "true" }, { limit: 25 }));
  eq("the batch size is bounded and passed to the database", lim.calls.find((c) => c[0] === "doc_claim_due_reminders")[1], { p_limit: 25 });
}

// ======================================================================== routes (owner gate, cron secret)
{
  const owner = async (res) => { globalThis.__owner = res; };
  const body = (o) => new Request("http://x/api", { method: "POST", body: JSON.stringify(o), headers: { "content-type": "application/json" } });
  const ROUTES = [["receivables/customers", "GET", {}], ["receivables/customers", "POST", {}], ["receivables/customers/[id]", "GET", { id: ID(1) }], ["receivables/customers/[id]", "PUT", { id: ID(1) }], ["receivables/customers/[id]/archive", "POST", { id: ID(1) }],
    ["receivables/customers/[id]/pause", "POST", { id: ID(1) }], ["receivables/summary", "GET", {}], ["receivables/invoices", "GET", {}], ["receivables/settings", "GET", {}], ["receivables/settings", "PUT", {}],
    ["receivables/documents/[id]/customer", "GET", { id: ID(2) }], ["receivables/documents/[id]/customer", "PUT", { id: ID(2) }], ["receivables/documents/[id]/suggestions", "GET", { id: ID(2) }],
    ["receivables/documents/[id]/reminders", "GET", { id: ID(2) }], ["receivables/documents/[id]/reminders", "POST", { id: ID(2) }]];
  let denied = true, calls = 0;
  for (const [p, method, params] of ROUTES) {
    const mod = route(p);
    for (const [reason, status] of [["not_signed_in", 401], ["plan_not_enabled", 403], ["not_owner", 403], ["demo_profile", 403], ["category_not_enabled", 403]]) {
      globalThis.__admin = makeAdmin();
      await owner({ ok: false, reason });
      const res = await mod[method](method === "GET" ? new Request("http://x/api") : body({}), { params });
      if (res.status !== status || (await res.json()).error !== reason) denied = false;
      calls += globalThis.__admin.calls.length;
    }
  }
  check(`every one of the ${ROUTES.length} Phase 3 route handlers refuses a signed-out, un-entitled, non-owner, demo or wrong-category caller (401/403) before doing anything`, denied && calls === 0);
  check("every route file is force-dynamic and goes through the shared owner gate", ROUTES.every(([p]) => { const s = strip(read(`src/app/api/${p}/route.ts`)); return /export const dynamic = "force-dynamic"/.test(s) && /withOwner/.test(s); }));
  globalThis.__sent = []; globalThis.__notified = []; globalThis.__pushed = [];
  const adm = makeAdmin({ doc_record_manual_reminder: { data: { duplicate: false, reminder_id: RID(9), channel: "email", status: "claimed", context: ctx({ reminder_id: RID(9) }) }, error: null }, doc_complete_reminder: { data: {}, error: null } });
  await owner({ ok: true, owner: { userId: OWNER.userId, profile: { id: OWNER.profileId, currency: "XAF" }, supabase: makeDb(), admin: adm } });
  const res = await route("receivables/documents/[id]/reminders").POST(new Request("https://ringo.test/api/x", { method: "POST", body: JSON.stringify({ channel: "email", client_request_id: RID(1) }) }), { params: { id: ID(2) } });
  check("reminder route: 201 through the existing sender with private headers; the shared owner gate resolved the profile", res.status === 201 && globalThis.__sent.length === 1 && res.headers.get("cache-control") === "private, no-store" && res.headers.get("referrer-policy") === "no-referrer");
  delete globalThis.__owner;

  const cron = route("cron/invoice-reminders");
  const call = (h) => cron.GET(new Request("http://x/api/cron/invoice-reminders", { headers: h }));
  const saved = { s: process.env.CRON_SECRET, e: process.env.INVOICE_REMINDERS_CRON_ENABLED };
  delete process.env.CRON_SECRET;
  check("cron: no CRON_SECRET configured => unauthorized (never open)", (await call({ authorization: "Bearer undefined" })).status === 401 && (await call({})).status === 401);
  process.env.CRON_SECRET = "s3cret";
  check("cron: missing or wrong bearer => 401", (await call({})).status === 401 && (await call({ authorization: "Bearer wrong" })).status === 401 && (await call({ authorization: "s3cret" })).status === 401);
  delete process.env.INVOICE_REMINDERS_CRON_ENABLED;
  globalThis.__sent = [];
  globalThis.__admin = makeAdmin({ doc_claim_due_reminders: { data: { emails: [ctx()], alerts: [] }, error: null } });
  const dormant = await call({ authorization: "Bearer s3cret" });
  check("cron: authorised but the environment flag is off => 200 {enabled:false}, nothing claimed or sent", dormant.status === 200 && (await dormant.json()).enabled === false && globalThis.__admin.calls.length === 0 && globalThis.__sent.length === 0);
  process.env.INVOICE_REMINDERS_CRON_ENABLED = "true";
  globalThis.__admin = makeAdmin({ doc_claim_due_reminders: { data: { emails: [ctx()], alerts: [] }, error: null }, doc_complete_reminder: { data: {}, error: null }, doc_expire_stale_reminder_claims: { data: 0, error: null } });
  globalThis.__sent = [];
  const live = await (await call({ authorization: "Bearer s3cret" })).json();
  check("cron: enabled + authorised runs the claim/send/complete cycle", live.enabled === true && live.sent === 1 && globalThis.__sent.length === 1);
  if (saved.s === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = saved.s;
  if (saved.e === undefined) delete process.env.INVOICE_REMINDERS_CRON_ENABLED; else process.env.INVOICE_REMINDERS_CRON_ENABLED = saved.e;
}

// ======================================================================== static: scope, boundaries, wording, protected files
{
  const libFiles = ["handlers", "cron", "reminderMessages", "validation", "http", "uiErrors", "constants", "access"].map((n) => `src/lib/receivables/${n}.ts`);
  const code = libFiles.map((f) => [f, strip(read(f))]);
  check("the Phase 3 server code never writes a table directly (no insert/update/delete/upsert)", code.every(([, s]) => !/\.(insert|update|delete|upsert)\s*\(/.test(s)));
  check("it never touches bookkeeping or the invoice ledger: no bk_entries / bk_documents / bk_document_payments writes, no record/void payment, no issue", code.every(([, s]) => !/bk_entries|bk_record_entry|bk_void_entry|doc_record_payment|doc_void_payment|doc_issue|doc_save_draft|doc_void_document|from\("bk_documents"\)|from\("bk_document_payments"\)/.test(s)));
  check("it NEVER creates a share link (no doc_create_share, no generateShareToken) and never stores or logs a token", code.every(([, s]) => !/doc_create_share|generateShareToken|console\.(log|info|debug)/.test(s)) && /hashShareToken\(token\)/.test(strip(read("src/lib/receivables/handlers.ts"))));
  check("the only functions called are the Phase 3 controlled ones", (() => { const names = new Set(code.flatMap(([, s]) => [...s.matchAll(/(?:rpc\(owner,\s*|rpc\(\s*)"([a-z_]+)"/g)].map((m) => m[1]))); const ok = new Set(["bk_customer_save", "bk_customer_set_archived", "bk_customer_set_auto_paused", "doc_set_document_customer", "doc_suggest_customers", "doc_receivables_summary", "doc_receivable_invoices", "doc_customer_statement", "doc_upsert_reminder_settings", "doc_record_manual_reminder", "doc_complete_reminder", "doc_expire_stale_reminder_claims", "doc_claim_due_reminders"]); return names.size >= 10 && [...names].every((n) => ok.has(n)); })());
  check("the cron route is guarded by CRON_SECRET and the dormant flag, and does nothing about WhatsApp or SMS", /CRON_SECRET/.test(read("src/app/api/cron/invoice-reminders/route.ts")) && /INVOICE_REMINDERS_CRON_ENABLED/.test(read("src/lib/receivables/constants.ts")) && code.every(([, s]) => !/twilio|sendSms|whatsapp-business|graph\.facebook/i.test(s)));
  const vj = JSON.parse(read("vercel.json"));
  check("vercel.json: the six original crons are unchanged, invoice reminders (~09:00 UTC) is the seventh, and the only later addition is the approved Phase 10 WhatsApp inbox follow-ups cron (10:00 UTC)", vj.crons.length === 8 && vj.crons[6].path === "/api/cron/invoice-reminders" && vj.crons[6].schedule === "0 9 * * *" && vj.crons[7].path === "/api/cron/inbox-follow-ups" && vj.crons[7].schedule === "0 10 * * *"
    && ["downgrade-expired", "cleanup-demo-accounts", "protection-auto-release", "content-calendar-reminders", "ambassador-activation-sweep", "reconcile-signup-payments"].every((n, i) => vj.crons[i].path === `/api/cron/${n}`));
  const sql = read("supabase/migrations/2026-12-03_debtors_reminders.sql");
  check("the reminder function never builds an automatic message with a link (claim returns no link; table forbids include_link on auto rows)", /include_link = false or \(trigger_type = 'manual' and channel <> 'owner_alert'\)/.test(sql));

  // translations
  const flat = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? flat(v, `${p}${k}.`) : [`${p}${k}`])).sort();
  eq("receivables has identical keys in English and French", flat(translations.fr.receivables), flat(translations.en.receivables));
  const strings = (lang) => { const out = []; const walk = (v) => { if (typeof v === "string") out.push(v); else if (typeof v === "function") out.push(v(...Array(6).fill("X"), null)); else if (v && typeof v === "object") Object.values(v).forEach(walk); }; walk(translations[lang].receivables); return out; };
  const en = strings("en"), fr = strings("fr");
  check("no empty strings; French is really translated", [...en, ...fr].every((s) => String(s).trim().length > 0) && flat(translations.en.receivables).length > 150 && fr.filter((s, i) => s === en[i]).length < 14, fr.filter((s, i) => s === en[i]).join("|"));
  check("terminology: Credit Sale / Amount Due / Outstanding Balance / Overdue (EN) and the French equivalents are used", /Credit Sale/i.test(JSON.stringify(translations.en.receivables.ui.newCreditSale)) && translations.en.receivables.ui.amountDue === "Amount Due" && translations.en.receivables.ui.outstandingBalance === "Outstanding Balance" && translations.en.receivables.ui.overdue === "Overdue"
    && translations.fr.receivables.ui.amountDue === "Montant dû" && translations.fr.receivables.ui.outstandingBalance === "Solde impayé" && /vente à crédit/i.test(translations.fr.receivables.ui.newCreditSale));
  check("'credit' is only ever used inside 'credit sale' (EN) / 'vente à crédit' (FR): never confusable with package or loyalty credits", en.every((s) => !/\bcredits?\b/i.test(s.replace(/credit sales?/gi, ""))) && fr.every((s) => !/crédit/i.test(s.replace(/ventes? à crédit/gi, ""))));
  check("wording: nothing says Ringo verified/confirmed a payment; 'sent'/'delivered' appear only in denials or about the EMAIL Ringo really sends", [...en, ...fr].every((s) => !/verified|vérifié|confirmed by ringo/i.test(s)));
  check("WhatsApp wording is always 'opened'/'prepared'/'not sent by Ringo', never 'sent' or 'delivered' as a fact", /not sent by Ringo/.test(translations.en.receivables.ui.reminderStatus.prepared) && /non envoyé par Ringo/.test(translations.fr.receivables.ui.reminderStatus.prepared)
    && [translations.en.receivables.ui.whatsappNote, translations.en.receivables.ui.whatsappOpened].every((s) => /not|never/i.test(s)) && [translations.fr.receivables.ui.whatsappNote, translations.fr.receivables.ui.whatsappOpened].every((s) => /pas|jamais/i.test(s)));
  check("automatic reminders are described as OFF by default and link-free, in both languages", /Off by default/.test(translations.en.receivables.ui.autoEmailHelp) && /never contain an invoice link/.test(translations.en.receivables.ui.autoEmailHelp) && /Désactivé par défaut/.test(translations.fr.receivables.ui.autoEmailHelp) && /jamais de lien/.test(translations.fr.receivables.ui.autoEmailHelp) && /Off by default/.test(translations.en.receivables.ui.ownerAlertsHelp));

  // UI
  const uiFiles = fs.readdirSync(path.join(REPO, "src/components/receivables")).map((f) => `src/components/receivables/${f}`);
  const ui = Object.fromEntries(uiFiles.map((f) => [f, strip(read(f))]));
  check("the UI never writes to the database or builds a public link: it only calls /api/receivables/** (and the normal /api/documents payments for a deposit)", Object.values(ui).every((s) => !/\.(insert|update|delete|upsert|rpc)\s*\(/.test(s) && !/\.from\("/.test(s) && !/[`"']\/d\//.test(s)));
  const urls = [...Object.values(ui), strip(read("src/components/documents/InvoiceEditor.tsx"))].flatMap((s) => [...s.matchAll(/["`](\/api\/[^"`$?]*)/g)].map((m) => m[1]));
  check("every API call goes to /api/receivables/** or the documents payments endpoint", urls.length > 8 && urls.every((u) => u.startsWith("/api/receivables") || u.startsWith("/api/documents")), [...new Set(urls)].join());
  const offenders = [];
  for (const [f, s] of Object.entries(ui)) {
    const noExpr = s.replace(/\{[^{}]*\}/g, "{}").replace(/\{[^{}]*\}/g, "{}").replace(/\{[^{}]*\}/g, "{}");
    for (const m of noExpr.matchAll(/(?<![\w\])])<[A-Za-z][A-Za-z0-9.]*(?:\s[^<>]*)?>([^<>{}]+)</g)) if (/[A-Za-zÀ-ÿ]{3,}/.test(m[1].trim())) offenders.push(`${path.basename(f)}: ${m[1].trim().slice(0, 30)}`);
    for (const m of s.matchAll(/\b(placeholder|aria-label|title|alt)="([^"{}]*[A-Za-z]{3,}[^"{}]*)"/g)) offenders.push(`${path.basename(f)}: ${m[1]}="${m[2]}"`);
  }
  check("no hardcoded user-facing text in any Phase 3 component (everything goes through translations)", offenders.length === 0, offenders.slice(0, 5).join(" | "));
  const keysUsed = new Set(Object.values(ui).flatMap((s) => [...s.matchAll(/\br\.([A-Za-z]+)/g)].map((m) => m[1])));
  const defined = new Set(Object.keys(translations.en.receivables.ui));
  check("every translation key the Phase 3 UI uses exists in both languages", [...keysUsed].every((k) => defined.has(k) && k in translations.fr.receivables.ui), [...keysUsed].filter((k) => !defined.has(k)).join());
  const editor = strip(read("src/components/documents/InvoiceEditor.tsx"));
  check("credit sale: needs a customer name and a due date before issuing; the deposit and the contact link run only AFTER the invoice is issued, via the normal APIs", /creditMissing/.test(editor) && /cr\.creditNeedCustomer/.test(editor) && /cr\.creditNeedDue/.test(editor) && (() => { const fn = editor.slice(editor.indexOf("const issueNow")); return fn.indexOf("/issue`") > 0 && fn.indexOf("/issue`") < fn.indexOf("/customer`") && fn.indexOf("/issue`") < fn.indexOf("/payments`"); })());
  check("credit sale: a failed deposit or link never undoes the issued invoice (a notice, no rollback call)", /setNotice/.test(editor) && !/\/void/.test(editor));
  check("the invoice page shows the customer/reminder section only for issued, non-void invoices and hides itself when Phase 3 is unavailable", /view\.status !== "draft" && view\.status !== "void"/.test(strip(read("src/components/documents/DocumentView.tsx"))) && /state !== "ready"\) return null/.test(ui["src/components/receivables/InvoiceCustomerSection.tsx"]));
  const tabs = strip(read("src/components/documents/DocumentsTabs.tsx")), layout = strip(read("src/app/dashboard/documents/layout.tsx"));
  check("the Debtors tab appears only when the Phase 3 tables exist (hidden, not half-working, before the migration)", /debtors \? \[/.test(tabs) && /receivablesAvailable/.test(layout) && /debtors=\{debtors\}/.test(layout));

  // protected paths and package files
  const git = (args) => execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).split("\n").filter(Boolean);
  const changed = [...git(["diff", "--name-only", "HEAD"]), ...git(["ls-files", "--others", "--exclude-standard"])].map((f) => f.replace(/\\/g, "/"));
  const PROTECTED = ["src/lib/productCheckout/", "src/lib/protection/", "src/lib/fapshi.ts", "src/lib/fapshiSafety.ts", "src/lib/applyPayment.ts", "src/lib/musicReceipt.ts", "src/lib/musicOrderPayment.ts", "src/lib/shopAuth.ts", "src/lib/email/", "src/app/api/products/", "src/app/api/protection/",
    "src/app/api/shop/", "src/app/api/billing/", "src/app/api/music/", "src/app/api/orders/", "src/app/api/auth/", "src/app/auth/", "src/middleware.ts", "src/lib/supabase/", "src/lib/bookkeeping/", "src/app/api/bookkeeping/", "src/lib/documents/handlers.ts", "src/lib/documents/shareToken.ts", "src/lib/documents/publicShare.ts"];
  const hit = changed.filter((f) => !isPhase8AuthFile(f) && !isPhase16ProtectedFile(f) && !RECORD_SALE_FILES.test(f) && !["src/app/api/bookkeeping/entries/route.ts", "src/lib/bookkeeping/recordEntry.ts", "src/lib/bookkeeping/decision.ts", "src/lib/inventory/access.ts", "supabase/migrations/2026-12-05_ringo_ai_business_drafts.sql", "supabase/support/2026-12-05_ringo_ai_business_drafts.rollback.sql"].includes(f) && PROTECTED.some((p) => f.startsWith(p))); // Phase 7: the invoice-payment replace guard on the entries route (tested in bookkeeping.test.mjs)
  check("NO protected file is modified or added: checkout, settlement, payments, protection, email provider, auth, middleware, Phase 1 bookkeeping, and the Phase 2 handlers/share security", hit.length === 0, hit.join(","));
  {
    // Intended invariant: no migration that already exists in HEAD (Phase 1, Phase 2, Phase 3 and everything earlier) is modified, renamed or deleted;
    // the only migrations that may appear in the working tree are NEW files dated after the Phase 3 one (a later phase), never an older slot.
    const PHASE3 = "supabase/migrations/2026-12-03_debtors_reminders.sql";
    const inHead = git(["ls-tree", "-r", "--name-only", "HEAD", "supabase/migrations/"]);
    const modifiedExisting = git(["diff", "--name-only", "HEAD", "--", "supabase/migrations/"]);
    const added = git(["ls-files", "--others", "--exclude-standard", "--", "supabase/migrations/"]);
    const phase3Tracked = inHead.includes(PHASE3);
    eq("no existing migration (Phase 1, Phase 2, Phase 3 or earlier) is modified, renamed or deleted", modifiedExisting.filter((f) => inHead.includes(f) || !added.includes(f)), []);
    check("any migration added in the working tree is new and dated AFTER the Phase 3 one (never an older slot, never a rewrite)", added.every((f) => !inHead.includes(f) && (isPhase16Migration(f) || isPhase17Migration(f) || isPhase18Migration(f) || isPhase21Migration(f) || f.slice("supabase/migrations/".length) > PHASE3.slice("supabase/migrations/".length))), added.join(","));
    check("the Phase 3 migration is present, unchanged from its committed form (or, before it is committed, the only new migration)", phase3Tracked ? !changed.includes(PHASE3) : added.includes(PHASE3) && added.filter((f) => f !== PHASE3).every((f) => f > PHASE3));
  }
  check("package.json and package-lock.json are unchanged (no dependency added)", changed.filter((f) => !isPhase16ProtectedFile(f)).every((f) => f !== "package.json" && f !== "package-lock.json"));
  const p2 = ["src/lib/documents/totals.ts", "src/lib/documents/numbering.ts", "src/lib/documents/routeKit.ts"]; // snapshot.ts, http.ts and actions.ts changed on purpose (branding / sale facts / error codes / the void-sale action) (branding / sale facts / new error codes): see recordSaleUnit.test.mjs
  check("the Phase 2 document library files other than the (unchanged) handlers are untouched", p2.every((f) => !changed.includes(f)));
}

for (const f of tmp) { try { fs.unlinkSync(f); } catch {} }
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
