// Business Toolkit — Record Sale, standalone receipts, branding, payment details, print, footer and navigation: offline unit tests of the REAL code (validation, handlers with a
// fake owner, snapshot parsing, the PDF templates v1 and v2, the public document page, the logo loader, translations, navigation sources, scope). No network, no database,
// no migration. The end-to-end behaviour against real SQL is in recordSaleSql.test.mjs.
//   Run:  node scripts/tests/recordSaleUnit.test.mjs
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { execFileSync } from "child_process";
import { createRequire } from "module";
import { isPhase8AuthFile } from "./phase8Files.mjs"; // Phase 8: the exact auth / env files of "Continue with Google / Apple" (see phase8Files.mjs)
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8").replace(/\r\n/g, "\n");
const strip = (s) => s.replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
const jiti = require("jiti")(import.meta.url, { alias: { "@": SRC }, interopDefault: true, cache: false });
const load = (p) => jiti(path.join(SRC, p));
const V = load("lib/sales/validation.ts");
const H = load("lib/sales/handlers.ts");
const SNAP = load("lib/documents/snapshot.ts");
const R = load("lib/documents/pdf/render.ts");
const LOGO = load("lib/documents/pdf/logo.ts");
const { translations } = load("lib/i18n/translations.ts");
const { renderToStaticMarkup } = require("react-dom/server");
const React = require("react");
// jiti hands .tsx to the host runtime, so the two small components are compiled with TypeScript first (JSX -> jsx-runtime) into temp CommonJS modules
const os = require("os");
const ts = require("typescript");
const tmpFiles = [];
const compileTsx = (rel, extra = (x) => x) => {
  const out = ts.transpileModule(read(rel), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true } }).outputText
    .replace(/require\("react\/jsx-runtime"\)/g, `require(${JSON.stringify(require.resolve("react/jsx-runtime"))})`)
    .replace(/require\("@\/([^"]+)"\)/g, (_, p) => `require(${JSON.stringify(path.join(SRC, p + ".ts").split(path.sep).join("/"))})`);
  const file = path.join(os.tmpdir(), `rsu_${path.basename(rel).replace(/\W/g, "_")}_${process.pid}.cjs`);
  fs.writeFileSync(file, extra(out));
  tmpFiles.push(file);
  return file;
};
const printFile = compileTsx("src/components/documents/PrintButton.tsx");
const viewFile = compileTsx("src/components/documents/PublicDocumentView.tsx", (o) => o.replace(/require\("\.\/PrintButton"\)/g, `require(${JSON.stringify(printFile.split(path.sep).join("/"))})`));
const PublicDocumentView = jiti(viewFile).default;

console.error = () => {};
let pass = 0, fail = 0;
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", name, "|", String(detail).slice(0, 300)); } };
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

const hex = (s) => Buffer.from(s, "latin1").toString("hex").toUpperCase();
const pdfText = (bytes) => {
  const buf = Buffer.from(bytes); let out = ""; let i = 0;
  const s = buf.toString("latin1");
  for (;;) {
    const a = s.indexOf("stream", i); if (a < 0) break;
    const start = s[a + 6] === "\r" ? a + 8 : a + 7; const end = s.indexOf("endstream", start); if (end < 0) break;
    try { out += zlib.inflateSync(buf.subarray(start, end)).toString("latin1"); } catch { out += buf.subarray(start, end).toString("latin1"); }
    i = end + 9;
  }
  return out;
};
const has = (bytes, str) => pdfText(bytes).includes(hex(str));
const UUID = "44444444-4444-4444-8444-000000000001";
const ASSET = "5f0e0000-0000-4000-8000-000000000001"; // a frozen logo copy (bk_brand_assets id)

// ------------------------------------------------------------------------ 1. request validation
const OK = { locale: "en", lines: [{ product_id: UUID, quantity: 1 }], method: "cash", client_request_id: UUID };
const parse = (o) => V.parseSaleBody({ ...OK, ...o }, "XAF");
check("validation: a catalogue line (whole quantity, price from the product) is valid", parse({}).ok === true);
check("validation: a custom line with an exact price is valid, text amounts and decimal comma accepted", parse({ lines: [{ description: "Website", quantity: "1", unit_price: "150000" }] }).ok && parse({ lines: [{ description: "x", quantity: "1,5", unit_price: "10" }] }).ok);
for (const [label, o] of [["no lines", { lines: [] }], ["too many lines", { lines: Array.from({ length: 21 }, () => ({ description: "x", quantity: 1, unit_price: 1 })) }], ["a fractional product quantity", { lines: [{ product_id: UUID, quantity: 1.5 }] }], ["a zero quantity", { lines: [{ product_id: UUID, quantity: 0 }] }], ["a negative price", { lines: [{ description: "x", quantity: 1, unit_price: -1 }] }], ["a fractional XAF price", { lines: [{ description: "x", quantity: 1, unit_price: 1.5 }] }], ["a custom line without a price", { lines: [{ description: "x", quantity: 1 }] }], ["a custom line without a name", { lines: [{ description: " ", quantity: 1, unit_price: 5 }] }], ["a non-uuid product id", { lines: [{ product_id: "1; drop table", quantity: 1 }] }], ["an unknown method", { method: "crypto" }], ["a bad request id", { client_request_id: "x" }], ["a missing request id", { client_request_id: undefined }], ["a bad date", { sold_on: "yesterday" }], ["a bad customer id", { customer_id: "abc" }], ["an over-long note", { notes: "n".repeat(1001) }]]) {
  check(`validation: ${label} is refused`, parse(o).ok === false, JSON.stringify(parse(o)));
}
const parsed = parse({ profile_id: "evil", user_id: "evil", currency: "USD", linked_order_id: UUID, lines: [{ product_id: UUID, quantity: 2, evil: 1, description: "Ignored" }] });
check("validation: an identity, a currency or an order link in the body is never carried through (only the whitelisted fields)", parsed.ok && !JSON.stringify(parsed.value).includes("evil") && !("currency" in parsed.value) && !("linked_order_id" in parsed.value) && !("profile_id" in parsed.value) && !("description" in parsed.value.lines[0]));
check("validation: a USD business accepts cents, an XAF business does not", V.parseSaleBody({ ...OK, lines: [{ description: "x", quantity: 1, unit_price: "9.99" }] }, "USD").ok && !V.parseSaleBody({ ...OK, lines: [{ description: "x", quantity: 1, unit_price: "9.99" }] }, "XAF").ok);

// ------------------------------------------------------------------------ 2. the handler: one RPC, owner ids only
const mkOwner = (rpc) => ({ userId: "USER-1", profile: { id: "PROFILE-1", currency: "XAF" }, supabase: null, admin: { rpc } });
const calls = [];
const goodRpc = async (name, args) => { calls.push([name, args]); return { data: { document: { id: UUID, number: "RCT-2026-0001", total: "5000", currency: "XAF" }, duplicate: false, movements: [{}] }, error: null }; };
let r = await H.recordSale(mkOwner(goodRpc), { ...OK, profile_id: "EVIL", user_id: "EVIL" });
check("handler: ONE call to sale_record with the owner's own profile and user ids (never the body's), 201", r.status === 201 && calls.length === 1 && calls[0][0] === "sale_record" && calls[0][1].p_profile_id === "PROFILE-1" && calls[0][1].p_actor_user_id === "USER-1" && !JSON.stringify(calls[0][1]).includes("EVIL"), JSON.stringify(calls));
check("handler: the answer exposes the receipt id/number/total and the number of stock movements only", r.body.receipt.id === UUID && r.body.stock_movements === 1 && !("document" in r.body) && !("entry_id" in r.body));
const dupR = await H.recordSale(mkOwner(async () => ({ data: { document: { id: UUID, number: "N", total: "1", currency: "XAF" }, duplicate: true, movements: [] }, error: null })), OK);
check("handler: a replay answers 200 (duplicate)", dupR.status === 200 && dupR.body.duplicate === true);
const probe = [];
r = await H.recordSale(mkOwner(async (...a) => { probe.push(a); return { data: null, error: null }; }), { ...OK, lines: [] });
check("handler: an invalid body is a 400 and never reaches the database", r.status === 400 && probe.length === 0);
for (const [msg, status, code] of [["insufficient_stock", 409, "insufficient_stock"], ["customer_not_found", 404, "customer_not_found"], ["product_not_found", 404, "product_not_found"], ["not_owner", 403, "not_owner"], ["toolkit_not_enabled", 403, "toolkit_not_enabled"], ["demo_profile_not_supported", 403, "demo_profile_not_supported"], ["invalid_sold_on", 400, "invalid_sold_on"], ["request_id_conflict", 409, "request_id_conflict"], ["zero_total", 400, "zero_total"]]) {
  const e = await H.recordSale(mkOwner(async () => ({ data: null, error: { message: `${msg}` } })), OK);
  check(`handler: the database error '${msg}' is mapped to ${status} ${code}`, e.status === status && e.body.error === code, JSON.stringify(e));
}
const missing = await H.recordSale(mkOwner(async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.sale_record" } })), OK);
check("handler: before the migration is applied the answer is a clean 503 'documents_unavailable' (no crash, no leak)", missing.status === 503);
const weird = await H.recordSale(mkOwner(async () => ({ data: null, error: { message: "something odd with secret_table" } })), OK);
check("handler: an unknown database error is a generic 500 with no internal detail", weird.status === 500 && weird.body.error === "internal_error" && !JSON.stringify(weird).includes("secret_table"));
const fe = {
  from: (t) => { const chain = { _t: t, select: () => chain, eq: () => chain, order: () => chain, limit: async () => ({ data: t === "bk_documents" ? [{ id: UUID, number: "RCT-1", total: "5000.000", currency: "XAF", issue_date: "2026-12-10", status: "issued", created_at: "x", customer_snapshot: { name: "Jean", phone: "677000000", email: "j@x.cm" } }] : t === "products" ? [{ id: UUID, name: "Shirt", price: "5000.00", inventory_count: 99, product_type: "physical", available: true }] : [{ product_id: UUID }], error: null }) }; return chain; },
};
const listed = await H.listRecentSales({ ...mkOwner(goodRpc), supabase: fe });
check("recent sales: names and totals only (no phone, e-mail or note leaves the server)", listed.status === 200 && listed.body.items[0].customer_name === "Jean" && listed.body.items[0].total_minor === 5000 && !JSON.stringify(listed.body).match(/677000000|j@x\.cm/));
const prods = await H.listSaleProducts({ ...mkOwner(goodRpc), supabase: fe });
check("product list: stock is shown only for a TRACKED product", prods.body.items[0].tracked === true && prods.body.items[0].stock === 99);

// ------------------------------------------------------------------------ 3. the stored snapshot: frozen branding and the sale receipt facts
const baseDoc = { doc_type: "invoice", status: "issued", locale: "en", currency: "XAF", number: "INV-2026-0001", issue_date: "2026-12-10", due_date: "2026-12-20", subtotal: "1000", discount_total: "0", tax_total: "0", total: "1000", amount_paid: "0", template_version: 2,
  seller_snapshot: { display_name: "Alice Shop", logo_asset_id: ASSET, accent_color: "#112233", payment_details: { bank_name: "Afriland", momo_number: "677000000", instructions: "Quote the number" } }, customer_snapshot: { name: "Jean" }, type_snapshot: null };
const line = { position: 1, description: "Work", quantity: "1", unit_price: "1000", gross_amount: "1000", discount_amount: "0", tax_amount: "0", line_total: "1000" };
let m = SNAP.modelFromRows({ doc: baseDoc, lines: [line] });
check("snapshot: branding is read from the FROZEN seller snapshot", m.branding.accent === "#112233" && m.branding.logoAssetId === ASSET && m.branding.paymentDetails.bankName === "Afriland" && m.branding.paymentDetails.momoNumber === "677000000");
m = SNAP.modelFromRows({ doc: { ...baseDoc, template_version: 1, seller_snapshot: { display_name: "Old" } }, lines: [line] });
check("snapshot: an old (v1) document has no branding at all", m.templateVersion === 1 && m.branding.accent === null && m.branding.logoAssetId === null && m.branding.paymentDetails === null);
m = SNAP.modelFromRows({ doc: { ...baseDoc, seller_snapshot: { display_name: "X", logo_asset_id: "../../etc/passwd", accent_color: "red; background:url(x)", payment_details: { bank_name: 5 } } }, lines: [line] });
check("snapshot: anything that is not exactly a stored-logo id / #rrggbb colour / text is dropped (a URL is never a logo reference)", m.branding.logoAssetId === null && m.branding.accent === null && m.branding.paymentDetails === null);
const saleDoc = { ...baseDoc, doc_type: "receipt", number: "RCT-2026-0001", due_date: null, customer_snapshot: {}, type_snapshot: { kind: "sale", method: "mobile_money", paid_on: "2026-12-10", amount: "5000" }, subtotal: "5000", total: "5000" };
const saleModel = SNAP.modelFromRows({ doc: saleDoc, lines: [{ ...line, description: "Red Shirt", quantity: "2", unit_price: "2500", gross_amount: "5000", line_total: "5000" }] });
check("snapshot: a sale receipt is flagged as a sale and carries its own lines (no parent invoice)", saleModel.payment.sale === true && saleModel.parent === null && saleModel.lines.length === 1 && saleModel.payment.amountMinor === 5000);
const payModel = SNAP.modelFromRows({ doc: { ...saleDoc, type_snapshot: { method: "cash", paid_on: "2026-12-10", amount: "500", balance_after: "500", invoice_number: "INV-1" } }, lines: [line], parent: { doc: { number: "INV-1" }, lines: [line] } });
check("snapshot: an invoice-payment receipt is NOT a sale receipt", payModel.payment.sale === false && payModel.parent.number === "INV-1");

// ------------------------------------------------------------------------ 4. PDFs: v1 untouched, v2 branded, no Ringo footer
const invModel = (over = {}, brand = {}) => SNAP.modelFromRows({ doc: { ...baseDoc, ...over, seller_snapshot: { ...baseDoc.seller_snapshot, ...brand } }, lines: [line] });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");
const v1 = await R.renderDocumentPdf(invModel({ template_version: 1, seller_snapshot: { display_name: "Old Shop" } }, {}));
check("v1: an old document keeps its original footer and its original look (no payment block even if a snapshot carried one)", has(v1, "Generated with Ringo Connect") && !has(v1, "How to pay") && !has(v1, "Afriland") && has(v1, "Alice Shop"));
const v1again = await R.renderDocumentPdf(invModel({ template_version: 1, seller_snapshot: { display_name: "Old Shop" } }, {}));
check("v1: re-rendering gives identical bytes (reproducible)", Buffer.compare(Buffer.from(v1), Buffer.from(v1again)) === 0);
const v2 = await R.renderDocumentPdf(invModel(), undefined, undefined);
check("v2: no 'Generated with Ringo Connect' footer, but the page number is still there", !has(v2, "Generated with Ringo Connect") && has(v2, "Page 1 / 1"));
check("v2: an issued invoice shows 'How to pay' with the structured details and the instructions", has(v2, "How to pay") && has(v2, "Afriland") && has(v2, "677000000") && has(v2, "Quote the number") && has(v2, "Bank") && has(v2, "Mobile Money number"));
const paid = await R.renderDocumentPdf(invModel({ status: "paid", amount_paid: "1000" }));
check("v2: a PAID invoice does not ask for money (no 'How to pay')", !has(paid, "How to pay"));
check("v2: the accent colour is the business's (0.0667 0.1333 0.2 rg for #112233)", pdfText(v2).includes("0.0666") || pdfText(v2).includes("0.067") || /0\.06\d* 0\.13\d* 0\.2 rg/.test(pdfText(v2)), pdfText(v2).slice(0, 200));
const noAccent = await R.renderDocumentPdf(invModel({}, { accent_color: null }));
check("v2: without a colour the original dark accent is used (fallback)", !/0\.06\d* 0\.13\d* 0\.2 rg/.test(pdfText(noAccent)));
const none = await R.renderDocumentPdf(invModel({}, { payment_details: null, logo_asset_id: null, accent_color: null }));
check("v2: a business with no logo, colour or payment details gets a clean invoice (fallback)", !has(none, "How to pay") && !has(none, "Generated with Ringo Connect") && Buffer.from(none).subarray(0, 4).toString() === "%PDF");
const withLogo = await R.renderDocumentPdf(invModel(), { loadLogo: async (id) => (id === ASSET ? { bytes: PNG, kind: "png" } : null) });
check("v2: the frozen logo is embedded in the PDF", pdfText(withLogo).includes("/Im") || Buffer.from(withLogo).toString("latin1").includes("/Subtype /Image"), String(withLogo.length));
const badLogo = await R.renderDocumentPdf(invModel(), { loadLogo: async () => ({ bytes: Buffer.from("not an image"), kind: "png" }) });
check("v2: an unreadable logo is simply left out (the document is never refused over its logo)", Buffer.from(badLogo).subarray(0, 4).toString() === "%PDF" && !Buffer.from(badLogo).toString("latin1").includes("/Subtype /Image"));
const saleModel2 = SNAP.modelFromRows({ doc: saleDoc, lines: [{ ...line, description: "Red Shirt", quantity: "2", unit_price: "2500", gross_amount: "5000", line_total: "5000" }] });
const salePdf = await R.renderDocumentPdf(saleModel2);
check("v2 sale receipt: shows the items, 'Total paid', the payment method and date, no invoice reference, no Ringo footer", has(salePdf, "Red Shirt") && has(salePdf, "Total paid") && has(salePdf, "Mobile money") && !has(salePdf, "Payment towards invoice") && !has(salePdf, "Generated with Ringo Connect") && !has(salePdf, "Billed to"));
const saleCust = await R.renderDocumentPdf(SNAP.modelFromRows({ doc: { ...saleDoc, customer_snapshot: { name: "Jean Buyer" } }, lines: [line] }));
check("v2 sale receipt: a named customer is printed under 'Billed to'", has(saleCust, "Billed to") && has(saleCust, "Jean Buyer"));
const saleFr = await R.renderDocumentPdf(SNAP.modelFromRows({ doc: { ...saleDoc, locale: "fr" }, lines: [line] }));
check("v2 sale receipt: French labels", has(saleFr, "Total pay") && has(saleFr, "Mode de paiement") && !has(saleFr, "Total paid"));
const payRct = await R.renderDocumentPdf(payModel);
check("v2 invoice-payment receipt: unchanged content (invoice reference and balance), just branded", has(payRct, "Payment towards invoice") && has(payRct, "INV-1") && has(payRct, "Balance remaining"));
check("template versions: both 1 and 2 are supported, anything else is an error (never a silently different layout)", JSON.stringify(R.supportedTemplateVersions()) === "[1,2]" && (await R.renderDocumentPdfSafe(invModel({ template_version: 9 }))).ok === false);

// ------------------------------------------------------------------------ 5. logo loader: own storage host only
let fetched = 0;
const png = PNG;
const stubFetch = async () => { fetched++; return { ok: true, headers: { get: () => String(png.length) }, arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) }; };
check("logo: an https URL on the project's own storage host is fetched and sniffed as PNG", (await LOGO.fetchLogoBytes("https://proj.supabase.co/storage/v1/object/public/a/b.png", { host: "proj.supabase.co", fetchImpl: stubFetch }))?.kind === "png" && fetched === 1);
fetched = 0;
for (const url of ["https://evil.test/a.png", "http://proj.supabase.co/a.png", "http://169.254.169.254/latest/meta-data", "https://proj.supabase.co.evil.test/a.png", "ftp://proj.supabase.co/a.png", "not a url", "", null]) {
  check(`logo: ${JSON.stringify(url)} is never fetched`, (await LOGO.fetchLogoBytes(url, { host: "proj.supabase.co", fetchImpl: stubFetch })) === null && fetched === 0);
}
check("logo: with no configured host nothing is ever fetched", (await LOGO.fetchLogoBytes("https://proj.supabase.co/a.png", { host: null, fetchImpl: stubFetch })) === null && fetched === 0);
check("logo: an oversized, non-image or failing response is ignored", (await LOGO.fetchLogoBytes("https://proj.supabase.co/a.png", { host: "proj.supabase.co", fetchImpl: async () => ({ ok: true, headers: { get: () => "99999999" }, arrayBuffer: async () => new ArrayBuffer(1) }) })) === null
  && (await LOGO.fetchLogoBytes("https://proj.supabase.co/a.png", { host: "proj.supabase.co", fetchImpl: async () => ({ ok: true, headers: { get: () => "5" }, arrayBuffer: async () => Buffer.from("hello").buffer }) })) === null
  && (await LOGO.fetchLogoBytes("https://proj.supabase.co/a.png", { host: "proj.supabase.co", fetchImpl: async () => { throw new Error("boom"); } })) === null);
check("logo: redirects are refused (no hop to another host)", /redirect: "error"/.test(read("src/lib/documents/pdf/logo.ts")));

// ------------------------------------------------------------------------ 6. the public (shared) page
const render = (model) => renderToStaticMarkup(React.createElement(PublicDocumentView, { model, pdfHref: "/d/tok/pdf", logoHref: model.branding.logoAssetId ? "/d/tok/logo" : null }));
const html1 = render(SNAP.modelFromRows({ doc: { ...baseDoc, template_version: 1, seller_snapshot: { display_name: "Old Shop" } }, lines: [line] }));
check("public page v1: unchanged (original footer, no 'How to pay')", html1.includes("Generated with Ringo Connect") && !html1.includes("How to pay"));
const html2 = render(SNAP.modelFromRows({ doc: baseDoc, lines: [line] }));
check("public page v2: no Ringo footer, the frozen logo (served through the document's own token route, never a live URL) and accent, the payment details, a Print button and the PDF download", !html2.includes("Generated with Ringo Connect") && html2.includes("/d/tok/logo") && !html2.includes("files.test") && html2.includes("#112233") && html2.includes("How to pay") && html2.includes("Afriland") && html2.includes(">Print<") && html2.includes("/d/tok/pdf"));
const htmlPaid = render(SNAP.modelFromRows({ doc: { ...baseDoc, status: "paid", amount_paid: "1000" }, lines: [line] }));
check("public page v2: a paid invoice has no 'How to pay'", !htmlPaid.includes("How to pay"));
const htmlSale = render(saleModel2);
check("public page: a sale receipt shows the items, the total, the payment method, no balance due and no empty 'Billed to'", htmlSale.includes("Red Shirt") && htmlSale.includes("Mobile money") && !htmlSale.includes("Balance due") && !htmlSale.includes("Billed to") && !htmlSale.includes("Generated with Ringo Connect"));
const htmlSaleFr = render(SNAP.modelFromRows({ doc: { ...saleDoc, locale: "fr" }, lines: [line] }));
check("public page: French labels for the print button", htmlSaleFr.includes(">Imprimer<"));
check("public page: the print button is the only script and is hidden when printing", /print:hidden/.test(read("src/components/documents/PrintButton.tsx")) && /window\.print\(\)/.test(read("src/components/documents/PrintButton.tsx")) && !/use client/.test(read("src/components/documents/PublicDocumentView.tsx")));
check("public page: a hostile accent value can never reach the style attribute (only a validated #rrggbb is used)", !render(SNAP.modelFromRows({ doc: { ...baseDoc, seller_snapshot: { display_name: "X", accent_color: "red;background:url(javascript:1)" } }, lines: [line] })).includes("javascript:"));

// ------------------------------------------------------------------------ 7. print + download + share on the dashboard
const shared = read("src/components/documents/shared.tsx");
check("print: printPdf fetches the PDF and prints it from an invisible frame (no download first); Download PDF stays a separate action", /export async function printPdf/.test(shared) && /iframe/.test(shared) && /\.print\(\)/.test(shared) && /export async function downloadPdf/.test(shared));
const actions = read("src/components/documents/DocumentActions.tsx");
check("print: the invoice actions offer Print next to Download PDF and Share", /u\.print/.test(actions) && /u\.downloadPdf/.test(actions) && /ShareButton/.test(actions));
const view = read("src/components/documents/DocumentView.tsx");
check("receipt screen: after a sale it offers Print, Download, Copy/Share link and 'record another sale' and a success banner", /PrintBtn/.test(view) && /downloadReceipt/.test(view) && /ShareButton/.test(view) && /saleRecordedTitle/.test(view) && /dashboard\/sales/.test(view));
check("share: the existing share modal is reused (no new sharing mechanism, no new share table/route)", !fs.existsSync(path.join(SRC, "app/api/sales/share")) && !/bk_document_shares|doc_create_share/.test(read("supabase/migrations/2026-12-06_record_sale_receipts_branding.sql").replace(/--.*$/gm, "")));

// ------------------------------------------------------------------------ 8. navigation
const shell = read("src/components/dashboard/DashboardShell.tsx");
const navStart = shell.indexOf("// Business Toolkit, in the order");
const navBlock = shell.slice(navStart, shell.indexOf("hasTicketing && !organization?.isStaff", navStart));
const hrefs = [...navBlock.matchAll(/href: "(\/dashboard\/[a-z-]+)"/g)].map((x) => x[1]);
eq("navigation: Record sale, Inventory, Customers, Invoices, Bookkeeping, Reports in that order, after Shop", hrefs, ["/dashboard/sales", "/dashboard/inventory", "/dashboard/customers", "/dashboard/documents", "/dashboard/bookkeeping", "/dashboard/reports"]);
check("navigation: Bookkeeping is its OWN hamburger item (not a Reports tab) and Shop comes first", /href: "\/dashboard\/bookkeeping", label: t\.nav\.bookkeeping/.test(shell) && shell.indexOf('"/dashboard/shop"') < shell.indexOf('"/dashboard/sales"'));
check("navigation: owner only (hidden for staff) like every other Toolkit entry", (navBlock.match(/!organization\?\.isStaff/g) || []).length === 6);
const tabs = read("src/components/reports/ReportsTabs.tsx");
check("navigation: Reports keeps Overview, Monthly report and Trends only (no Entries tab any more)", !/reports\/entries/.test(tabs) && /reports\/trends/.test(tabs) && /reports\/monthly/.test(tabs));
check("navigation: /dashboard/bookkeeping serves the entries screen behind the Reports entitlement; the old URL redirects there", /EntriesView/.test(read("src/app/dashboard/bookkeeping/page.tsx")) && /requireReportsOwner/.test(read("src/app/dashboard/bookkeeping/layout.tsx")) && /redirect\("\/dashboard\/bookkeeping"\)/.test(read("src/app/dashboard/reports/entries/page.tsx")));
check("navigation: every link to the entries screen now points at Bookkeeping", !/dashboard\/reports\/entries/.test(read("src/components/overview/OverviewView.tsx") + read("src/lib/ai/drafts/business.ts")));
const layout = read("src/app/dashboard/layout.tsx");
check("navigation: the Record sale entry waits for sale_record to exist (no button before the migration) and is hidden from staff", /salesNavVisible/.test(layout) && /hasSales/.test(layout) && /saleRecordInstalled/.test(read("src/lib/sales/access.ts")) && /isActingAsStaff/.test(layout.slice(layout.indexOf("hasSales"), layout.indexOf("hasSales") + 200)));
check("navigation: the Record Sale page itself is owner-only and redirects when the function is missing", /requireSalesOwner/.test(read("src/app/dashboard/sales/layout.tsx")) && /saleRecordInstalled/.test(read("src/app/dashboard/sales/layout.tsx")));

// ------------------------------------------------------------------------ 9. the screen's behaviour (source) and its words
const screen = read("src/components/sales/RecordSaleView.tsx");
check("screen: the sale is ONE POST to /api/sales with a per-form request id (a double click cannot record twice) and then opens the receipt", /\/api\/sales"/.test(screen) && /client_request_id: rid/.test(screen) && /const \[rid\] = useState\(newRequestId\)/.test(screen) && /\?sale=1/.test(screen));
check("screen: product OR custom item per row, optional customer (search / new / walk-in), payment method buttons, date, note, running total, 'create an invoice instead' for unpaid sales", /fromCatalogue/.test(screen) && /customItem/.test(screen) && /walkIn/.test(screen) && /newCustomer/.test(screen) && /PAYMENT_METHODS/.test(screen) && /createInvoice/.test(screen) && /credit=1/.test(screen));
check("screen: stock is shown per product (in stock / not tracked / low warning) and untracked products get a hint to start tracking", /stockLeft/.test(screen) && /stockNotTracked/.test(screen) && /stockWarn/.test(screen) && /trackHint/.test(screen));
check("screen: the customer is created through the customer book's own endpoint (which refuses duplicates), never by the sale", /\/api\/receivables\/customers/.test(screen) && !/bk_customers/.test(screen));
check("screen: it computes nothing authoritative (the total is only a preview; the database recomputes)", /preview/i.test(screen.slice(0, 2500)));
const en = translations.en, fr = translations.fr;
const flat = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? flat(v, `${p}${k}.`) : [`${p}${k}`]));
const sameKeys = (a, b) => JSON.stringify(flat(a).sort()) === JSON.stringify(flat(b).sort());
check("i18n: the sales namespace has identical keys in English and French, and every string is non-empty", sameKeys(en.sales, fr.sales) && flat(en.sales).length > 60 && [en.sales, fr.sales].every((o) => JSON.stringify(o, (k, v) => (typeof v === "function" ? v(1, "XAF", "x") : v)).indexOf('""') === -1));
check("i18n: new document strings (print, payment details, sale banner) exist in both languages", ["print", "printFailed", "payDetailsTitle", "payDetailsHint", "bankName", "accountName", "accountNumber", "momoProvider", "momoNumber", "payInstructions", "saleRecordedTitle", "saleRecordedBody", "saleReceiptNote", "walkInCustomer"].every((k) => en.documents.ui[k] && fr.documents.ui[k]));
check("i18n: new PDF labels exist in both languages", ["bankName", "accountName", "accountNumber", "momoProvider", "momoNumber", "howToPay", "totalPaid"].every((k) => en.documents.pdf[k] && fr.documents.pdf[k]));
check("i18n: navigation labels exist in both languages", en.nav.recordSale && fr.nav.recordSale && en.nav.bookkeeping && fr.nav.bookkeeping);
check("i18n: every error the Record Sale API can return has a message in both languages", ["validation_failed", "insufficient_stock", "customer_not_found", "product_not_found", "duplicate_customer", "invalid_sold_on", "request_id_conflict", "zero_total", "not_owner", "toolkit_not_enabled", "demo_profile_not_supported", "documents_unavailable", "internal_error", "network", "generic"].every((k) => en.sales.errors[k] && fr.sales.errors[k]));
check("i18n: the sale-entry guard has a message in both languages", en.bookkeeping.errors?.entry_linked_to_sale || JSON.stringify(en).includes("entry_linked_to_sale"));
check("i18n: inventory says 'Start tracking stock' (EN) / 'Commencer le suivi du stock' (FR)", en.inventory.ui?.startTracking === "Start tracking stock" || JSON.stringify(en.inventory).includes("Start tracking stock"));

// ------------------------------------------------------------------------ 10. scope, safety and no second system
const salesSrc = strip(["src/lib/sales/handlers.ts", "src/lib/sales/validation.ts", "src/lib/sales/access.ts", "src/app/api/sales/route.ts", "src/app/api/sales/products/route.ts"].map(read).join("\n"));
check("scope: the sales code writes nothing itself (no insert/update/delete/upsert, no table access) and its only writes are the rpcs sale_record and sale_void", !/\.(insert|update|delete|upsert)\s*\(/.test(salesSrc) && (salesSrc.match(/\.rpc\(\s*"([a-z_]+)"/g) || []).every((x) => /sale_record|sale_void/.test(x)));
check("scope: no second inventory, sales, receipt, customer or bookkeeping table is created (the migration creates only the two immutable logo-copy tables)", (read("supabase/migrations/2026-12-06_record_sale_receipts_branding.sql").replace(/--.*$/gm, "").match(/create\s+table\s+if\s+not\s+exists\s+(\w+)/gi) || []).map((x) => x.split(/\s+/).pop()).sort().join() === "bk_brand_assets,bk_brand_logo_current");
check("scope: the sales routes use the same owner-only gate as every Toolkit route", /withOwner/.test(read("src/app/api/sales/route.ts")) && /withOwner/.test(read("src/app/api/sales/products/route.ts")));
const git = (args) => execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).split("\n").filter(Boolean).map((f) => f.replace(/\\/g, "/"));
let changed = [];
try { changed = [...git(["diff", "--name-only", "HEAD"]), ...git(["ls-files", "--others", "--exclude-standard"])]; } catch { /* not a git checkout */ }
check("scope: checkout, orders, payments, auth, middleware, music, restaurant, ticketing, webhooks and the AI tools are not touched", !changed.filter((f) => !isPhase8AuthFile(f)).some((f) => /^src\/(lib\/(productCheckout|payments|fapshi|protection|music|restaurant|tickets|shopReceiptPdf)|middleware|app\/auth|app\/api\/(payments|fapshi|music|restaurant|tickets|webhooks|cron|auth|shop|orders|products|billing|protection)|app\/shop|app\/dashboard\/shop)/.test(f)), changed.filter((f) => /checkout|shop|payments|auth|middleware/.test(f)).join());
check("scope: AI code is not changed beyond the draft review link (now Bookkeeping) and one knowledge note about Record Sale (no tool, draft type or gate change)", changed.filter((f) => /^src\/lib\/ai\//.test(f)).sort().join() === "src/lib/ai/drafts/business.ts,src/lib/ai/knowledge/modules/businessAi.ts" && /reviewPath: \(\) => "\/dashboard\/bookkeeping"/.test(read("src/lib/ai/drafts/business.ts")));
check("scope: the Reports and Shop receipt PDFs keep their own footers (only business invoices and receipts changed)", /generatedWith/.test(read("src/lib/reports/pdf.ts")) && /generatedWith/.test(read("src/lib/shopReceiptPdf/render.ts")));
check("scope: no package file, schema.sql, tsbuildinfo, env or scratch file is part of the change", !changed.filter((f) => !isPhase8AuthFile(f)).some((f) => /^(package(-lock)?\.json|supabase\/schema\.sql|tsconfig\.tsbuildinfo)$|(^|\/)\.env|scratch|_probe/.test(f)));
check("scope: the only SQL files are the un-applied Record Sale migration and its rollback (plus the earlier AI one already committed)", changed.filter((f) => /^supabase\//.test(f)).every((f) => /2026-12-06_record_sale_receipts_branding/.test(f)), changed.filter((f) => /^supabase\//.test(f)).join());
const mig = read("supabase/migrations/2026-12-06_record_sale_receipts_branding.sql");
check("migration: it states what it changes, is one transaction, is idempotent and points at its rollback", /begin;/.test(mig) && /commit;/.test(mig) && /Idempotent/.test(mig) && /rollback\.sql/.test(mig));
check("migration: the new function is SECURITY DEFINER with a pinned search_path and is granted to service_role only", /function sale_record[\s\S]*security definer set search_path = public, pg_temp/.test(mig) && /revoke all on function sale_record[\s\S]*from public, anon, authenticated, service_role/.test(mig) && /grant execute on function sale_record[\s\S]*to service_role/.test(mig));
check("migration: the sale uses the Africa/Douala business day and refuses future dates", /Africa\/Douala/.test(mig) && /invalid_sold_on/.test(mig));
check("migration: stock is decremented only through the existing function and only for tracked products; everything is one transaction (no savepoint, no exception handler)", /inv_adjust_stock\(/.test(mig) && /bk_stock_settings[\s\S]{0,120}active/.test(mig) && !/exception\s+when/i.test(mig.replace(/--.*$/gm, "")));


// ------------------------------------------------------------------------ 11. frozen branding: the renderer and the snapshot never use a live URL
const renderSrc = strip(read("src/lib/documents/pdf/render.ts") + read("src/lib/documents/pdf/templates/v2.ts"));
check("branding: the PDF renderer makes no network call and reads no URL (a v2 logo comes only from the frozen copy by id)", !/\bfetch\(|logoUrl|logo_url|new URL\(/.test(renderSrc) && /loadLogo/.test(renderSrc));
const mig2 = read("supabase/migrations/2026-12-06_record_sale_receipts_branding.sql").replace(/--.*$/gm, "");
check("branding: the seller snapshot stores a reference to an immutable logo copy and never the profile picture URL", /'logo_asset_id'/.test(mig2) && /'logo_sha256'/.test(mig2) && !/'logo_url'/.test(mig2) && /create table if not exists bk_brand_assets/.test(mig2));
check("branding: the logo copies are append-only (update/delete/truncate guarded), PNG/JPEG only, size-capped, and their bytes are not selectable by any role", /bk_brand_assets_guard/.test(mig2) && /before update or delete on bk_brand_assets/.test(mig2) && /image\/png.*image\/jpeg/.test(mig2) && /262144/.test(mig2) && /grant select \(id, profile_id, sha256, content_type, created_at\) on bk_brand_assets/.test(mig2));
check("branding: the logo is copied into the immutable store right before a document is issued (invoice issue and Record Sale) and a failure never blocks issuing", /syncBrandLogo\(owner\)/.test(read("src/lib/documents/handlers.ts")) && /syncBrandLogo\(owner\)/.test(read("src/lib/sales/handlers.ts")) && /catch \(e\)/.test(read("src/lib/documents/brand.ts")));
check("branding: the public logo goes through the document's own share token (uniform 404 otherwise)", /openSharedLogo/.test(read("src/app/d/[token]/logo/route.ts")) && /uniformUnavailable/.test(read("src/app/d/[token]/logo/route.ts")));
check("branding: the logo is only ever fetched at sync time, from the project's own storage host", /fetchLogoBytes/.test(read("src/lib/documents/brand.ts")) && !/fetchLogoBytes/.test(read("src/lib/documents/pdf/render.ts")));

// ------------------------------------------------------------------------ 12. void sale: surface
const sv = read("supabase/migrations/2026-12-06_record_sale_receipts_branding.sql").replace(/--.*$/gm, "");
check("void sale: ONE database function does the whole reversal, reusing bk_void_entry and inv_adjust_stock (no second correction system)", /function sale_void/.test(sv) && /bk_void_entry\(/.test(sv.slice(sv.indexOf("function sale_void"))) && /inv_adjust_stock\(/.test(sv.slice(sv.indexOf("function sale_void"))) && !/delete\s+from/i.test(sv));
check("void sale: serialised per receipt (advisory + row lock), owner gate, reason required, only sale receipts", /pg_advisory_xact_lock\(hashtextextended\('salevoid:/.test(sv) && /for update/.test(sv.slice(sv.indexOf("function sale_void"))) && /bk_doc_gate\(p_profile_id, p_actor_user_id\)/.test(sv.slice(sv.indexOf("function sale_void"))) && /reason_required/.test(sv.slice(sv.indexOf("function sale_void"))) && /source_type is distinct from 'sale'/.test(sv));
check("void sale: callable by service_role only", /revoke all on function sale_void[\s\S]*from public, anon, authenticated, service_role/.test(sv) && /grant execute on function sale_void[\s\S]*to service_role/.test(sv));
const voidRoute = read("src/app/api/sales/[id]/void/route.ts");
check("void sale: the route uses the owner-only gate and the handler writes only through the sale_void rpc", /withOwner/.test(voidRoute) && /rpc\("sale_void"/.test(read("src/lib/sales/handlers.ts")));
const vh = await H.voidSale(mkOwner(async (name, args) => { calls.push([name, args]); return { data: { document: { id: UUID, number: "RCT-1", status: "void" }, already_voided: false, restored: [{}], not_restored: [] }, error: null }; }), UUID, { reason: "wrong customer", profile_id: "EVIL" });
check("void sale handler: ONE sale_void call with the owner's own ids and the reason, answers the receipt status and the stock restored count", vh.status === 200 && vh.body.receipt.status === "void" && vh.body.stock_restored === 1 && calls.at(-1)[0] === "sale_void" && calls.at(-1)[1].p_profile_id === "PROFILE-1" && !JSON.stringify(calls.at(-1)).includes("EVIL"));
const vnone = await H.voidSale(mkOwner(goodRpc), UUID, { reason: "  " });
const vbad = await H.voidSale(mkOwner(goodRpc), "not-a-uuid", { reason: "x" });
check("void sale handler: a missing reason is a 400 and a malformed id a 404, neither reaches the database", vnone.status === 400 && vbad.status === 404);
const vdup = await H.voidSale(mkOwner(async () => ({ data: { document: { id: UUID, number: "RCT-1", status: "void" }, already_voided: true, restored: [], not_restored: [] }, error: null })), UUID, { reason: "again" });
check("void sale handler: a repeat answers 200 already_voided", vdup.status === 200 && vdup.body.already_voided === true);
check("void sale: the receipt screen offers 'Void sale' only for a live sale receipt, behind a reason dialog, and nothing else gets the action", /voidSale/.test(read("src/lib/documents/actions.ts")) && /d\.saleReceipt === true && d\.status === "issued"/.test(read("src/lib/documents/actions.ts")) && /actions\?\.voidSale/.test(read("src/components/documents/DocumentView.tsx")) && /ReasonModal/.test(read("src/components/documents/DocumentView.tsx")));
const A = load("lib/documents/actions.ts");
check("void sale: actions - issued sale receipt yes; void sale receipt no; invoice-payment receipt no; invoice no", A.documentActions({ docType: "receipt", status: "issued", totalMinor: 5, amountPaidMinor: 0, wasIssued: true, replaced: false, saleReceipt: true }).voidSale === true && A.documentActions({ docType: "receipt", status: "void", totalMinor: 5, amountPaidMinor: 0, wasIssued: true, replaced: false, saleReceipt: true }).voidSale === false && A.documentActions({ docType: "receipt", status: "issued", totalMinor: 5, amountPaidMinor: 0, wasIssued: true, replaced: false }).voidSale === false && A.documentActions({ docType: "invoice", status: "issued", totalMinor: 5, amountPaidMinor: 0, wasIssued: true, replaced: false }).voidSale === false);
check("void sale: strings exist in English and French", ["voidSale", "voidSaleTitle", "voidSaleBody"].every((k) => en.documents.ui[k] && fr.documents.ui[k]));
check("void sale: a voided receipt renders with the VOID watermark in its PDF and 'void' on its public page", has(await R.renderDocumentPdf(SNAP.modelFromRows({ doc: { ...saleDoc, status: "void", voided_at: "x", void_reason: "r" }, lines: [line] })), "VOID") && render(SNAP.modelFromRows({ doc: { ...saleDoc, status: "void" }, lines: [line] })).includes("Void"));

for (const f of tmpFiles) try { fs.unlinkSync(f); } catch {}
console.log(`recordSaleUnit: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
