// Ringo AI knowledge for Business Toolkit Phase 6 (Customers): registered in the existing registry, passes the validator, keeps the business's own customer
// book apart from Ringo accounts, calls customer-level payment totals "Payments received" (never revenue), describes possible Shop orders as unverified
// suggestions, and never promises anything unavailable. Nothing here calls a model or the network.
//   Run:  node scripts/tests/customersAi.test.mjs
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8").replace(/\r\n/g, "\n");

const stub = path.join(os.tmpdir(), `cust_ai_server_stub_${process.pid}.cjs`);
fs.writeFileSync(stub, "module.exports = { createAdminClient: () => ({ from: () => ({ select: () => ({ limit: async () => { if (globalThis.__throw) throw new Error('x'); return { error: globalThis.__missing ? { message: 'relation does not exist' } : null }; } }) }) }) };");
const jiti = require("jiti")(import.meta.url, { alias: { "@/lib/supabase/server": stub, "@": SRC }, interopDefault: true, cache: false });
const { KNOWLEDGE_MODULES, getKnowledgeModule, renderKnowledgeCatalog, renderModuleForLookup } = jiti(path.join(SRC, "lib/ai/knowledge/index.ts"));
const { validateKnowledgeModules, validateDiagnosticReferences } = jiti(path.join(SRC, "lib/ai/knowledge/validate.ts"));
const { DIAGNOSTIC_CHECKS } = jiti(path.join(SRC, "lib/ai/diagnostics/checks.ts"));
const { translations } = jiti(path.join(SRC, "lib/i18n/translations.ts"));

let pass = 0, fail = 0;
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", name, "|", String(detail).slice(0, 300)); } };
const m = getKnowledgeModule("customers");
const body = m.body;
const has = (re) => re.test(body);

check("registered once, in the catalog, validator clean", !!m && KNOWLEDGE_MODULES.filter((x) => x.id === "customers").length === 1 && /^- customers: /m.test(renderKnowledgeCatalog())
  && validateKnowledgeModules(KNOWLEDGE_MODULES).length === 0 && validateDiagnosticReferences(DIAGNOSTIC_CHECKS, KNOWLEDGE_MODULES).length === 0);
check("related topics exist; loaded on demand; honest 'partial' status until rollout", (m.related || []).every((r) => getKnowledgeModule(r)) && !m.appliesTo.always && !(m.appliesTo.categories || []).length && m.status === "partial");
check("metadata present (who, actions, prerequisites, limitations)", m.whoCanUse && m.actions.length >= 4 && m.prerequisites.length >= 2 && m.limitations.length >= 4);

const topics = [
  ["the business's OWN customer book, same book as Debtors contacts, not a Ringo account; never reveals whether a phone/email has a Ringo account", /business's OWN customer book[\s\S]*same book as the contacts under Invoices, Debtors[\s\S]*NOT a Ringo account[\s\S]*never shows whether a phone number or email has a Ringo account/],
  ["directory: search by name, phone or email, 2 characters, active/archived/all, add, duplicates reported never merged, archive never delete", /Search by name, phone or email \(at least 2 characters\)[\s\S]*already used by an active customer is reported[\s\S]*never merged and never duplicated[\s\S]*archived and restored but never deleted/],
  ["profile contents and per-currency, never added across currencies", /PROFILE[\s\S]*contact details and notes[\s\S]*invoices linked[\s\S]*Outstanding balance[\s\S]*Overdue[\s\S]*timeline[\s\S]*per currency, never added across currencies/],
  ["Payments received is not revenue and creates no bookkeeping entry", /means the payments the business recorded on that customer's invoices\. It is NOT revenue and creates no bookkeeping entry/],
  ["an invoice only joins a customer when the owner links it", /only joins a customer when the owner links it/],
  ["statement limits: 200 invoices, 500 payments, 100 timeline items", /latest 200 invoices and 500 payments[\s\S]*older records are not in the figures[\s\S]*latest 100 activities/],
  ["possible matching orders: suggestions, not verified, phone sharing, never attached/saved/counted, never names", /SUGGESTIONS, "not verified to be the same person"[\s\S]*phone numbers are often shared[\s\S]*never attached to a customer, never saved as a link, and never counted in the customer's totals, the reports or any balance; matching never uses names/],
  ["no phone/email means nothing to match", /no phone or email there is nothing to match/],
  ["1,000 recent orders for phone, all orders for email, ambiguity flagged", /1,000 most recent orders[\s\S]*email matching covers all orders[\s\S]*Ambiguous matches are flagged/],
  ["not available list", /NOT AVAILABLE[\s\S]*Ringo accounts[\s\S]*loyalty[\s\S]*community subscribers or marketing consent[\s\S]*sending messages[\s\S]*exporting customers[\s\S]*segments[\s\S]*confirming an order[\s\S]*restaurant, music, booking or ticket[\s\S]*erasing personal data[\s\S]*staff or accountant/],
  ["no tool: never invent a customer or figure", /no tool for them[\s\S]*never invent a customer or a figure/],
];
for (const [name, re] of topics) check(`covers: ${name}`, has(re));

{
  const sentences = body.split(/(?<=[.!?])\s+|\n+/);
  const rev = sentences.filter((s) => /\brevenue\b/i.test(s));
  check("every sentence that mentions revenue denies that payments received are revenue", rev.length > 0 && rev.every((s) => /\bNOT\b|\bnot\b|\bno\b/.test(s)), rev.join(" || "));
  const acct = sentences.filter((s) => /ringo account/i.test(s));
  check("every sentence that mentions a Ringo account denies any link or reveal", acct.length > 0 && acct.every((s) => /\b(NOT|not|never|Never|nothing|linking or merging)\b/.test(s)), acct.filter((s) => !/\b(NOT|not|never|Never|nothing|linking or merging)\b/.test(s)).join(" || "));
  const risky = sentences.filter((s) => /\bverified\b/i.test(s));
  check("'verified' only appears in the 'not verified' disclaimers", risky.every((s) => /not verified|NOT verified/i.test(s)), risky.join(" || "));
}
check("no price, plan name or amount from memory; no table/function/secret text", !/\b\d[\d\s.,]*\s?(xaf|fcfa|usd|eur)\b/i.test(body) && !/(bk_|doc_[a-z]+\(|service_role|token_hash|sk_|api[_-]?key|ringo_customers|customer_connections|customer_sessions)/i.test(body));
const u = translations.en.customers, f = translations.fr.customers;
const labels = [[u.ui.title, f.ui.title], [u.ui.add, f.ui.add], [u.ui.statusActive, f.ui.statusActive], [u.ui.statusArchived, f.ui.statusArchived], [u.ui.statusAll, f.ui.statusAll], [u.profile.paymentsReceived, f.profile.paymentsReceived], [u.match.show, f.match.show]];
check("every UI label the module quotes is read from translations in BOTH languages (it cannot drift)", labels.every(([e, x]) => body.includes(`"${e}"`) && body.includes(`"${x}"`)), labels.filter(([e, x]) => !(body.includes(`"${e}"`) && body.includes(`"${x}"`))).join(";"));

globalThis.__missing = true;
const missing = await renderModuleForLookup(m);
check("when the Phase 3 contact table is not readable the lookup says Customers is NOT enabled yet", /NOT enabled on this platform yet/.test(missing));
globalThis.__missing = false;
const enabled = await renderModuleForLookup(m);
check("when enabled it says entitlement depends on category and plan, points to Subscription, quotes no price", /enabled on this platform\. A given user can use it only if/.test(enabled) && /Subscription/.test(enabled));
globalThis.__throw = true;
check("a failing availability check degrades to a safe sentence", /could not be checked right now/.test(await renderModuleForLookup(m)));
delete globalThis.__throw; delete globalThis.__missing;
const liveLines = [missing, enabled].flatMap((t) => t.split("\n").filter((l) => l.startsWith("Live availability")));
check("the live text never mentions verification or Ringo accounts", liveLines.length === 2 && liveLines.every((l) => !/verif|ringo account|revenue/i.test(l)));
check("additive: the registry changed by one import and one entry; no tool, diagnostic or system-prompt change", (read("src/lib/ai/knowledge/index.ts").match(/customersModule/g) || []).length === 2 && !/customers module|bk_customers/i.test(read("src/lib/ai/diagnostics/checks.ts")) && !/bk_customers|possible matching orders/i.test(read("src/lib/ai/prompts/system.ts")));
check("the module reads no user data (its only database touch is the table-exists check)", (read("src/lib/ai/knowledge/modules/customers.ts").match(/\.from\(/g) || []).length === 1);
try { fs.unlinkSync(stub); } catch {}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
