// Ringo AI knowledge for Business Toolkit Phase 5 (monthly reports and bookkeeping entries): registered in the existing registry, passes the
// validator, states the accounting rules correctly (revenue is not invoice issuance, cash movement is not profit, online sales are gross, receivables
// and inventory are as-of the generation date, a refunded order has no refund date), and never promises anything unavailable.
// Nothing here calls a model or the network.
//   Run:  node scripts/tests/reportsAi.test.mjs
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8").replace(/\r\n/g, "\n");

const stub = path.join(os.tmpdir(), `rep_ai_server_stub_${process.pid}.cjs`);
fs.writeFileSync(stub, "module.exports = { createAdminClient: () => ({ from: () => ({ select: () => ({ limit: async () => { if (globalThis.__throw) throw new Error('x'); return { error: globalThis.__missing ? { message: 'relation does not exist' } : null }; } }) }) }) };");
const jiti = require("jiti")(import.meta.url, { alias: { "@/lib/supabase/server": stub, "@": SRC }, interopDefault: true, cache: false });
const { KNOWLEDGE_MODULES, getKnowledgeModule, renderKnowledgeCatalog, renderModuleForLookup } = jiti(path.join(SRC, "lib/ai/knowledge/index.ts"));
const { validateKnowledgeModules, validateDiagnosticReferences } = jiti(path.join(SRC, "lib/ai/knowledge/validate.ts"));
const { DIAGNOSTIC_CHECKS } = jiti(path.join(SRC, "lib/ai/diagnostics/checks.ts"));
const { translations } = jiti(path.join(SRC, "lib/i18n/translations.ts"));

let pass = 0, fail = 0;
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", name, "|", String(detail).slice(0, 300)); } };
const m = getKnowledgeModule("reports");
const body = m.body;
const has = (re) => re.test(body);

check("registered once, in the catalog, validator clean", !!m && KNOWLEDGE_MODULES.filter((x) => x.id === "reports").length === 1 && /^- reports: /m.test(renderKnowledgeCatalog())
  && validateKnowledgeModules(KNOWLEDGE_MODULES).length === 0 && validateDiagnosticReferences(DIAGNOSTIC_CHECKS, KNOWLEDGE_MODULES).length === 0);
check("related topics exist; loaded on demand; honest 'partial' status until rollout", (m.related || []).every((r) => getKnowledgeModule(r)) && !m.appliesTo.always && !(m.appliesTo.categories || []).length && m.status === "partial");
check("metadata present (who, actions, prerequisites, limitations)", m.whoCanUse && m.actions.length >= 4 && m.prerequisites.length >= 2 && m.limitations.length >= 4);

const topics = [
  ["one calendar month, built on the server from existing records, creates nothing; default last completed month, current month to date; no custom range or CSV", /ONE calendar month[\s\S]*never creates a record[\s\S]*last completed month[\s\S]*month to date[\s\S]*no custom date range and no CSV/],
  ["PDF: EN or FR, on demand, owner only, not stored, no public link, same figures", /PDF[\s\S]*English or French[\s\S]*on demand[\s\S]*not stored and has no public link[\s\S]*same figures/],
  ["revenue = recorded earning; issuing an invoice is NOT revenue; a payment is", /Revenue is what the business RECORDED earning[\s\S]*Issuing an invoice is NOT revenue[\s\S]*when a payment is recorded/],
  ["counts are separate because one invoice can have several payments", /one invoice can have several payments/],
  ["online sales are GROSS; commission and net separate; gross is not money received", /GROSS amount[\s\S]*platform commission[\s\S]*Ringo owes the net until it pays it out[\s\S]*not money already received by the business/],
  ["paid order without usable earnings is left out, reported with its amount, nothing estimated; payout status is shown", /no usable recorded earnings \(missing, reversed, or not matching the order\)[\s\S]*left out of commission and net[\s\S]*nothing is estimated[\s\S]*whether or not Ringo has already paid them out/],
  ["top products: online Shop orders only", /online Shop orders only/],
  ["stock purchases separate from operating expenses", /Stock purchases[\s\S]*listed separately from operating expenses/],
  ["net cash movement formula and exclusions", /Net cash movement = money recorded as received[\s\S]*minus money recorded as paid out[\s\S]*not yet received or not yet paid are excluded/],
  ["online sales are NOT in net cash movement: earnings owed by Ringo until paid out; a recorded payout counts as cash in on its date", /ONLINE SHOP SALES ARE NOT PART OF IT[\s\S]*owes the seller the net earnings until it pays them out[\s\S]*earnings owed, not cash received[\s\S]*records a payout received from Ringo as cash in, it counts on the date entered/],
  ["net cash movement is not profit; profit is not reported; cost of goods not recorded", /NET CASH MOVEMENT IS NOT PROFIT, AND PROFIT IS NOT REPORTED[\s\S]*cost of goods sold[\s\S]*Never call any figure in the report a profit/],
  ["entries: the five kinds, no future date, void instead of edit/delete, invoice payment entries voided with the payment", /record:[\s\S]*cannot be in the future[\s\S]*cannot be edited or deleted[\s\S]*voided with a reason[\s\S]*only together with that payment, from the invoice/],
  ["online sales and invoice payments are never typed in", /never typed in by hand/],
  ["debtors and inventory are AS OF the generation day, not month-end", /AS OF THE DAY THE REPORT IS GENERATED, not month-end balances/],
  ["inventory value informational, not an accounting valuation, profit or cash", /informational only[\s\S]*not an accounting valuation, profit or cash/],
  ["refunded orders: no refund date, never described as a refund in that month", /does not record WHEN a refund happened[\s\S]*never describe it as a refund made in that month/],
  ["reports restate when regenerated", /reflect the records as they stand when generated/],
  ["own currency only, other currencies counted not added, other businesses' sales excluded", /own currency[\s\S]*not added in[\s\S]*Restaurant, music and ticket sales are not part/],
  ["not available list", /NOT AVAILABLE[\s\S]*profit and loss[\s\S]*tax or VAT[\s\S]*custom date range[\s\S]*CSV[\s\S]*sharing a report by link[\s\S]*scheduled or emailed[\s\S]*staff or accountant[\s\S]*month-end balances/],
  ["no tool: never invent a number", /no tool for them[\s\S]*never invent a number/i],
];
for (const [name, re] of topics) check(`covers: ${name}`, has(re));

{
  const sentences = body.split(/(?<=[.!?])\s+|\n+/);
  const profit = sentences.filter((s) => /\bprofit\b/i.test(s));
  const denies = /\b(NOT|not|no|never|Never|cannot)\b/;
  check("every sentence that mentions profit denies it or sets it apart", profit.every((s) => denies.test(s) || /Not profit|not profit/.test(s)), profit.filter((s) => !denies.test(s)).join(" || "));
  const risky = sentences.filter((s) => /\bverif|certif|audited|guarantee|tax advice/i.test(s));
  check("no sentence claims certification, audit, tax compliance or verification", risky.every((s) => /\b(NOT|not|no|never|Never|cannot)\b/.test(s)), risky.join(" || "));
}
check("no price, plan name or amount from memory; no table/function/secret text", !/\b\d[\d\s.,]*\s?(xaf|fcfa|usd|eur)\b/i.test(body) && !/(bk_|doc_[a-z]+\(|inv_[a-z]+\(|service_role|token_hash|sk_|api[_-]?key|commerce_sale_earnings)/i.test(body));
const u = translations.en.reports.ui, f = translations.fr.reports.ui, eb = translations.en.bookkeeping.ui, fb = translations.fr.bookkeeping.ui;
const labels = [[u.title, f.title], [u.tabReport, f.tabReport], [u.tabEntries, f.tabEntries], [u.download, f.download], [eb.kind.sale, fb.kind.sale], [eb.kind.other_income, fb.kind.other_income], [eb.kind.expense, fb.kind.expense], [eb.kind.cash_in, fb.kind.cash_in], [eb.kind.cash_out, fb.kind.cash_out]];
check("every UI label the module quotes is read from translations in BOTH languages (it cannot drift)", labels.every(([e, x]) => body.includes(`"${e}"`) && body.includes(`"${x}"`)), labels.filter(([e, x]) => !(body.includes(`"${e}"`) && body.includes(`"${x}"`))).join(";"));

globalThis.__missing = true;
const missing = await renderModuleForLookup(m);
check("when the platform cannot read the tables the lookup says Reports is NOT enabled yet", /NOT enabled on this platform yet/.test(missing));
globalThis.__missing = false;
const enabled = await renderModuleForLookup(m);
check("when enabled it says entitlement depends on category and plan, points to Subscription, quotes no price", /enabled on this platform\. A given user can use them only if/.test(enabled) && /Subscription/.test(enabled));
globalThis.__throw = true;
check("a failing availability check degrades to a safe sentence", /could not be checked right now/.test(await renderModuleForLookup(m)));
delete globalThis.__throw; delete globalThis.__missing;
const liveLines = [missing, enabled].flatMap((t) => t.split("\n").filter((l) => l.startsWith("Live availability")));
check("the live text never mentions verification or profit", liveLines.length === 2 && liveLines.every((l) => !/verif|confirm|certif|profit/i.test(l)));
check("additive: the registry changed by one import and one entry; no tool, diagnostic or system-prompt change", (read("src/lib/ai/knowledge/index.ts").match(/reportsModule/g) || []).length === 2 && !/reports?\b|bookkeeping/i.test(read("src/lib/ai/diagnostics/checks.ts")) && !/bk_entries|monthly report/i.test(read("src/lib/ai/prompts/system.ts")));
check("the module reads no user data (its only database touch is the table-exists check)", (read("src/lib/ai/knowledge/modules/reports.ts").match(/\.from\(/g) || []).length === 1);
try { fs.unlinkSync(stub); } catch {}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
