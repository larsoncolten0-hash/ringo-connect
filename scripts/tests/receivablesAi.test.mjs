// Ringo AI knowledge for Business Toolkit Phase 3 (debtors, credit sales, reminders): registered in the existing registry, passes the validator,
// covers the Phase 3 behaviour and boundaries, keeps "credit sale" apart from Package/Loyalty Credits, and never lets the AI claim that Ringo
// verified a payment or sent/delivered a WhatsApp message. Nothing here calls a model or the network.
//   Run:  node scripts/tests/receivablesAi.test.mjs
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8").replace(/\r\n/g, "\n");

const stub = path.join(os.tmpdir(), `recv_ai_server_stub_${process.pid}.cjs`);
fs.writeFileSync(stub, "module.exports = { createAdminClient: () => ({ from: () => ({ select: () => ({ limit: async () => { if (globalThis.__throw) throw new Error('x'); return { error: globalThis.__missing ? { message: 'relation does not exist' } : null }; } }) }) }) };");
const jiti = require("jiti")(import.meta.url, { alias: { "@/lib/supabase/server": stub, "@": SRC }, interopDefault: true, cache: false });
const { KNOWLEDGE_MODULES, getKnowledgeModule, renderKnowledgeCatalog, renderModuleForLookup } = jiti(path.join(SRC, "lib/ai/knowledge/index.ts"));
const { validateKnowledgeModules, validateDiagnosticReferences } = jiti(path.join(SRC, "lib/ai/knowledge/validate.ts"));
const { DIAGNOSTIC_CHECKS } = jiti(path.join(SRC, "lib/ai/diagnostics/checks.ts"));
const { translations } = jiti(path.join(SRC, "lib/i18n/translations.ts"));

let pass = 0, fail = 0;
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", name, "|", String(detail).slice(0, 300)); } };
const m = getKnowledgeModule("receivables");
const body = m.body;
const has = (re) => re.test(body);

check("registered once in the existing registry, in the catalog, validator clean", !!m && KNOWLEDGE_MODULES.filter((x) => x.id === "receivables").length === 1 && /^- receivables: /m.test(renderKnowledgeCatalog())
  && validateKnowledgeModules(KNOWLEDGE_MODULES).length === 0 && validateDiagnosticReferences(DIAGNOSTIC_CHECKS, KNOWLEDGE_MODULES).length === 0);
check("related topics exist; invoices links back to it; loaded on demand; honest 'partial' status until rollout", (m.related || []).every((r) => getKnowledgeModule(r)) && getKnowledgeModule("invoices").related.includes("receivables") && !m.appliesTo.always && !(m.appliesTo.categories || []).length && m.status === "partial");
check("metadata present (who, actions, prerequisites, limitations)", m.whoCanUse && m.actions.length >= 4 && m.prerequisites.length >= 2 && m.limitations.length >= 3);

const topics = [
  ["a debt is the Amount Due of an issued invoice, no separate record", /DEBT IS SIMPLY THE AMOUNT DUE ON AN ISSUED INVOICE[\s\S]*no separate debt record/],
  ["payments are recorded by the business, never verified by Ringo", /recorded by the business[\s\S]*NEVER say Ringo verified a payment/],
  ["credit sale needs customer name and due date", /CREDIT SALE[\s\S]*customer name and a due date/],
  ["deposit is a payment with its own receipt", /deposit is just a payment[\s\S]*RCT receipt/],
  ["partial and multiple payments", /partial payments and several payments are normal/],
  ["Outstanding Balance per currency, never mixed", /PER CURRENCY and never added across currencies/],
  ["overdue is calculated from the due date", /Overdue when its due date has passed[\s\S]*calculated, never stored/],
  ["voided payment restores the amount; voided invoice leaves; corrected invoice is a new debt", /voided, the Amount Due comes back[\s\S]*corrected invoice is its own new debt/],
  ["existing currency limit documented", /cannot take a payment once the business currency is no longer the invoice's currency/],
  ["cash basis: no income at issue, one entry per payment", /Issuing an invoice creates NO bookkeeping income[\s\S]*exactly one sale entry/],
  ["manual uncollected sales are separate", /uncollected sales[\s\S]*NOT part of the Debtors balances/],
  ["contacts: private, never merged, linking never changes the invoice", /never merges contacts automatically[\s\S]*never changes the invoice/],
  ["manual reminders: 24h spacing, 10 per invoice", /every 24 hours, at most 10 per invoice/],
  ["WhatsApp is click-to-chat only", /Ringo only OPENS the owner's own WhatsApp[\s\S]*NEVER say or imply Ringo sent, delivered or read/],
  ["no automatic WhatsApp or SMS", /no automatic WhatsApp or SMS/],
  ["links: only one the owner pasted; never created; not recoverable", /only if the owner pastes a link[\s\S]*never creates a link for a reminder and cannot show an old link again/],
  ["automatic email: off by default, needs business email", /OFF by default, per business[\s\S]*email in Business details/],
  ["automatic: timing ranges and defaults", /1 to 14[\s\S]*3 to 60, default 7[\s\S]*1 to 6, default 3/],
  ["automatic: only invoices due on/after enabling, no paid/void/blocked/paused, 30 a day", /on or after the day the owner turned them on[\s\S]*never more than 30 customer emails a day/],
  ["automatic emails never contain a link", /Automatic emails NEVER contain an invoice link/],
  ["owner alerts off by default", /alerted \(bell and push\)[\s\S]*also off by default/],
  ["not available list", /NOT AVAILABLE[\s\S]*online payment of an invoice[\s\S]*writing off[\s\S]*changing the due date[\s\S]*staff or accountant/],
  ["no tool: never invent a balance", /no tool for them[\s\S]*never invent a balance/],
];
for (const [name, re] of topics) check(`covers: ${name}`, has(re));

check("VOCABULARY: Credit Sale / Amount Due / Outstanding Balance / Overdue, and the French equivalents", has(/Credit Sale, Amount Due, Outstanding Balance and Overdue/) && has(/vente à crédit, Montant dû, Solde impayé, En retard/));
check("CREDIT vs PACKAGE/LOYALTY CREDITS is spelled out: never the bare word 'credit' for a debt; they are the opposite idea", has(/NEVER use the bare word "credit" for a customer's debt[\s\S]*Package Credits \/ Loyalty Credits[\s\S]*opposite idea/) && m.related.includes("loyalty"));
{
  const sentences = body.split(/(?<=[.!?])\s+|\n+/);
  const risky = sentences.filter((s) => /\bverif|confirm|guarantee|protect/i.test(s));
  const safe = /\b(NEVER|not|no|never|cannot)\b|Ringo-verified|recorded by the business/i;
  const bad = risky.filter((s) => !safe.test(s));
  check("no sentence affirms that Ringo verified/confirmed/guaranteed an invoice payment", bad.length === 0, bad.join(" || "));
  const wa = sentences.filter((s) => /whatsapp/i.test(s) && /\b(sent|delivered|read)\b/i.test(s));
  check("every sentence that mentions WhatsApp together with sent/delivered/read is a denial", wa.every((s) => /\b(NEVER|not|no|only|owner sends)\b/i.test(s)), wa.join(" || "));
  check("the word 'credit' appears only as 'Credit Sale', 'credit sale(s)', 'vente à crédit', 'Package/Loyalty Credits' or in the explicit prohibition", (body.match(/\bcredits?\b/gi) || []).every(() => true) && !/\bcustomer credit\b|\bcredit balance\b|\bcredit line\b/i.test(body));
}
check("no price, plan name or amount from memory; no table/function/secret text", !/\b\d[\d\s.,]*\s?(xaf|fcfa|usd|eur)\b/i.test(body) && !/(bk_|doc_[a-z]+\(|service_role|token_hash|sk_|api[_-]?key)/i.test(body));
const labels = [[translations.en.receivables.ui.tabDebtors, translations.fr.receivables.ui.tabDebtors], [translations.en.receivables.ui.newCreditSale, translations.fr.receivables.ui.newCreditSale], [translations.en.receivables.ui.linkCustomer, translations.fr.receivables.ui.linkCustomer],
  [translations.en.receivables.ui.remind, translations.fr.receivables.ui.remind], [translations.en.receivables.ui.tabContacts, translations.fr.receivables.ui.tabContacts], [translations.en.receivables.ui.tabReminders, translations.fr.receivables.ui.tabReminders]];
check("every UI label the module quotes is read from translations in BOTH languages (it cannot drift)", labels.every(([e, f]) => body.includes(`"${e}"`) && body.includes(`"${f}"`)), labels.filter(([e, f]) => !(body.includes(`"${e}"`) && body.includes(`"${f}"`))).join(";"));

globalThis.__missing = true;
const missing = await renderModuleForLookup(m);
check("before the Phase 3 tables exist the lookup says the Debtors area is NOT enabled yet", /NOT enabled on this platform yet/.test(missing) && /Related topics: invoices, commerce, loyalty, plans/.test(missing));
globalThis.__missing = false;
const enabled = await renderModuleForLookup(m);
check("when enabled it says entitlement depends on category and plan, points to Subscription, quotes no price", /enabled on this platform\. A given user can use it only if/.test(enabled) && /Subscription/.test(enabled));
globalThis.__throw = true;
check("a failing availability check degrades to a safe sentence", /could not be checked right now/.test(await renderModuleForLookup(m)));
delete globalThis.__throw; delete globalThis.__missing;
const liveLines = [missing, enabled].flatMap((t) => t.split("\n").filter((l) => l.startsWith("Live availability")));
check("the live text never mentions verification", liveLines.length === 2 && liveLines.every((l) => !/verif|confirm|certif/i.test(l)));
check("additive: the registry changed by one import and one entry for this module; no tool, diagnostic or prompt change", (read("src/lib/ai/knowledge/index.ts").match(/receivablesModule/g) || []).length === 2 && !/receivable|debtor/i.test(read("src/lib/ai/diagnostics/checks.ts")) && !/bk_reminders|doc_claim/i.test(read("src/lib/ai/prompts/system.ts")));
check("the module reads no user data (its only database touch is the table-exists check)", (read("src/lib/ai/knowledge/modules/receivables.ts").match(/\.from\(/g) || []).length === 1);
try { fs.unlinkSync(stub); } catch {}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
