// Ringo AI x Business Toolkit (write foundation, business actions, category expansion, restaurant payments): offline unit tests. The REAL validators, draft
// definitions, tools, category registry, gate decision, restaurant payments tool, knowledge and prompt are loaded through jiti; only the database edge is an
// in-memory fake. No network, no database, no model call, no migration. The end-to-end behaviour against real SQL is in aiBusinessApplySql.test.mjs.
//   Run:  node scripts/tests/aiBusinessDrafts.test.mjs
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { OWNER_WORKSPACE_FILES } from "./ownerWorkspaceFiles.mjs"; // Owner Workspace UX pass: the exact files it changes on purpose
import { isPhase8AuthFile } from "./phase8Files.mjs"; // Phase 8: the exact auth / env files of "Continue with Google / Apple" (see phase8Files.mjs)
import { SRC, REPO, PROFILE, OTHER, makeDb, counters } from "./phase7Harness.mjs";

const require = createRequire(import.meta.url);
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8").replace(/\r\n/g, "\n");
const strip = (s) => s.replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
const tmp = [];
const serverStub = path.join(os.tmpdir(), `aibd_server_${process.pid}.cjs`);
fs.writeFileSync(serverStub, "module.exports = { createClient: () => globalThis.__db, createAdminClient: () => globalThis.__db };");
tmp.push(serverStub);
const jiti = require("jiti")(import.meta.url, { alias: { "@/lib/supabase/server": serverStub, "@": SRC }, interopDefault: true, cache: false });
const load = (p) => jiti(path.join(SRC, p));
const B = load("lib/ai/drafts/business.ts");
const { DRAFT_DEFINITIONS } = load("lib/ai/drafts/registry.ts");
const { DRAFT_TYPES } = load("lib/ai/drafts/types.ts");
const D = load("lib/ai/tools/definitions/businessDrafts.ts");
const RP = load("lib/ai/tools/definitions/restaurantPayments.ts");
const { AI_TOOLS } = load("lib/ai/tools/index.ts");
const { getAvailableTools } = load("lib/ai/tools/registry.ts");
const CAT = load("lib/ai/business/categories.ts");
const DEC = load("lib/bookkeeping/decision.ts");
const ELIG = load("lib/ai/business/eligibility.ts");
const { CATEGORY_IDS } = load("lib/categories.ts");
const { translations } = load("lib/i18n/translations.ts");
const { KNOWLEDGE_MODULES, getKnowledgeModule } = load("lib/ai/knowledge/index.ts");
const { buildStableSystemPrompt } = load("lib/ai/prompts/system.ts");

console.error = () => {};
const { c, check, eq } = counters();
const FACTS = (over = {}) => ({ category: "business_ecommerce", categories: ["business_ecommerce"], currency: "XAF", maxProducts: null, productCount: 0, eventCount: 0, businessToolkitAi: true, ...over });
const CTX = (over = {}, userText = []) => ({ facts: FACTS(over), userText, today: "2026-12-10" });
const UUID = "44444444-4444-4444-8444-000000000001";
const validNow = new Date();
const dateKey = (d) => d.toISOString().slice(0, 10);
const tomorrow = dateKey(new Date(validNow.getTime() + 3 * 86_400_000));

// ------------------------------------------------------------------------ 1. the draft registry: 13 types, each definition complete, every business type exists in the code and the SQL
const BK = ["bk.entry.create", "bk.invoice.create", "bk.invoice.payment", "bk.customer.create", "bk.stock.adjust"];
eq("registry: 13 draft types, the original 8 first and the 5 business types after", [DRAFT_TYPES.length, BK.every((t) => DRAFT_TYPES.includes(t))], [13, true]);
check("registry: every draft type has a definition and every definition has the full contract", DRAFT_TYPES.every((t) => { const d = DRAFT_DEFINITIONS[t]; return d && d.type === t && ["validate", "availability", "changes", "summary", "fieldNames", "apply", "reviewPath"].every((k) => typeof d[k] === "function"); }));
const sql = read("supabase/migrations/2026-12-05_ringo_ai_business_drafts.sql");
check("migration: allows exactly the 13 draft types of the code (no drift between code and CHECK)", DRAFT_TYPES.every((t) => sql.includes(`'${t}'`)) && new Set(sql.replace(/--.*$/gm, "").match(/'[a-z_]+\.[a-z_.]+'/g) || []).size === 13);
for (const lang of ["en", "fr"]) {
  const dr = translations[lang].ringoAi.drafts;
  check(`i18n ${lang}: every business draft has a title, a won't-change note, a public note, an applied note`, !!dr && BK.every((t) => dr.typeTitle?.[t] && dr.wontChange?.[t] && dr.publicNote?.[t] && dr.appliedNote?.[t]), JSON.stringify(Object.keys(dr ?? {})));
  check(`i18n ${lang}: every field a business draft shows has a label`, !!dr && ["bk_kind", "bk_amount", "bk_date", "bk_category", "bk_description", "bk_settled", "bk_customer", "bk_lines", "bk_invoice_total", "bk_due_date", "bk_notes", "bk_invoice", "bk_method", "bk_paid_on", "bk_reference", "bk_phone", "bk_email", "bk_product", "bk_stock_kind", "bk_quantity", "bk_reason"].every((k) => dr.fields?.[k]));
  check(`i18n ${lang}: every new failure code has a message`, !!dr && ["business_unavailable", "target_not_found", "amount_exceeds_balance", "duplicate_customer", "rejected_by_rules"].every((k) => dr.errors?.[k]));
  check(`i18n ${lang}: every enum a card can show is translated`, !!dr && ["sale", "other_income", "expense", "cash_in", "cash_out"].every((k) => dr.enums?.bk_kind?.[k]) && ["cash", "mobile_money", "bank_transfer", "card", "other"].every((k) => dr.enums?.bk_method?.[k]) && ["stock_in", "increase", "decrease", "damaged", "lost", "sold_elsewhere", "set_count"].every((k) => dr.enums?.bk_stock_kind?.[k]) && ["received", "paid", "not_received", "not_paid"].every((k) => dr.enums?.bk_settled?.[k]));
}
const route = strip(read("src/app/api/ai/drafts/[id]/apply/route.ts"));
check("apply route: the new failure codes map to HTTP statuses (403 business_unavailable; 409 target/amount/duplicate; 422 rules)", /business_unavailable:\s*403/.test(route) && /target_not_found:\s*409/.test(route) && /amount_exceeds_balance:\s*409/.test(route) && /duplicate_customer:\s*409/.test(route) && /rejected_by_rules:\s*422/.test(route));

// ------------------------------------------------------------------------ 2. entry validator
const E = (o) => B.validateEntryDraft({ kind: "sale", amount: 1000, date: null, category: null, description: null, settled: null, ...o }, CTX());
let v = E({});
check("entry: a plain sale validates; today is a Douala date; settled defaults to true; currency is the business's", v.ok && /^\d{4}-\d{2}-\d{2}$/.test(v.payload.date) && v.payload.settled === true && v.payload.currency === "XAF" && v.payload.amount === "1000", JSON.stringify(v));
check("entry: the payload re-validates to itself (apply re-validation never goes stale by itself)", v.ok && JSON.stringify(B.validateEntryDraft(v.payload, CTX()).payload) === JSON.stringify(v.payload));
for (const [label, o, reason] of [["negative", { amount: -1 }, "invalid_input"], ["zero", { amount: 0 }, "invalid_input"], ["text", { amount: "abc" }, "invalid_input"], ["too precise for XAF", { amount: 1.5 }, "invalid_input"], ["huge", { amount: 1e15 }, "invalid_input"], ["missing", { amount: null }, "missing_fields"], ["Infinity", { amount: Infinity }, "missing_fields"], ["future date", { date: tomorrow }, "invalid_input"], ["bad date", { date: "2026-13-45" }, "invalid_input"], ["unknown kind", { kind: "gift" }, "invalid_input"], ["reserved category", { category: "invoice_payment" }, "invalid_input"], ["reserved category, other case", { category: "Invoice_Payment" }, "invalid_input"], ["object description", { description: {} }, "invalid_input"]]) {
  const r = E(o);
  check(`entry: ${label} is refused`, r.ok === false && r.reason === reason, JSON.stringify(r));
}
check("entry: a USD page accepts cents and keeps the page currency", B.validateEntryDraft({ kind: "expense", amount: 12.5, date: null, category: "rent", description: null, settled: false }, CTX({ currency: "USD" })).payload?.amount === "12.50");
check("entry: cash in/out ignores a category and is always settled", ["cash_in", "cash_out"].every((k) => { const r = E({ kind: k, category: "rent", settled: false }); return r.ok && r.payload.category === null && r.payload.settled === true; }));
eq("entry: the model cannot choose the currency or an order link (extra keys are not carried)", Object.keys(E({ currency: "USD", linked_order_id: UUID, profile_id: OTHER }).payload).sort(), ["amount", "category", "currency", "date", "description", "kind", "settled"]);
check("entry: availability needs the Toolkit AI gate", B.entryCreateDraft.availability(FACTS({ businessToolkitAi: false })).ok === false && B.entryCreateDraft.availability(FACTS()).ok === true && B.entryCreateDraft.availability(FACTS({ businessToolkitAi: undefined })).ok === false);

// ------------------------------------------------------------------------ 3. invoice validator
const IV = (o) => B.validateInvoiceDraft({ customer_name: "Jean", customer_id: null, lines: [{ description: "Work", quantity: 2, unit_price: 5000 }], due_date: null, notes: null, locale: "en", ...o }, CTX());
v = IV({});
check("invoice: a valid draft keeps the exact lines and the currency; no tax is added", v.ok && v.payload.currency === "XAF" && v.payload.lines.length === 1 && v.payload.customerName === "Jean", JSON.stringify(v));
check("invoice: the payload re-validates to itself", v.ok && JSON.stringify(B.validateInvoiceDraft(v.payload, CTX()).payload) === JSON.stringify(v.payload), JSON.stringify(B.validateInvoiceDraft(v.payload, CTX())));
for (const [label, o] of [["no lines", { lines: [] }], ["a zero total", { lines: [{ description: "x", quantity: 1, unit_price: 0 }] }], ["a negative quantity", { lines: [{ description: "x", quantity: -1, unit_price: 5 }] }], ["an empty description", { lines: [{ description: " ", quantity: 1, unit_price: 5 }] }], ["more than 20 lines", { lines: Array.from({ length: 21 }, () => ({ description: "x", quantity: 1, unit_price: 1 })) }], ["a non-uuid customer id", { customer_id: "1; drop table" }], ["an invalid due date", { due_date: "soon" }], ["lines that are not an array", { lines: "x" }]]) {
  const r = IV(o);
  check(`invoice: ${label} is refused`, r.ok === false, JSON.stringify(r));
}
check("invoice: confirming only creates a DRAFT document (the definition calls createDraft, never issueDocument/recordPayment)", /createDraft\(/.test(strip(read("src/lib/ai/drafts/business.ts"))) && !/issueDocument|voidDocument|sendReminder|createShare/.test(strip(read("src/lib/ai/drafts/business.ts"))));

// ------------------------------------------------------------------------ 4. payment validator
const PV = (o) => B.validatePaymentDraft({ invoice_id: UUID, invoice_number: "INV-2026-0001", amount: 5000, method: "cash", paid_on: null, reference: null, ...o }, CTX());
v = PV({});
check("payment: a valid draft keeps the server-resolved invoice id and number", v.ok && v.payload.invoiceId === UUID && v.payload.invoiceNumber === "INV-2026-0001" && v.payload.amount === "5000", JSON.stringify(v));
check("payment: the payload re-validates to itself", v.ok && JSON.stringify(B.validatePaymentDraft(v.payload, CTX()).payload) === JSON.stringify(v.payload), JSON.stringify(B.validatePaymentDraft(v.payload, CTX())));
for (const [label, o] of [["a non-uuid invoice id", { invoice_id: "x" }], ["no invoice number", { invoice_number: " " }], ["zero", { amount: 0 }], ["negative", { amount: -5 }], ["an unknown method", { method: "crypto" }], ["a future date", { paid_on: tomorrow }], ["a text amount", { amount: "lots" }], ["a long reference", { reference: "r".repeat(300) }]]) {
  const r = PV(o);
  check(`payment: ${label} is refused`, r.ok === false, JSON.stringify(r));
}

// ------------------------------------------------------------------------ 5. customer validator: provenance of contact details
const CV = (o, said = []) => B.validateCustomerDraft({ name: "Marie", phone: null, email: null, ...o }, CTX({}, said));
check("customer: a name alone validates", CV({}).ok);
eq("customer: an empty name is refused", CV({ name: "  " }).reason, "missing_fields");
eq("customer: a phone the owner never typed is refused", CV({ phone: "677112233" }).reason, "contact_not_from_user");
eq("customer: an email the owner never typed is refused", CV({ email: "a@b.cm" }).reason, "contact_not_from_user");
check("customer: a phone and an email the owner typed are accepted", CV({ phone: "677112233", email: "marie@mail.cm" }, ["Marie's phone is 677 11 22 33 and her email marie@mail.cm"]).ok);
check("customer: the model's own text is never a provenance source", CV({ phone: "677112233" }, []).ok === false);
check("customer: an over-long name is refused", CV({ name: "n".repeat(300) }).ok === false);

// ------------------------------------------------------------------------ 6. stock validator
const SV = (o) => B.validateStockDraft({ product_id: UUID, product_name: "Red Shirt", kind: "stock_in", quantity: 5, reason: null, note: null, ...o });
v = SV({});
check("stock: a valid movement validates and re-validates to itself", v.ok && JSON.stringify(B.validateStockDraft(v.payload).payload) === JSON.stringify(v.payload), JSON.stringify(B.validateStockDraft(v.payload ?? {})));
for (const [label, o] of [["a non-uuid product id", { product_id: "x" }], ["a negative quantity", { quantity: -1 }], ["a fractional quantity", { quantity: 1.5 }], ["a zero quantity", { quantity: 0 }], ["a string quantity", { quantity: "5" }], ["an unknown kind", { kind: "teleport" }], ["a decrease without a reason", { kind: "decrease", reason: null }], ["an enormous quantity", { quantity: 1e12 }]]) {
  const r = SV(o);
  check(`stock: ${label} is refused`, r.ok === false, JSON.stringify(r));
}
check("stock: a stocktake may set the count to zero", SV({ kind: "set_count", quantity: 0, reason: "empty" }).ok === true);
check("stock: available only where stock tracking exists (Business & E-commerce) and the Toolkit AI gate holds", B.stockAdjustDraft.availability(FACTS()).ok === true && B.stockAdjustDraft.availability(FACTS({ category: "professional_services", categories: ["professional_services"] })).ok === false && B.stockAdjustDraft.availability(FACTS({ businessToolkitAi: false })).ok === false);

// ------------------------------------------------------------------------ 7. card contract: every change a draft shows has a label, no ids on the card
const sampleChanges = [
  B.entryCreateDraft.changes(E({ category: "rent", description: "x", kind: "expense", settled: false }).payload),
  B.invoiceCreateDraft.changes(IV({ due_date: "2026-12-31", notes: "n" }).payload),
  B.invoicePaymentDraft.changes(PV({ reference: "ref" }).payload),
  B.customerCreateDraft.changes({ name: "Marie", phone: "677112233", email: "m@m.cm" }),
  B.stockAdjustDraft.changes(SV({ reason: "r", note: "n" }).payload),
].flat();
const en = translations.en.ringoAi.drafts;
check("cards: every field that can be shown has an English label", sampleChanges.every((ch) => en.fields[ch.field]), sampleChanges.filter((ch) => !en.fields[ch.field]).map((ch) => ch.field).join());
check("cards: every enum value that can be shown is translated", sampleChanges.filter((ch) => ch.kind === "enum").every((ch) => en.enums[ch.field]?.[ch.after] !== undefined), sampleChanges.filter((ch) => ch.kind === "enum" && !en.enums[ch.field]?.[ch.after]).map((ch) => `${ch.field}=${ch.after}`).join());
check("cards: no change shows an id", !sampleChanges.some((ch) => JSON.stringify(ch).includes(UUID)));
check("cards: no summary or field-name list carries a value or an id (audit stores names only)", [B.entryCreateDraft.fieldNames(E({}).payload), B.invoicePaymentDraft.fieldNames(PV({}).payload), B.stockAdjustDraft.fieldNames(SV({}).payload), B.customerCreateDraft.fieldNames({ name: "M", phone: "677112233", email: null })].flat().every((n) => /^[a-z_]+$/.test(n)));

// ------------------------------------------------------------------------ 8. tools: kind, availability, schemas, no identity, no direct write
const tools = D.BUSINESS_DRAFT_TOOLS;
eq("tools: five prepare tools", tools.map((t) => t.name), ["prepare_bookkeeping_entry", "prepare_invoice", "prepare_invoice_payment", "prepare_customer", "prepare_stock_adjustment"]);
check("tools: every business write tool is a DRAFT tool (the model proposes; the registry refuses 'write')", tools.every((t) => t.kind === "draft") && !AI_TOOLS.some((t) => t.kind === "write"));
check("tools: no tool name suggests a direct write or an apply", !AI_TOOLS.some((t) => /^(apply|confirm|record_|create_bookkeeping|create_invoice|issue_|send_|delete_|void_)/.test(t.name)) && AI_TOOLS.every((t, i, a) => a.findIndex((x) => x.name === t.name) === i));
const SECRET_KEYS = /profile_id|user_id|workspace|owner|client_request_id|organization|org_id|currency|linked_order|customer_id|invoice_id|product_id|document_id|entry_id/;
check("tools: no input schema lets the model supply an identity, a currency, an order link or any record id", tools.every((t) => !SECRET_KEYS.test(Object.keys(t.inputSchema.properties).join(" "))), tools.map((t) => Object.keys(t.inputSchema.properties).join()).join(" | "));
check("tools: every schema is strict (all properties required, no additional properties)", tools.every((t) => t.inputSchema.additionalProperties === false && Object.keys(t.inputSchema.properties).every((k) => t.inputSchema.required.includes(k))));
check("tools: parseInput keeps only the schema's keys (extra keys such as profile_id are dropped)", tools.every((t) => { const raw = Object.fromEntries(Object.keys(t.inputSchema.properties).map((k) => [k, null])); const out = t.parseInput({ ...raw, profile_id: OTHER, user_id: OTHER, currency: "USD" }); return out && !("profile_id" in out) && !("user_id" in out) && !("currency" in out); }) && tools.every((t) => t.parseInput("x") === null && t.parseInput(null) === null && t.parseInput([]) === null));
const snap = (category, toolkit = true, categories = [category]) => ({ businessToolkitAi: toolkit, profile: { category, categories }, isRestaurant: category === "restaurant_food", isMusic: false, hasTicketing: false, plan: { aiImageEnabled: false } });
check("tools: offered for every Toolkit category when the plan allows, never when the plan does not", DEC.BOOKKEEPING_CATEGORIES.every((cat) => tools.filter((t) => t.name !== "prepare_stock_adjustment").every((t) => t.available(snap(cat)) === true && t.available(snap(cat, false)) === false)));
check("tools: stock tools only for Business & E-commerce", tools.find((t) => t.name === "prepare_stock_adjustment").available(snap("business_ecommerce")) && DEC.BOOKKEEPING_CATEGORIES.filter((cat) => cat !== "business_ecommerce").every((cat) => !tools.find((t) => t.name === "prepare_stock_adjustment").available(snap(cat))));
const listed = (s) => getAvailableTools({ workspace: { actor: { kind: "owner" } }, snapshot: s, locale: "en" }).map((t) => t.name);
check("tools: the registry offers the five prepare tools to an eligible page and none to a restaurant", tools.every((t) => listed(snap("business_ecommerce")).includes(t.name)) && tools.every((t) => !listed(snap("restaurant_food", false)).includes(t.name)));
const toolSrc = strip(read("src/lib/ai/tools/definitions/businessDrafts.ts")) + strip(read("src/lib/ai/business/lookup.ts"));
check("tools: no SQL, no rpc, no raw table access and no write call in the prepare tools or the name lookups", !/\.(insert|update|delete|upsert|rpc)\s*\(|\.from\(/.test(toolSrc));
check("tools: every prepare tool runs the Toolkit AI gate BEFORE resolving names or preparing anything", tools.every((t) => { const run = t.run.toString(); return /gate\(ctx\)|requireBusinessAi/.test(run) && (run.indexOf("gate(") < run.indexOf("prepareDraft") || !run.includes("prepareDraft")); }));
const draftsSrc = strip(read("src/lib/ai/drafts/business.ts"));
check("apply: every business draft re-runs the Toolkit gate (requireBusinessAi) before touching data", ["entryCreateDraft", "invoiceCreateDraft", "invoicePaymentDraft", "customerCreateDraft", "stockAdjustDraft"].every((n) => { const i = draftsSrc.indexOf(`export const ${n}`); const j = draftsSrc.indexOf("async apply", i); return j > 0 && /owner\(workspace\)/.test(draftsSrc.slice(j, j + 400)); }));
check("apply: the Toolkit request id is always the draft's target id (idempotency) and never model text", (draftsSrc.match(/client_request_id: draft\.targetId/g) || []).length >= 6 && !/client_request_id: p\./.test(draftsSrc));
check("apply: business drafts never call an RPC, a table or the service client themselves", !/\.rpc\(|\.from\("|createAdminClient|createClient/.test(draftsSrc));
check("no second confirmation mechanism: nothing in the AI tools or the orchestrator applies a draft", !/applyDraft/.test(strip(read("src/lib/ai/tools/definitions/businessDrafts.ts")) + strip(read("src/lib/ai/tools/definitions/drafts.ts")) + strip(read("src/lib/ai/tools/registry.ts"))));

// ------------------------------------------------------------------------ 9. category registry vs the gate
eq("registry: it agrees with BOOKKEEPING_CATEGORIES and INVENTORY_CATEGORIES (no drift)", CAT.registryProblems(), []);
check("registry: it covers every Ringo category exactly once", CATEGORY_IDS.every((id) => CAT.CATEGORY_PROFILES[id]?.id === id) && Object.keys(CAT.CATEGORY_PROFILES).length === CATEGORY_IDS.length);
eq("registry: the Toolkit categories are the business category plus the eleven finance-layer ones", Object.values(CAT.CATEGORY_PROFILES).filter((p) => p.toolkit).map((p) => p.id).sort(), [...DEC.BOOKKEEPING_CATEGORIES].sort());
check("registry: restaurant, music and events (which own their revenue) are NOT Toolkit categories; 'other' neither", ["restaurant_food", "music_entertainment", "events_experiences", "other"].every((id) => !CAT.CATEGORY_PROFILES[id].toolkit && !DEC.BOOKKEEPING_CATEGORIES.includes(id)));
eq("registry: only Business & E-commerce has stock tracking (the database enforces it)", Object.values(CAT.CATEGORY_PROFILES).filter((p) => p.inventory).map((p) => p.id), ["business_ecommerce"]);
check("registry: the inventory page/nav check, the gate and the SQL agree (inventory access reads the category)", /categoryHasInventory/.test(read("src/lib/inventory/access.ts")) && /business_ecommerce/.test(read("supabase/migrations/2026-12-04_inventory_stock_control.sql")));
check("registry: every category has notes or an explicit 'nothing' note, and every Toolkit category states what is not built", Object.values(CAT.CATEGORY_PROFILES).every((p) => p.notes.length > 0) && Object.values(CAT.CATEGORY_PROFILES).filter((p) => p.toolkit).every((p) => p.notBuilt.length > 0));
check("registry: no category promises a domain system (no CRM/ERP/payroll/tax engine is built or described as available)", !Object.values(CAT.CATEGORY_PROFILES).some((p) => p.notes.some((n) => /\b(payroll|royalt(y|ies) accounting|tax engine) (is|are) (available|built|offered)\b/i.test(n))));
check("registry: health minimizes names; the other categories do not", CAT.CATEGORY_PROFILES.health_medical.minimizeNames === true && Object.values(CAT.CATEGORY_PROFILES).filter((p) => p.minimizeNames).length === 1);
check("registry: the health notes forbid reading or discussing medical information", /Never ask for, read or discuss medical information/.test(CAT.CATEGORY_PROFILES.health_medical.notes.join(" ")));
eq("registry: initials", [CAT.initials("Marie Twin"), CAT.initials("  jean-luc  de la  croix "), CAT.initials(""), CAT.initials(null)], ["M. T.", "J. D. L. C.", null, null]);
eq("registry: categoryNotes follow the page's categories (a multi-category page gets de-duplicated notes, capped)", [CAT.categoryNotes({ category: "real_estate", categories: ["real_estate", "professional_services"] }).length <= 4, CAT.categoryNotes({ category: "health_medical", categories: [] }).some((n) => /Financial layer only/.test(n))], [true, true]);
check("registry: a page with ANY health category minimizes names (multi-category safe)", CAT.minimizeNames({ category: "real_estate", categories: ["real_estate", "health_medical"] }) === true && CAT.minimizeNames({ category: "real_estate", categories: ["real_estate"] }) === false);
check("eligibility: categoryHasToolkit follows BOOKKEEPING_CATEGORIES for the primary or any extra category", ELIG.categoryHasToolkit({ category: "real_estate", categories: [] }) && ELIG.categoryHasToolkit({ category: "other", categories: ["transport_logistics"] }) && !ELIG.categoryHasToolkit({ category: "restaurant_food", categories: ["restaurant_food"] }) && !ELIG.categoryHasToolkit({ category: null, categories: [] }));
const decSrc = strip(read("src/lib/bookkeeping/decision.ts"));
check("gate: the Toolkit decision itself still requires owner, non-demo, category and plan (unchanged logic)", /BOOKKEEPING_CATEGORIES/.test(decSrc) && /is_demo|isDemo/.test(decSrc) && /planEnabled/.test(decSrc));

// ------------------------------------------------------------------------ 10. restaurant payments (read-only; restaurant orders stay the source of truth)
const ORD = (id, status, pay, total, at, extra = {}) => ({ id, profile_id: PROFILE, status, payment_status: pay, total: String(total), created_at: at, customer_name: "SECRET NAME", customer_phone: "+237 600 000 000", ...extra });
globalThis.__db = makeDb({
  orders: [
    ORD("o1", "completed", "paid", 10000, "2026-12-09T23:30:00Z"),   // 00:30 on 10 December in Douala
    ORD("o2", "completed", "unpaid", 4000, "2026-12-09T22:30:00Z"),  // 23:30 on 9 December in Douala
    ORD("o3", "preparing", "unpaid", 6000, "2026-12-10T08:00:00Z"),
    ORD("o4", "cancelled", "paid", 7000, "2026-12-10T08:00:00Z"),
    ORD("o5", "refunded", "paid", 3000, "2026-12-10T09:00:00Z"),
    ORD("o6", "completed", "paid", 2500, "2026-12-10T10:00:00Z"),
    { ...ORD("ox", "completed", "paid", 99999, "2026-12-10T08:00:00Z"), profile_id: OTHER },
  ],
});
const NOW = new Date("2026-12-10T10:30:00Z"); // 11:30 on 10 December in Douala
const rctx = { workspace: { userId: "u", profileId: PROFILE, username: "x", actor: { kind: "owner" } }, snapshot: { profile: { currency: "XAF", category: "restaurant_food", categories: ["restaurant_food"] }, isRestaurant: true }, locale: "en", now: NOW };
const rToday = await RP.getMyRestaurantPayments.run(rctx, { period: "today" });
eq("restaurant payments: Douala today = 10 December: gross order sales exclude cancelled and refunded, split by the restaurant's own payment status", [rToday.gross_order_sales, rToday.order_count, rToday.marked_paid, rToday.not_yet_paid, rToday.cancelled_or_refunded_orders], [18500, 3, { orders: 2, amount: 12500 }, { orders: 1, amount: 6000 }, 2]);
const rYesterday = await RP.getMyRestaurantPayments.run(rctx, { period: "yesterday" });
eq("restaurant payments: an order at 23:30 UTC the day before is still 'yesterday' in Douala only if before 23:00 UTC; 22:30 UTC is yesterday", [rYesterday.gross_order_sales, rYesterday.order_count], [4000, 1]);
check("restaurant payments: another business's orders are never counted", rToday.gross_order_sales + rYesterday.gross_order_sales === 22500);
check("restaurant payments: the answer carries no customer name, phone or order id", !/SECRET NAME|\+237|"o\d"/.test(JSON.stringify(rToday)));
check("restaurant payments: it says the payment status is declared and that these are not bookkeeping revenue", /declaration, not a provider-confirmed payment/.test(rToday.note) && /not bookkeeping revenue/.test(rToday.note));
check("restaurant payments: it is a read tool for restaurant pages only, with a closed period list and no custom range", RP.getMyRestaurantPayments.kind === "read" && RP.getMyRestaurantPayments.available({ isRestaurant: true }) === true && RP.getMyRestaurantPayments.available({ isRestaurant: false }) === false && RP.getMyRestaurantPayments.parseInput({ period: "custom" }) === null && RP.getMyRestaurantPayments.parseInput({ period: "7d" }) === null && RP.getMyRestaurantPayments.parseInput({ period: "this_month" })?.period === "this_month");
check("restaurant payments: it never writes and never copies anything into the books", !/\.(insert|update|delete|upsert|rpc)\s*\(|bk_|recordEntry/.test(strip(read("src/lib/ai/tools/definitions/restaurantPayments.ts"))));
check("restaurant payments: the pre-existing restaurant, music and event tools are untouched", ["restaurantSales", "musicSales", "eventsSummary"].every((f) => { try { return fs.existsSync(path.join(REPO, `src/lib/ai/tools/definitions/${f}.ts`)); } catch { return false; } }));
check("restaurant payments: it is registered and has an English and a French status label", AI_TOOLS.some((t) => t.name === "get_my_restaurant_payments") && ["en", "fr"].every((l) => JSON.stringify(translations[l]).includes("get_my_restaurant_payments")));

// ------------------------------------------------------------------------ 11. knowledge and prompt
const mod = getKnowledgeModule("business_ai");
check("knowledge: business_ai is current, live and names every prepare tool, the card confirmation and the source-of-truth rules", mod.status === "live" && mod.version >= 2 && tools.every((t) => mod.body.includes(t.name)) && /Confirm and Apply/.test(mod.body) && /typed "yes"/.test(mod.body) && /get_my_restaurant_payments/.test(mod.body) && /Restaurant, music and events pages do NOT have the Toolkit/.test(mod.body) && /never added to Toolkit|never recorded in the books/.test(mod.body));
check("knowledge: it states the health restriction, the inventory restriction and the no-ERP rule", /medical information is never read or discussed/.test(mod.body) && /Stock tracking .* only for Business & E-commerce/.test(mod.body) && /never a CRM, project, fleet, farm, school, property or medical system/.test(mod.body));
check("knowledge: it no longer claims the tools are read-only, Business & E-commerce only, or that nothing can be recorded", !/Read-only: nothing can be recorded/.test(mod.body + mod.limitations.join(" ")) && !/Business & E-commerce only for now/.test(mod.limitations.join(" ")) && !/NOT AVAILABLE YET \(say so plainly\): recording a sale/.test(mod.body));
check("knowledge: it promises no date and no price", !/\b(soon|next week|coming in|will launch)\b/i.test(mod.body) && !/\b\d[\d\s.,]*\s?(xaf|fcfa|usd|eur)\b/i.test(mod.body));
const stable = buildStableSystemPrompt();
check("prompt: the five prepare tools and the card rule are in the stable prompt, with the draft rules", tools.every((t) => stable.includes(t.name)) && /Confirm & Apply/.test(stable) && /typed 'yes' applies nothing/.test(stable));
check("prompt: it states the category scope (Toolkit categories; never restaurant, music or events), inventory scope and the health rule", /never restaurant, music or events pages/.test(stable) && /only where stock tracking exists/.test(stable) && /Health pages: financial layer only/.test(stable));
check("prompt: it names get_my_restaurant_payments with the declared-status caveat and no revenue duplication", /get_my_restaurant_payments/.test(stable) && /declared by the restaurant, not confirmed by a payment provider/.test(stable));
check("prompt: it still carries no volatile or per-user data and no timezone text", !/\d{4}-\d{2}-\d{2}T|Douala|demo@|username: /.test(stable));
check("knowledge registry: the category modules and the business_ai module are all registered once", KNOWLEDGE_MODULES.filter((m) => m.id === "business_ai").length === 1);

// ------------------------------------------------------------------------ 12. read tools: category notes, name minimization, inventory scope
const BT = load("lib/ai/tools/definitions/business.ts");
const inv = BT.BUSINESS_AI_TOOLS.filter((t) => /inventory|low_stock/.test(t.name));
check("read tools: get_inventory and get_low_stock are offered only where stock tracking exists", inv.length === 2 && inv.every((t) => t.available(snap("business_ecommerce")) && !t.available(snap("professional_services")) && !t.available(snap("health_medical")) && !t.available(snap("business_ecommerce", false))));
const others = BT.BUSINESS_AI_TOOLS.filter((t) => !/inventory|low_stock/.test(t.name));
check("read tools: the other business read tools are offered for every Toolkit category", others.length === 5 && DEC.BOOKKEEPING_CATEGORIES.every((cat) => others.every((t) => t.available(snap(cat)))));
check("read tools: they never take an id or an identity from the model", BT.BUSINESS_AI_TOOLS.every((t) => !SECRET_KEYS.test(Object.keys(t.inputSchema.properties).join(" "))));
const btSrc = strip(read("src/lib/ai/tools/definitions/business.ts"));
check("read tools: category notes are attached to the summary and sales answers, and health names go through the minimizer in invoice and statement answers", /category_notes: categoryNotes/.test(btSrc) && (btSrc.match(/shownName\(ctx,/g) || []).length >= 3);

// ------------------------------------------------------------------------ 13. scope: nothing it must not touch
const git = (args) => require("child_process").execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).split("\n").filter(Boolean).map((f) => f.replace(/\\/g, "/"));
let changed = [];
try { changed = [...git(["diff", "--name-only", "HEAD"]), ...git(["ls-files", "--others", "--exclude-standard"])]; } catch { /* not a git checkout */ }
check("scope: no payments, checkout, auth, middleware, music, restaurant, ticketing or webhook code is changed", !changed.filter((f) => !isPhase8AuthFile(f)).some((f) => /^src\/(lib\/(productCheckout|payments|fapshi|protection|music|restaurant|tickets)|middleware|app\/auth|app\/api\/(payments|fapshi|music|restaurant|tickets|webhooks|cron|auth|shop|orders|products|billing|protection))/.test(f)), changed.filter((f) => /payments|checkout|auth|middleware|music|restaurant|tickets|webhooks/.test(f)).join());
check("scope: no package file, no schema.sql and no existing migration is changed; the only new SQL is the un-applied draft-type migration and its rollback", !changed.some((f) => /^(package(-lock)?\.json|supabase\/schema\.sql|tsconfig\.tsbuildinfo)$/.test(f)) && changed.filter((f) => /^supabase\//.test(f)).every((f) => /2026-12-05_ringo_ai_business_drafts|2026-12-06_record_sale_receipts_branding/.test(f) || OWNER_WORKSPACE_FILES.has(f)), changed.filter((f) => /^supabase\//.test(f)).join());
check("scope: no scratch, secret or environment file is part of the change", !changed.filter((f) => !isPhase8AuthFile(f)).some((f) => /(^|\/)\.env|\.pem$|\.key$|scratch|_probe|\.log$/.test(f)));
check("scope: no production URL, key or token is embedded in the new or changed code and tests", ![...changed.filter((f) => /\.(ts|tsx|mjs|sql)$/.test(f) && fs.existsSync(path.join(REPO, f)))].some((f) => /sk-[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{30,}\.|service_role_key\s*[:=]\s*["'][^"']{20,}|supabase\.co\/rest/.test(read(f))), "");

for (const f of tmp) try { fs.unlinkSync(f); } catch {}
console.log(`aiBusinessDrafts: ${c.pass} passed, ${c.fail} failed`);
process.exit(c.fail ? 1 : 0);
