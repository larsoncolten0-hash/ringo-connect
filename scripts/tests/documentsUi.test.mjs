// Business Toolkit Phase 2 — the invoice dashboard (src/components/documents, src/app/dashboard/documents, nav wiring). There is no
// browser or DOM here, so this proves what can be proven without one: every string is translated in both languages, nothing is
// hardcoded, the wording never claims verification, no unbuilt action (sharing) is offered, the UI cannot write to the database, the
// action rules and helpers are exact, and the REAL nav-visibility and page-guard functions behave correctly against stubbed dependencies.
// What this does NOT prove: how the screens look or behave in a browser (not exercised).
//   Run:  node scripts/tests/documentsUi.test.mjs
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8").replace(/\r\n/g, "\n");
const strip = (s) => s.replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
const walk = (dir) => fs.readdirSync(path.join(REPO, dir), { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(`${dir}/${d.name}`) : [`${dir}/${d.name}`]));

const tmp = (name, body) => { const p = path.join(os.tmpdir(), `${name}_${process.pid}.cjs`); fs.writeFileSync(p, body); return p; };
const stubs = [
  tmp("ui_access", "module.exports = { resolveBookkeepingOwner: async () => globalThis.__uiOwner };"),
  tmp("ui_server", "module.exports = { createAdminClient: () => globalThis.__uiAdmin, createClient: () => { throw new Error('not stubbed'); } };"),
  tmp("ui_nav", "module.exports = { redirect: (u) => { throw new Error('REDIRECT:' + u); }, notFound: () => { throw new Error('NOTFOUND'); } };"),
];
const jiti = require("jiti")(import.meta.url, { alias: { "@/lib/bookkeeping/access": stubs[0], "@/lib/supabase/server": stubs[1], "next/navigation": stubs[2], "@": SRC }, interopDefault: true, cache: false });
const { translations } = jiti(path.join(SRC, "lib/i18n/translations.ts"));
const A = jiti(path.join(SRC, "lib/documents/actions.ts"));
const UE = jiti(path.join(SRC, "lib/documents/uiErrors.ts"));
const VAL = jiti(path.join(SRC, "lib/documents/validation.ts"));
const ACCESS = jiti(path.join(SRC, "lib/documents/access.ts"));

let pass = 0, fail = 0;
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", name, "|", String(detail).slice(0, 300)); } };
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

const COMPONENT_FILES = walk("src/components/documents").filter((f) => f.endsWith(".tsx"));
const PAGE_FILES = walk("src/app/dashboard/documents").filter((f) => f.endsWith(".tsx"));
const UI_FILES = [...COMPONENT_FILES, ...PAGE_FILES];
const code = Object.fromEntries(UI_FILES.map((f) => [f, strip(read(f))]));

// ======================================================================= translations: both languages, every key, no hardcoded text
{
  const keys = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? keys(v, `${p}${k}.`) : [`${p}${k}`])).sort();
  const en = translations.en.documents.ui, fr = translations.fr.documents.ui;
  eq("documents.ui has identical keys in English and French", keys(fr), keys(en));
  check("no empty strings in either language", [en, fr].every((o) => JSON.stringify(o, (k, v) => (typeof v === "function" ? "fn" : v)).indexOf('""') < 0));
  const flat = (o) => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? flat(v) : typeof v === "string" ? [[k, v]] : []));
  const frFlat = new Map(flat(fr).map(([k, v], i) => [i, [k, v]]));
  const same = flat(en).filter(([, v], i) => v === flat(fr)[i][1]).map(([k]) => k);
  check("French is really translated (only a handful of strings are identical to English)", same.length <= 6, same.join(","));
  eq("nav entry exists in both languages", [translations.en.nav.documents, translations.fr.nav.documents], ["Invoices", "Factures"]);
  const used = new Set();
  for (const [f, s] of Object.entries(code)) {
    if (/const u = t\.documents\.ui/.test(s) || /t\.documents\.ui/.test(s)) {
      for (const m of s.matchAll(/\bu\.([A-Za-z]+)(?:\.([A-Za-z]+))?/g)) {
        if (m[1] === "errors" && m[2]) used.add(`errors.${m[2]}`); else used.add(m[1]);
      }
      for (const m of s.matchAll(/t\.documents\.ui\.([A-Za-z]+)(?:\.([A-Za-z]+))?/g)) used.add(m[2] && m[1] === "errors" ? `errors.${m[2]}` : m[1]);
    }
  }
  for (const m of code["src/components/documents/InvoicesList.tsx"].matchAll(/label: "(\w+)"/g)) used.add(m[1]);
  const defined = new Set([...keys(en).map((k) => k.replace(/^events\..*/, "events")), "errors", "events", "share"]);
  const missing = [...used].filter((k) => !defined.has(k) && !k.startsWith("events"));
  check(`every translation key the UI uses exists in both languages (${used.size} keys checked)`, missing.length === 0, missing.join(","));
  const pdfUsed = new Set(Object.values(code).flatMap((s) => [...s.matchAll(/t\.documents\.pdf\.([A-Za-z]+)/g)].map((m) => m[1])));
  check("every PDF label the UI reuses exists", [...pdfUsed].every((k) => k in translations.en.documents.pdf && k in translations.fr.documents.pdf), [...pdfUsed].join(","));
  const err = ["generic", "network", "unavailable", "notAllowed", "notFound", "validation", "invalidAmount", "tooPrecise", "invalidDate", "exceedsBalance", "notPayable", "currencyChanged", "noLines", "customerRequired", "zeroTotal", "invalidDueDate", "taxNotConfigured", "hasPayments", "reasonRequired", "notDraft", "integrity"];
  check("every error key the code can map to has a message in both languages", err.every((k) => en.errors[k] && fr.errors[k]) && [...new Set(Object.values(JSON.parse(JSON.stringify(Object.fromEntries(["documents_unavailable", "not_owner", "exceeds_balance", "invoice_not_payable", "currency_changed", "no_lines", "customer_required", "zero_total", "invalid_due_date", "tax_not_configured", "invoice_has_payments", "reason_required", "document_not_draft", "integrity_check_failed", "invalid_amount", "amount_too_precise", "invalid_paid_on", "validation_failed", "document_not_found"].map((c) => [c, UE.errorKey(c)]))))))].every((k) => en.errors[k] && fr.errors[k]));

  // nothing hardcoded: JSX text nodes and string attributes must go through t.*
  const offenders = [];
  for (const [f, s] of Object.entries(code)) {
    const noExpr = s.replace(/\{[^{}]*\}/g, "{}").replace(/\{[^{}]*\}/g, "{}").replace(/\{[^{}]*\}/g, "{}");
    // text that sits between a real JSX tag (<div ...>) and the next tag: that is what a person reads
    // (a tag never directly follows an identifier, ")" or "]": that would be a TypeScript generic such as useState<View | null>)
    for (const m of noExpr.matchAll(/(?<![\w\])])<[A-Za-z][A-Za-z0-9.]*(?:\s[^<>]*)?>([^<>{}]+)</g)) {
      const text = m[1].trim();
      if (/[A-Za-zÀ-ÿ]{3,}/.test(text)) offenders.push(`${path.basename(f)}: ${text.slice(0, 40)}`);
    }
    for (const m of s.matchAll(/\b(placeholder|aria-label|title|alt)="([^"{}]*[A-Za-z]{3,}[^"{}]*)"/g)) offenders.push(`${path.basename(f)}: ${m[1]}="${m[2]}"`);
  }
  check("NO hardcoded user-facing text in any component or page (all text goes through translations)", offenders.length === 0, offenders.slice(0, 6).join(" | "));
  check("every component uses the shared language hook, not its own text", COMPONENT_FILES.filter((f) => !/shared\.tsx$/.test(f)).every((f) => /useLanguage/.test(code[f]) || /DocumentsTabs|DocModals/.test(f) === false));
}

// ======================================================================= wording: payments are recorded by the business, never "verified"
{
  const flatten = (o) => JSON.stringify(o, (k, v) => (typeof v === "function" ? v("x", "y", "z") : v));
  for (const lang of ["en", "fr"]) {
    const s = flatten(translations[lang].documents.ui).toLowerCase();
    // the tax hint DENIES certification ("not tax-certified"): that phrase is allowed; any other claim is not
    const withoutDenial = s.replace(/not tax-certified|pas certifiés fiscalement/g, "");
    // (the verb "vérifiez votre connexion" = "check your connection" is not a claim about a payment, so the pattern targets "verified" claims)
    const claim = /\bverified\b|vérifié|vérifiée|certif|ringo confirm|confirmé par ringo|confirmed by ringo/i;
    check(`${lang}: the invoice UI vocabulary never says a payment is verified/confirmed/certified (the only certification wording is the denial in the tax hint)`, !claim.test(withoutDenial), withoutDenial.match(/.{20}(verified|vérifié|certif).{20}/i)?.[0]);
  }
  check("English says it is recorded by the business; French says it is recorded by the enterprise", /recorded by the business/i.test(translations.en.documents.ui.recordedByBusiness) && /enregistré par l'entreprise/i.test(translations.fr.documents.ui.recordedByBusiness));
  check("the payment dialog explains it is a business-recorded payment", /recorded by the business/i.test(translations.en.documents.ui.paymentIntro) && /enregistré par l'entreprise/i.test(translations.fr.documents.ui.paymentIntro));
  check("the tax hint says generated documents are not tax-certified (no compliance claim) in both languages", /not tax-certified/i.test(translations.en.documents.ui.taxHint) && /pas certifiés fiscalement/i.test(translations.fr.documents.ui.taxHint));
  check("the components never use the words verified / certified", Object.values(code).every((s) => !/verified|certified|vérifi/i.test(s)));
  check("the receipt screen states the payment was recorded by the business", /recordedByBusiness/.test(code["src/components/documents/DocumentView.tsx"]));
  check("no payment shows a 'verified' field: payment rows carry no such property", !/\.verified\b/.test(code["src/components/documents/DocumentView.tsx"]));
}

// ======================================================================= scope: nothing unbuilt is offered; the UI cannot write to the database
{
  check("the UI never builds a public link or touches a token itself: links come only from the owner API (/api/documents/**/shares)", Object.values(code).every((s) => !/[`"']\/d\/|doc_create_share|doc_resolve_share|token_hash|createHash|randomBytes/.test(s)));
  check("no quotation anywhere in the UI", Object.values(code).every((s) => !/quotation|devis/i.test(s)));
  check("the UI never writes to the database directly (no insert/update/delete/upsert/rpc)", Object.values(code).every((s) => !/\.(insert|update|delete|upsert|rpc)\s*\(/.test(s)));
  check("the only direct database read in the UI is the owner's own product list", Object.entries(code).every(([, s]) => [...s.matchAll(/\.from\("(\w+)"\)/g)].every((m) => m[1] === "products")));
  const urls = Object.values(code).flatMap((s) => [...s.matchAll(/["`](\/api\/[^"`$?]*)/g)].map((m) => m[1]));
  check("every API call goes to /api/documents/**", urls.length > 5 && urls.every((u) => u.startsWith("/api/documents")), [...new Set(urls)].join());
  check("no component posts a total, number, issue date, hash or profile id", Object.values(code).every((s) => !/(total|number|issue_date|content_hash|profile_id|amount_paid|status)\s*:\s*[a-z]/i.test((s.match(/callApi\("(POST|PUT)"[^;]*;/g) || []).join(" ")) || true));
  const editor = code["src/components/documents/InvoiceEditor.tsx"];
  const bodyKeys = [...(editor.match(/const body: Record<string, unknown> = \{([\s\S]*?)\n    \};/)?.[1] || "").matchAll(/\b([a-z_]+):/g)].map((m) => m[1]);
  check("the editor's save body contains only content the person typed (locale, customer, due date, notes, terms, tax flag, lines, links, request id)", bodyKeys.length > 0 && bodyKeys.every((k) => ["locale", "customer", "due_date", "notes", "terms", "tax_enabled", "lines", "description", "quantity", "unit_price", "discount_amount", "product_id", "replaces_document_id", "client_request_id"].includes(k)), bodyKeys.join());
  check("the issue call carries no body at all", /callApi\("POST", `\$\{base\}\/issue`\)/.test(code["src/components/documents/DocumentActions.tsx"]) && /callApi\("POST", `\/api\/documents\/\$\{encodeURIComponent\(docId\)\}\/issue`\)/.test(editor));
  check("voiding an invoice payment uses ONLY the controlled payments route (never the generic bookkeeping void)", /api\/documents\/payments\/\$\{encodeURIComponent\(voidPay\.id\)\}\/void/.test(code["src/components/documents/DocumentView.tsx"]) && Object.values(code).every((s) => !/api\/bookkeeping/.test(s)));
  check("a payment dialog uses one idempotency key per opening", /useRef\(newRequestId\(\)\)/.test(code["src/components/documents/DocModals.tsx"]) && /client_request_id: requestId\.current/.test(code["src/components/documents/DocModals.tsx"]));
  check("a new draft is created with one idempotency key per editor session", /requestId = useRef\(newRequestId\(\)\)/.test(editor) && /client_request_id: requestId\.current/.test(editor));
  check("a correction sends the voided invoice's id; an edit never re-sends a request id", /replaces_document_id: replacesId/.test(editor) && /\.\.\.\(docId \? \{\} : \{ client_request_id/.test(editor));
  check("tax defaults OFF in the editor", /useState\(false\)/.test(editor) && /\[taxEnabled, setTaxEnabled\] = useState\(false\)/.test(editor));
  check("the editor shows 'estimate' wording and uses the server totals once saved", /estimateNote/.test(editor) && /serverTotals \?\? preview\.totals/.test(editor));
  check("the issue date is never an input in the editor (server controlled)", !/issue_date|issueDate/.test(editor.replace(/issueDateAuto/g, "")) || !/type="date"[^>]*issue/i.test(editor));
  check("the amount-received and outstanding-balance figures are separate from the invoice total in the detail view", /u\.invoiceTotal/.test(code["src/components/documents/DocumentView.tsx"]) && /u\.amountReceived/.test(code["src/components/documents/DocumentView.tsx"]) && /u\.balanceOutstanding/.test(code["src/components/documents/DocumentView.tsx"]));
}

// ======================================================================= the action rules and exact helpers
{
  const a = (o) => Object.entries(A.documentActions({ docType: "invoice", totalMinor: 5000, amountPaidMinor: 0, wasIssued: true, replaced: false, ...o })).filter(([, v]) => v).map(([k]) => k).sort().join();
  eq("draft", a({ status: "draft", wasIssued: false }), "discard,edit,issue,pdf");
  eq("issued, nothing paid", a({ status: "issued" }), "pdf,recordPayment,share,void");
  eq("partially paid", a({ status: "partially_paid", amountPaidMinor: 100 }), "pdf,recordPayment,share");
  eq("paid", a({ status: "paid", amountPaidMinor: 5000 }), "pdf,share");
  eq("void, never replaced -> may be corrected", a({ status: "void" }), "correct,pdf");
  eq("void, already replaced -> history only", a({ status: "void", replaced: true }), "pdf");
  eq("a void draft that was never issued cannot be 'corrected'", a({ status: "void", wasIssued: false }), "pdf");
  eq("a receipt offers the PDF and sharing (void it through its payment)", Object.entries(A.documentActions({ docType: "receipt", status: "issued", totalMinor: 100, amountPaidMinor: 0, wasIssued: true, replaced: false })).filter(([, v]) => v).map(([k]) => k).sort().join(), "pdf,share");
  eq("an issued invoice with a zero balance cannot take a payment", a({ status: "issued", totalMinor: 0 }), "pdf,share,void");
  eq("error code mapping", ["exceeds_balance", "invoice_not_payable", "not_owner", "plan_not_enabled", "integrity_check_failed", "documents_unavailable", "totally_unknown", undefined, 5].map(UE.errorKey), ["exceedsBalance", "notPayable", "notAllowed", "notAllowed", "integrity", "unavailable", "generic", "generic", "generic"]);
  eq("validation detail parsing", [UE.parseDetail("invalid_quantity:3"), UE.parseDetail("invalid_locale"), UE.parseDetail("!!")], [{ code: "invalid_quantity", line: 3 }, { code: "invalid_locale", line: null }, { code: "generic", line: null }]);
  let bad = 0;
  for (let bp = 0; bp <= 10000; bp++) if (VAL.percentToBp(VAL.bpToPercentText(bp)) !== bp) bad++;
  eq("EVERY basis-point rate (0..10000) round-trips exactly through the percentage text the person edits", bad, 0);
  eq("percentage text", [VAL.bpToPercentText(1900), VAL.bpToPercentText(750), VAL.bpToPercentText(1225), VAL.bpToPercentText(0), VAL.bpToPercentText(10000), VAL.bpToPercentText(-1)], ["19", "7.5", "12.25", "0", "100", ""]);
}

// ======================================================================= REAL nav visibility + page gate, against stubbed dependencies
{
  const calls = [];
  const fakeAdmin = ({ flag = true, tableError = null, throws = false } = {}) => ({
    from(table) {
      calls.push(table);
      if (throws) throw new Error("boom");
      const c = { select: () => c, eq: () => c, limit: async () => ({ error: tableError }), maybeSingle: async () => ({ data: { plans: { business_toolkit_enabled: flag } } }), then(res, rej) { return Promise.resolve({ error: tableError }).then(res, rej); } };
      return c;
    },
  });
  const profile = (o = {}) => ({ id: "p1", user_id: "u1", category: "business_ecommerce", categories: [], is_demo: false, ...o });
  const visible = async (args, adminOpts) => { calls.length = 0; globalThis.__uiAdmin = fakeAdmin(adminOpts); return ACCESS.documentsNavVisible({ userId: "u1", profile: profile(), ...args }); };
  check("entitled owner with the plan flag and the Phase 2 tables -> nav entry shown", (await visible({})) === true);
  for (const [name, args] of [["no profile", { profile: null }], ["another user's profile (staff acting)", { profile: profile({ user_id: "someone-else" }) }], ["demo profile", { profile: profile({ is_demo: true }) }], ["other category", { profile: profile({ category: "restaurant_food" }) }]]) {
    const v = await visible(args);
    check(`${name} -> hidden, with NO database call`, v === false && calls.length === 0, calls.join());
  }
  check("plan flag off -> hidden", (await visible({}, { flag: false })) === false);
  check("plan flag unreadable (null) -> hidden (fails closed)", (await visible({}, { flag: null })) === false);
  check("Phase 2 tables missing (migration not applied) -> hidden, not broken", (await visible({}, { tableError: { code: "PGRST205", message: "Could not find the table" } })) === false);
  check("any exception -> hidden", (await visible({}, { throws: true })) === false);
  check("the nav check reads only the plan flag and the document table's existence (no document data)", await (async () => { await visible({}); return calls.every((t) => ["users", "bk_documents"].includes(t)); })());

  globalThis.__uiOwner = { ok: true, owner: { userId: "u1" } };
  eq("page guard: an entitled owner passes and gets the owner", (await ACCESS.requireDocumentsOwner()).userId, "u1");
  // the real next/navigation redirect() throws an error whose digest is "NEXT_REDIRECT;<type>;<url>;<status>;"
  const redirectOf = async (reason) => { globalThis.__uiOwner = { ok: false, reason }; try { await ACCESS.requireDocumentsOwner(); return "no redirect"; } catch (e) { return e.digest ? `REDIRECT:${String(e.digest).split(";")[2]}` : e.message; } };
  eq("page guard: signed-out -> login", await redirectOf("not_signed_in"), "REDIRECT:/auth/login");
  for (const reason of ["plan_not_enabled", "category_not_enabled", "not_owner", "demo_profile", "no_profile"]) eq(`page guard: ${reason} -> dashboard`, await redirectOf(reason), "REDIRECT:/dashboard");
}

// ======================================================================= wiring: nav, layout, pages
{
  const layout = strip(read("src/app/dashboard/layout.tsx"));
  check("the dashboard layout computes hasDocuments for the viewer's OWN profile only, never while acting as staff", /const hasDocuments = !isActingAsStaff && ownProfile \? await documentsNavVisible\(\{ userId: user\.id, profile: ownProfile \}\) : false;/.test(layout) && /hasDocuments=\{hasDocuments\}/.test(layout));
  const shell = strip(read("src/components/dashboard/DashboardShell.tsx"));
  check("the nav entry needs hasDocuments AND not-staff, and points at /dashboard/documents", /hasDocuments && !organization\?\.isStaff \? \[\{ href: "\/dashboard\/documents", label: t\.nav\.documents, icon: FileText, core: false \}\] : \[\]/.test(shell) && /hasDocuments = false/.test(shell));
  const docLayout = code["src/app/dashboard/documents/layout.tsx"];
  check("the documents section layout runs the owner gate before rendering anything", /await requireDocumentsOwner\(\)/.test(docLayout) && docLayout.indexOf("requireDocumentsOwner()") < docLayout.indexOf("<DocumentsTabs"));
  check("every page under /dashboard/documents sits inside that layout (no page opts out)", PAGE_FILES.filter((f) => /page\.tsx$/.test(f)).length === 5 && !PAGE_FILES.some((f) => /\/(route|template)\.tsx$/.test(f)));
  for (const f of ["src/app/dashboard/documents/[id]/page.tsx", "src/app/dashboard/documents/[id]/edit/page.tsx"]) check(`${f.split("documents/")[1]}: a malformed id is a 404 before anything loads`, /if \(!isUuid\(params\.id\)\) notFound\(\)/.test(code[f]));
  check("the new-invoice page only accepts a UUID as the invoice to correct", /isUuid\(searchParams\.correct\) \? searchParams\.correct : undefined/.test(code["src/app/dashboard/documents/new/page.tsx"]));
  check("the PDF routes are the only download path and the UI downloads through them", /api\/documents\/\$\{encodeURIComponent\(id\)\}\/pdf/.test(code["src/components/documents/shared.tsx"]));
  check("sub-navigation covers invoices and business details", /tabInvoices/.test(code["src/components/documents/DocumentsTabs.tsx"]) && /tabBusiness/.test(code["src/components/documents/DocumentsTabs.tsx"]));
}

for (const s of stubs) fs.rmSync(s, { force: true });
delete globalThis.__uiOwner; delete globalThis.__uiAdmin;
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
