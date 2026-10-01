// Ringo AI knowledge for Business Toolkit Phase 4 (inventory & stock control): registered in the existing registry, passes the validator,
// keeps Reserved apart from Sold, inventory apart from bookkeeping/invoices/credit sales, seller-entered apart from Ringo-verified, and never
// promises anything unavailable. Nothing here calls a model or the network.
//   Run:  node scripts/tests/inventoryAi.test.mjs
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8").replace(/\r\n/g, "\n");

const stub = path.join(os.tmpdir(), `inv_ai_server_stub_${process.pid}.cjs`);
fs.writeFileSync(stub, "module.exports = { createAdminClient: () => ({ from: () => ({ select: () => ({ limit: async () => { if (globalThis.__throw) throw new Error('x'); return { error: globalThis.__missing ? { message: 'relation does not exist' } : null }; } }) }) }) };");
const jiti = require("jiti")(import.meta.url, { alias: { "@/lib/supabase/server": stub, "@": SRC }, interopDefault: true, cache: false });
const { KNOWLEDGE_MODULES, getKnowledgeModule, renderKnowledgeCatalog, renderModuleForLookup } = jiti(path.join(SRC, "lib/ai/knowledge/index.ts"));
const { validateKnowledgeModules, validateDiagnosticReferences } = jiti(path.join(SRC, "lib/ai/knowledge/validate.ts"));
const { DIAGNOSTIC_CHECKS } = jiti(path.join(SRC, "lib/ai/diagnostics/checks.ts"));
const { translations } = jiti(path.join(SRC, "lib/i18n/translations.ts"));

let pass = 0, fail = 0;
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", name, "|", String(detail).slice(0, 300)); } };
const m = getKnowledgeModule("inventory");
const body = m.body;
const has = (re) => re.test(body);

check("registered once, in the catalog, validator clean", !!m && KNOWLEDGE_MODULES.filter((x) => x.id === "inventory").length === 1 && /^- inventory: /m.test(renderKnowledgeCatalog())
  && validateKnowledgeModules(KNOWLEDGE_MODULES).length === 0 && validateDiagnosticReferences(DIAGNOSTIC_CHECKS, KNOWLEDGE_MODULES).length === 0);
check("related topics exist; loaded on demand; honest 'partial' status until the migration exists in the target environment", (m.related || []).every((r) => getKnowledgeModule(r)) && !m.appliesTo.always && !(m.appliesTo.categories || []).length && m.status === "partial");
check("metadata present (who, actions, prerequisites, limitations)", m.whoCanUse && m.actions.length >= 4 && m.prerequisites.length >= 2 && m.limitations.length >= 3);

const topics = [
  ["untracked products stay unlimited; nothing starts by itself", /no count is "unlimited"[\s\S]*Ringo never starts tracking by itself/],
  ["seller-entered, never verified by Ringo", /Every count is the seller's own figure[\s\S]*NEVER say Ringo verified/],
  ["opening quantity, adoption keeps the count, default low level 5, stop makes it unlimited and keeps history", /opening quantity[\s\S]*keeps that number[\s\S]*default 5[\s\S]*unlimited again[\s\S]*history is kept/],
  ["RESERVED IS NOT SOLD", /RESERVED IS NOT SOLD[\s\S]*RESERVED \(taken off the count\) straight away, before payment[\s\S]*go back automatically/],
  ["Reserved and Sold defined separately; inventory never deducts again on payment", /held by Shop orders still awaiting payment[\s\S]*paid or fulfilled[\s\S]*never call reserved units "sold"[\s\S]*does not\. Inventory only reads and displays/i],
  ["only Shop orders move stock automatically; invoices/credit sales/invoice payments never do", /Only Shop orders move stock automatically[\s\S]*issuing an invoice, recording a credit sale or recording an invoice payment never touches inventory/],
  ["other sales are recorded manually as sold elsewhere, with a reason, without touching invoice or bookkeeping", /Sold elsewhere[\s\S]*reason is required[\s\S]*does not change the invoice or any bookkeeping entry/],
  ["adjustments: kinds, correction needs a reason, never below zero, history immutable and survives product deletion", /stock received, manual increase, manual decrease, damaged, lost, sold elsewhere[\s\S]*Correct the count[\s\S]*never go below zero[\s\S]*cannot be edited or deleted[\s\S]*even if the product is later deleted/i],
  ["refund restock: manual, refunded orders only, partial allowed, capped, once, no order/payment change", /manual and only for Shop orders that are already marked refunded[\s\S]*partial is fine[\s\S]*only be done once[\s\S]*does not change the order or any payment/],
  ["late payment after release stays a manual decision", /already released[\s\S]*NOT taken off again automatically[\s\S]*seller's decision/],
  ["editor field is read-only for tracked products", /tracked product's stock number is read-only[\s\S]*Untracked products keep the editable number/],
  ["estimated value is informational, not accounting", /informational only[\s\S]*NOT an accounting valuation \(no FIFO, no average cost\)/],
  ["separate from bookkeeping and invoices", /never creates a bookkeeping entry, an invoice, a receipt or a payment/],
  ["not available list", /NOT AVAILABLE[\s\S]*digital products[\s\S]*music merchandise[\s\S]*ticket or event capacity[\s\S]*low-stock email, SMS or WhatsApp[\s\S]*automatic stock changes from invoices or credit sales[\s\S]*variants, multiple warehouses/],
  ["no tool: never invent a number", /no tool for it[\s\S]*never invent a number/],
];
for (const [name, re] of topics) check(`covers: ${name}`, has(re));

{
  const sentences = body.split(/(?<=[.!?])\s+|\n+/);
  const risky = sentences.filter((s) => /\bverif|confirm|guarantee|audit/i.test(s));
  const safe = /\b(NEVER|not|no|never|cannot)\b/i;
  const bad = risky.filter((s) => !safe.test(s));
  check("no sentence affirms that Ringo verified, confirmed, audited or guarantees stock", bad.length === 0, bad.join(" || "));
  const sold = sentences.filter((s) => /\bsold\b/i.test(s) && /reserved/i.test(s));
  check("every sentence that puts Reserved and Sold together keeps them apart", sold.every((s) => /\b(NEVER|not|never|=|Reserved is not sold|apart)\b/i.test(s) || /RESERVED IS NOT SOLD/.test(s)), sold.join(" || "));
}
check("no price, plan name or amount from memory; no table/function/secret text", !/\b\d[\d\s.,]*\s?(xaf|fcfa|usd|eur)\b/i.test(body) && !/(bk_|inv_[a-z]+\(|service_role|token_hash|sk_|api[_-]?key|inventory_count)/i.test(body));
const u = translations.en.inventory.ui, f = translations.fr.inventory.ui;
const labels = [[u.title, f.title], [u.startTracking, f.startTracking], [u.adoptTracking, f.adoptTracking], [u.stopTracking, f.stopTracking], [u.reserved, f.reserved], [u.sold, f.sold], [u.adjust, f.adjust], [u.correct, f.correct],
  [u.kind.sold_elsewhere, f.kind.sold_elsewhere], [u.restockTitle, f.restockTitle], [u.historyTitle, f.historyTitle], [u.state.untracked, f.state.untracked], [u.state.legacy, f.state.legacy]];
check("every UI label the module quotes is read from translations in BOTH languages (it cannot drift)", labels.every(([e, x]) => body.includes(`"${e}"`) && body.includes(`"${x}"`)), labels.filter(([e, x]) => !(body.includes(`"${e}"`) && body.includes(`"${x}"`))).join(";"));

globalThis.__missing = true;
const missing = await renderModuleForLookup(m);
check("before the Phase 4 tables exist the lookup says Inventory is NOT enabled yet", /NOT enabled on this platform yet/.test(missing));
globalThis.__missing = false;
const enabled = await renderModuleForLookup(m);
check("when enabled it says entitlement depends on category and plan, points to Subscription, quotes no price", /enabled on this platform\. A given user can use it only if/.test(enabled) && /Subscription/.test(enabled));
globalThis.__throw = true;
check("a failing availability check degrades to a safe sentence", /could not be checked right now/.test(await renderModuleForLookup(m)));
delete globalThis.__throw; delete globalThis.__missing;
const liveLines = [missing, enabled].flatMap((t) => t.split("\n").filter((l) => l.startsWith("Live availability")));
check("the live text never mentions verification", liveLines.length === 2 && liveLines.every((l) => !/verif|confirm|certif/i.test(l)));
check("additive: the registry changed by one import and one entry; no tool, diagnostic or system-prompt change", (read("src/lib/ai/knowledge/index.ts").match(/inventoryModule/g) || []).length === 2 && !/inventory|stock/i.test(read("src/lib/ai/diagnostics/checks.ts")) && !/bk_stock|inv_adjust/i.test(read("src/lib/ai/prompts/system.ts")));
check("the module reads no user data (its only database touch is the table-exists check)", (read("src/lib/ai/knowledge/modules/inventory.ts").match(/\.from\(/g) || []).length === 1);
try { fs.unlinkSync(stub); } catch {}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
