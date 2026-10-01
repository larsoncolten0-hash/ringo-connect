// Ringo AI knowledge for Business Toolkit Phase 2 (invoices, RCT receipts, RCP Shop receipt PDFs, share links): the module is registered
// in the existing registry, follows its conventions, represents every Phase 2 boundary, and NEVER describes a seller-recorded invoice
// payment as verified by Ringo. Nothing here calls a model or the network.
//   Run:  node scripts/tests/documentsAi.test.mjs
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8").replace(/\r\n/g, "\n");

// the module's live() reads the database: stub the server client so both the "enabled" and "not enabled yet" answers are exercised
const stub = path.join(os.tmpdir(), `docs_ai_server_stub_${process.pid}.cjs`);
fs.writeFileSync(stub, "module.exports = { createAdminClient: () => ({ from: () => ({ select: () => ({ limit: async () => { if (globalThis.__throw) throw new Error('x'); return { error: globalThis.__tableMissing ? { message: 'relation does not exist' } : null }; } }) }) }) };");
const jiti = require("jiti")(import.meta.url, { alias: { "@/lib/supabase/server": stub, "@": SRC }, interopDefault: true, cache: false });
const { KNOWLEDGE_MODULES, getKnowledgeModule, renderKnowledgeCatalog, renderModuleForLookup, KNOWLEDGE_TOPIC_IDS } = jiti(path.join(SRC, "lib/ai/knowledge/index.ts"));
const { validateKnowledgeModules, validateDiagnosticReferences } = jiti(path.join(SRC, "lib/ai/knowledge/validate.ts"));
const { DIAGNOSTIC_CHECKS } = jiti(path.join(SRC, "lib/ai/diagnostics/checks.ts"));
const { renderNavigationMap } = jiti(path.join(SRC, "lib/ai/knowledge/navigation.ts"));
const { translations } = jiti(path.join(SRC, "lib/i18n/translations.ts"));

let pass = 0, fail = 0;
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", name, "|", String(detail).slice(0, 300)); } };

const m = getKnowledgeModule("invoices");
check("the Phase 2 module is registered in the existing registry (KNOWLEDGE_MODULES) and is findable by id", !!m && KNOWLEDGE_MODULES.includes(m) && KNOWLEDGE_TOPIC_IDS.includes("invoices"));
check("it shows up in the catalog the model reads to know what it can look up", /^- invoices: /m.test(renderKnowledgeCatalog()));
check("the registry passes the existing validator (unique ids, valid status, related ids exist, no secret-shaped text)", validateKnowledgeModules(KNOWLEDGE_MODULES).length === 0 && validateDiagnosticReferences(DIAGNOSTIC_CHECKS, KNOWLEDGE_MODULES).length === 0, JSON.stringify(validateKnowledgeModules(KNOWLEDGE_MODULES)));
check("registered once; related topics all exist; existing modules were not removed or reordered ahead of it", KNOWLEDGE_MODULES.filter((x) => x.id === "invoices").length === 1 && (m.related || []).every((r) => getKnowledgeModule(r)) && KNOWLEDGE_MODULES.length === 32 && KNOWLEDGE_MODULES.findIndex((x) => x.id === "commerce") < KNOWLEDGE_MODULES.findIndex((x) => x.id === "invoices"));
check("it has the registry's metadata (version, whoCanUse, actions, prerequisites, limitations) and an honest status", m.version >= 1 && m.whoCanUse && m.actions.length >= 5 && m.prerequisites.length >= 2 && m.limitations.length >= 3 && m.status === "partial");
check("it is loaded on demand like commerce, not stuffed into every prompt (not 'always', no category auto-load)", !m.appliesTo.always && !(m.appliesTo.categories || []).length);

const body = m.body;
const lower = body.toLowerCase();
const has = (re) => re.test(body);

// ---- the Phase 2 topics the brief lists
const topics = [
  ["invoice creation", /create.*invoice|invoices for their own customers/i],
  ["draft vs issued", /DRAFT[\s\S]*ISSUED/],
  ["numbering (INV-, sequential, never reused, drafts use no numbers)", /INV-YYYY-NNNN[\s\S]*never reused/i],
  ["immutability once issued", /can NEVER be edited/],
  ["seller-recorded payments", /SELLER-RECORDED PAYMENTS/],
  ["RCT receipts", /RCT-YYYY-NNNN/],
  ["existing RCP platform receipts", /RCP-/],
  ["Ringo-verified commerce payments vs seller-recorded invoice payments", /Ringo-verified commerce payments[\s\S]*Seller-recorded invoice payments/],
  ["invoice balance", /balance is always total minus/i],
  ["partial payments", /Partial payments are allowed/],
  ["voiding", /VOIDING/],
  ["voiding a payment first (payment, receipt and ledger entry together)", /void each payment[\s\S]*bookkeeping sale entry together/i],
  ["corrected invoices", /CORRECTED INVOICES[\s\S]*NEW number/],
  ["PDF downloads", /PDF DOWNLOADS/],
  ["secure share links", /SECURE SHARE LINKS/],
  ["share link shown once / only a fingerprint stored", /shown ONCE[\s\S]*one-way fingerprint/],
  ["share link expiry, max 5 active, revocation", /1 to 90 days[\s\S]*5 active links[\s\S]*revoke/],
  ["uniform unavailable page", /same "not available" page/],
  ["tax optional / off by default", /OPTIONAL and OFF by default/],
  ["no tax-certification claim", /NOT tax-certified/],
  ["no online invoice payment in Phase 2", /cannot pay an invoice through Ringo/],
  ["no automatic WhatsApp/SMS", /automatic WhatsApp, SMS or email sending/i],
  ["debt boundary (a debt is the invoice Amount Due; Debtors live in the receivables topic)", /DEBT BOUNDARY[\s\S]*no separate debt record[\s\S]*receivables/],
  ["quotations are out of scope", /quotations/i],
  ["staff/accountant access out of scope", /staff or accountant access/i],
];
for (const [name, re] of topics) check(`covers: ${name}`, has(re));

// ---- the platform Shop receipt PDF is described as exactly what it is
check("Shop receipt PDF: just a PDF of the existing RCP receipt, keeps the number, not an invoice, no new record, no Business Toolkit needed", /PDF of the existing RCP receipt/.test(body) && /keeps the RCP number/.test(body) && /is not an invoice/.test(body) && /creates no new record/.test(body) && /does not need the Business Toolkit/.test(body));
check("an unpaid Shop order has no PDF", /An unpaid order has no PDF/.test(body));
check("it never presents the RCP receipt as an invoice or relabels it RCT-", !/RCP[^.]*\b(is|as) an? (invoice|RCT)/i.test(body) && /an RCP receipt is not an invoice, an RCT receipt is not a Shop receipt/.test(body));

// ---- the critical rule: a seller-recorded invoice payment is NEVER described as verified by Ringo
check("explicit rule present: recorded by the business, Ringo did not verify, confirm, receive or hold it", /"recorded by the business"/.test(body) && /Ringo did NOT verify it, confirm it, receive it, or hold the money/.test(body));
check("explicit prohibition present (NEVER say Ringo verified / confirmed / guaranteed / protected an invoice payment)", /NEVER say, imply or agree that Ringo verified, confirmed, guaranteed or protected a seller-recorded invoice payment/.test(body));
check("it tells the model what to answer to 'has Ringo verified this payment?' (no)", /the answer is no: it is recorded by the business and Ringo has not verified it/.test(body));
{
  // every sentence that mentions verify/confirm/guarantee/protect must be a denial, or about the genuine Shop checkout
  const sentences = body.split(/(?<=[.!?])\s+|\n+/);
  const risky = sentences.filter((s) => /\bverif|confirm|guarantee|protect|certif/i.test(s));
  const safeContext = /\b(NEVER|not|no|never|cannot|did NOT|has not|nor)\b|Ringo-verified commerce|Ringo's server confirms it with the payment provider|(?:Business Toolkit|invoices) .*tax-certified|"compliant", "certified"|Ringo-verified|Seller-recorded|tamper-evident/i;
  const bad = risky.filter((s) => !safeContext.test(s));
  check("no sentence anywhere in the module affirms that an invoice payment (or document) is verified/confirmed/certified by Ringo", bad.length === 0, bad.join(" || "));
  check("the only 'Ringo confirms' statement is about the real Shop checkout (provider-confirmed), not invoices", risky.filter((s) => /confirms it with the payment provider/.test(s)).every((s) => /Shop product|Ringo's own checkout/.test(s)));
  check("the words 'verified by Ringo' only ever appear inside a denial", [...body.matchAll(/[^.]*verified by Ringo[^.]*\./gi)].every((x) => /NEVER|not|no/i.test(x[0])));
}

// ---- no unsafe claims
check("no claim of tax compliance/certification/legal validity", !/(tax[- ]compliant|legally valid|certified invoice|official invoice|approved by (the )?(dgi|tax))/i.test(body.replace(/never tell a user an invoice is "compliant", "certified" or "official for the tax authority"/i, "")));
check("it does not promise online payment, auto-sending, delivery or read receipts", !/customers? can pay (the |an )?invoice (online|through ringo|with)/i.test(body) && /Do not promise delivery, read receipts or reminders/.test(body));
check("it does not state any price, plan name or percentage from memory", !/\b\d[\d\s.,]*\s?(xaf|fcfa|usd|eur|%)/i.test(body.replace(/YYYY|NNNN/g, "")) && /never state a price/i.test((await (async () => { globalThis.__tableMissing = false; return renderModuleForLookup(m); })())));
check("no secret-shaped or internal text (no table names, function names, keys)", !/(bk_|doc_[a-z]+\(|service_role|token_hash|sk_|api[_-]?key)/i.test(body));
check("the module is English model-facing prose like its siblings, but quotes both-language UI labels", has(/"Invoices" \/ "Factures"/) && has(/"Record payment"|"Enregistrer/) || /"Invoices" \/ "Factures"/.test(body));

// ---- EN / FR coverage: the labels the module quotes are read from translations, so they can never drift
const labelsInBody = [
  [translations.en.nav.documents, translations.fr.nav.documents],
  [translations.en.documents.ui.recordPayment, translations.fr.documents.ui.recordPayment],
  [translations.en.documents.ui.issue, translations.fr.documents.ui.issue],
  [translations.en.documents.ui.correct, translations.fr.documents.ui.correct],
  [translations.en.documents.ui.downloadPdf, translations.fr.documents.ui.downloadPdf],
  [translations.en.documents.ui.share.button, translations.fr.documents.ui.share.button],
  [translations.en.shopReceipt.downloadPdf, translations.fr.shopReceipt.downloadPdf],
  [translations.en.shopOrders.downloadReceiptPdf, translations.fr.shopOrders.downloadReceiptPdf],
  [translations.en.documents.ui.tabBusiness, translations.fr.documents.ui.tabBusiness],
];
check("every quoted UI label is present in BOTH languages, exactly as the app shows it", labelsInBody.every(([e, f]) => e && f && body.includes(`"${e}"`) && body.includes(`"${f}"`)), labelsInBody.filter(([e, f]) => !(body.includes(`"${e}"`) && body.includes(`"${f}"`))).join(";"));
check("the quoted French labels are genuinely French (differ from English where the app differs)", labelsInBody.filter(([e, f]) => e !== f).length >= 7);
const nav = renderNavigationMap();
check("the navigation map (existing registry) lists the Invoices screen with both-language labels and its path", /\/dashboard\/documents/.test(nav) && nav.includes(translations.en.nav.documents) && nav.includes(translations.fr.nav.documents), nav.split("\n").filter((l) => /documents/.test(l)).join("|"));
check("the navigation entry is scoped to entitled owners (so the AI does not send everyone there)", /Business & E-commerce owners whose plan includes the Business Toolkit/.test(nav));

// ---- live availability: a deploy ahead of the migration must not make the AI promise the feature
globalThis.__tableMissing = true;
const missing = await renderModuleForLookup(m);
check("when the Phase 2 tables are not enabled yet, the lookup says the feature is NOT available yet", /NOT enabled on this platform yet/.test(missing) && /Related topics: commerce, payments, plans, receivables/.test(missing));
globalThis.__tableMissing = false;
const enabled = await renderModuleForLookup(m);
check("when enabled, the lookup says entitlement depends on the profile category and plan, and points to Subscription without quoting a price", /enabled on this platform\. A given user can use it only if/.test(enabled) && /Subscription/.test(enabled));
{
  const liveLines = [missing, enabled].flatMap((t) => t.split(String.fromCharCode(10)).filter((l) => l.startsWith("Live availability")));
  check("the live availability text exists for both outcomes and never mentions verification or confirmation", liveLines.length === 2 && liveLines.every((l) => !/verif|confirm|certif/i.test(l)), liveLines.join(" | "));
}
globalThis.__throw = true;
const broke = await renderModuleForLookup(m);
check("a failing availability check degrades to a safe sentence, never throws", /could not be checked right now/.test(broke));
delete globalThis.__throw; delete globalThis.__tableMissing;

// ---- additive: nothing else in Ringo AI was redesigned
const idx = read("src/lib/ai/knowledge/index.ts");
check("the registry file changed only by one import and one list entry", (idx.match(/documentsModule/g) || []).length === 2);
check("no diagnostic, tool or system prompt was added or changed for Phase 2 (knowledge module only)", !/invoices|documents/i.test(read("src/lib/ai/diagnostics/checks.ts")) && !/bk_documents|doc_issue/i.test(read("src/lib/ai/prompts/system.ts")));
check("the module reads no user data (no user-scoped query: its only database touch is the table-exists check)", (read("src/lib/ai/knowledge/modules/documents.ts").match(/\.from\(/g) || []).length === 1);
try { fs.unlinkSync(stub); } catch {}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
