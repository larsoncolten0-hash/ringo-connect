// Platform Shop receipt PDF: an existing RCP-… receipt rendered as a downloadable PDF with the shared PDF foundation.
// Not an invoice, not a Phase 2 document: no bk_documents row, no bookkeeping entry, no payment/checkout logic touched.
// REAL renderer and REAL route logic run against stubs for the receipt reader and the session; no network, no database, nothing applied.
//   Run:  node scripts/tests/shopReceiptPdf.test.mjs
import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import { execFileSync } from "child_process";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { isPhase16ProtectedFile } from "./phase16Files.mjs"; // security remediation: the exact files (billing webhook / upgrade stub, package files, next-env.d.ts) it changes on purpose
import { isPhase21Migration } from "./phase21Files.mjs"; // Phase 6 security: the one un-applied payout-concurrency migration (exact path)
import { isPhase18Migration } from "./phase18Files.mjs"; // Phase 3 security: the one un-applied private-file-path migration (exact path)
import { isPhase17Migration } from "./phase17Files.mjs"; // Phase 2 security: the one un-applied team-ceiling migration (exact path)

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8").replace(/\r\n/g, "\n");
const strip = (s) => s.replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, "");

const tmp = [];
const mk = (name, body) => { const f = path.join(os.tmpdir(), `${name}_${process.pid}.cjs`); fs.writeFileSync(f, body); tmp.push(f); return f; };
const receiptStub = mk("shoprcp_receipt_stub", "module.exports = { getShopOrderReceiptData: async (id) => { globalThis.__log.push(['receipt', id]); return globalThis.__receipt && globalThis.__receipt.orderId === id ? globalThis.__receipt : null; } };");
const serverStub = mk("shoprcp_server_stub", "module.exports = { createClient: () => globalThis.__session, createAdminClient: () => { throw new Error('the PDF routes never need the admin client directly'); } };");
const authStub = mk("shoprcp_auth_stub", "module.exports = { shopIsVisibleFor: async () => globalThis.__visible !== false };");
const jiti = require("jiti")(import.meta.url, { alias: { "@/lib/productCheckout/receipt": receiptStub, "@/lib/supabase/server": serverStub, "@/lib/shopAuth": authStub, "@": SRC }, interopDefault: true, cache: false });
const R = jiti(path.join(SRC, "lib/shopReceiptPdf/render.ts"));
const routes = jiti(path.join(SRC, "lib/shopReceiptPdf/access.ts"));
const customerRoute = jiti(path.join(SRC, "app/shop/orders/[id]/pdf/route.ts"));
const sellerRoute = jiti(path.join(SRC, "app/dashboard/shop/[id]/pdf/route.ts"));
const { translations } = jiti(path.join(SRC, "lib/i18n/translations.ts"));

console.error = () => {};
let pass = 0, fail = 0;
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", name, "|", String(detail).slice(0, 300)); } };
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

// ------------------------------------------------------------------------ extract the visible text of a pdf-lib document
function pdfText(bytes) {
  const raw = Buffer.from(bytes).toString("latin1");
  const out = [];
  for (const m of raw.matchAll(/(?<!end)stream\n([\s\S]*?)\nendstream/g)) { // pdf-lib writes exactly "\n"; a stripped "\r" could be the last byte of the data
    const buf = Buffer.from(m[1], "latin1");
    let text;
    try { text = zlib.inflateSync(buf).toString("latin1"); } catch { text = buf.toString("latin1"); }
    for (const t of text.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) out.push(Buffer.from(t[1], "hex").toString("latin1"));
    for (const t of text.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)) out.push(t[1]);
  }
  return out.join("\n");
}
const pageCount = (bytes) => Number((/Page \d+ \/ (\d+)/.exec(pdfText(bytes)) || [0, 0])[1]);

const ORDER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_ORDER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const receipt = (o = {}) => ({
  orderId: ORDER, orderNumber: "PO-000123", receiptNumber: "RCP-000123", status: "paid",
  createdAt: "2026-10-01T10:00:00.000Z", paidAt: "2026-10-01T10:05:00.000Z", currency: "XAF", subtotal: 12500, total: 12500,
  sellerName: "Boutique Élise", sellerUsername: "elise",
  payment: { status: "succeeded", method: "mobile money", confirmedAt: "2026-10-01T10:05:00.000Z" },
  items: [{ name: "Sac en cuir", image: null, quantity: 2, unitPrice: 5000, lineTotal: 10000, productId: "p1", isDigital: false }, { name: "Guide PDF", image: null, quantity: 1, unitPrice: 2500, lineTotal: 2500, productId: "p2", isDigital: true }],
  protection: null, ...o,
});

// ======================================================================== the PDF itself
{
  const bytes = await R.renderShopReceiptPdf(receipt(), "fr");
  const txt = pdfText(bytes);
  check("a real PDF is produced", String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-" && bytes.length > 800);
  check("the RCP receipt number is preserved exactly", /RCP-000123/.test(txt), txt.slice(0, 200));
  check("the order number is shown (PO-…), unchanged", /PO-000123/.test(txt));
  check("it is NOT labelled an invoice and carries no INV-/RCT- number", !/INV-|RCT-|FACTURE|INVOICE/i.test(txt), txt);
  check("seller, items, quantities, unit prices, line totals and total come from the existing receipt data", /Boutique/.test(txt) && /Sac en cuir/.test(txt) && /Guide PDF/.test(txt) && /5 000 FCFA/.test(txt) && /10 000 FCFA/.test(txt) && /2 500 FCFA/.test(txt) && /12 500 FCFA/.test(txt));
  check("French title and labels", /REÇU|RE.U/i.test(txt) && /Sous-total|Total/.test(txt));
  check("payment facts: status 'Paid' label and the method label from the existing translations", txt.includes(translations.fr.shopReceipt.paymentStatus.succeeded) && txt.includes("MTN Mobile Money"));
  check("it states the payment date (business time) and order date", /2026/.test(txt) && /01\/10\/2026|1 oct|01 oct|1er/i.test(txt) || /2026/.test(txt));
  const en = pdfText(await R.renderShopReceiptPdf(receipt(), "en"));
  check("English version: English labels, same RCP number, amounts in the English format", /ORDER RECEIPT/.test(en) && /Subtotal/.test(en) && /RCP-000123/.test(en) && /FCFA 12,500/.test(en), en.slice(0, 300));
  const a = await R.renderShopReceiptPdf(receipt(), "fr"), b = await R.renderShopReceiptPdf(receipt(), "fr");
  check("deterministic: the same receipt always gives the identical file", a.length === b.length && a.every((x, i) => x === b[i]));
  const emoji = await R.renderShopReceiptPdf(receipt({ items: [{ name: "Robe \u{1F457} 中文   test", image: null, quantity: 1, unitPrice: 1000, lineTotal: 1000, productId: null, isDigital: false }], sellerName: "Élise \u{1F60A}" }), "fr");
  check("emoji / non-Latin / narrow-space text in names never breaks the PDF", String.fromCharCode(...emoji.slice(0, 5)) === "%PDF-" && /Robe/.test(pdfText(emoji)));
  const many = await R.renderShopReceiptPdf(receipt({ items: Array.from({ length: 80 }, (_, i) => ({ name: `Article numéro ${i + 1} avec un nom assez long pour passer à la ligne dans la colonne description du tableau`, image: null, quantity: 1, unitPrice: 100, lineTotal: 100, productId: null, isDigital: false })), subtotal: 8000, total: 8000 }), "fr");
  check("80 items flow across several pages with the total still printed", pageCount(many) >= 2 && /8 000 FCFA/.test(pdfText(many)) && /RCP-000123/.test(pdfText(many)));
  const prot = pdfText(await R.renderShopReceiptPdf(receipt({ protection: { transactionId: "t1", status: "protected", protectedAmount: 12500, feeAmount: 500, customerTotal: 13000, awaitingConfirmation: false, disputeEligible: true, autoReleaseAt: null, refund: null } }), "en"));
  check("a Ringo Protection order also shows the same protection figures the receipt page shows", /Item price/.test(prot) && /FCFA 500/.test(prot) && /Protection fee/.test(prot), prot.slice(-300));
  check("no phone, email or internal id appears in the PDF", !/@|\+237|aaaaaaaa-aaaa|transactionId|t1\b/.test(txt));
  eq("filename is the RCP number", R.shopReceiptFilename(receipt()), "RCP-000123.pdf");
  eq("eligibility: only a succeeded payment", [R.shopReceiptEligible(receipt()), R.shopReceiptEligible(receipt({ payment: null })), R.shopReceiptEligible(receipt({ payment: { status: "pending", method: null, confirmedAt: null } })), R.shopReceiptEligible(receipt({ payment: { status: "failed", method: null, confirmedAt: null } }))], [true, false, false, false]);
  eq("language: 'en' is English, anything else is the platform default (French)", ["en", "fr", null, "de", "EN"].map(R.parseReceiptLocale), ["en", "fr", "fr", "fr", "fr"]);
}

// ======================================================================== customer route
{
  globalThis.__log = [];
  globalThis.__receipt = receipt();
  const get = (id, q = "") => customerRoute.GET(new Request(`https://ringo.test/shop/orders/${id}/pdf${q}`), { params: { id } });
  let res = await get(ORDER, "?lang=en");
  const bytes = new Uint8Array(await res.arrayBuffer());
  check("a paid receipt downloads as RCP-000123.pdf (attachment)", res.status === 200 && res.headers.get("content-type") === "application/pdf" && /attachment; filename="RCP-000123\.pdf"/.test(res.headers.get("content-disposition")) && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-");
  check("private headers: no-store, no-referrer, noindex, nosniff", /no-store/.test(res.headers.get("cache-control")) && res.headers.get("referrer-policy") === "no-referrer" && /noindex/.test(res.headers.get("x-robots-tag")) && res.headers.get("x-content-type-options") === "nosniff");
  check("the language query picks the language", /ORDER RECEIPT/.test(pdfText(bytes)));
  res = await get(ORDER);
  check("default language is French", /REÇU|RE.U/i.test(pdfText(new Uint8Array(await res.arrayBuffer()))));
  res = await get("not-a-uuid");
  eq("a malformed id is a 404 and the reader is never called", [res.status, globalThis.__log.filter((l) => l[1] === "not-a-uuid").length], [404, 0]);
  res = await get(OTHER_ORDER);
  eq("an unknown order is a 404", res.status, 404);
  globalThis.__receipt = receipt({ payment: { status: "pending", method: null, confirmedAt: null }, status: "awaiting_payment" });
  res = await get(ORDER);
  check("an unpaid order has no PDF (409, no bytes)", res.status === 409 && (await res.text()).indexOf("%PDF") < 0);
  globalThis.__receipt = receipt({ payment: null, status: "awaiting_payment" });
  eq("an order with no payment has no PDF", (await get(ORDER)).status, 409);
  globalThis.__receipt = receipt({ status: "refunded" });
  const ref = await get(ORDER);
  const refBytes = new Uint8Array(await ref.arrayBuffer());
  const refText = pdfText(refBytes);
  check("a refunded order's receipt still downloads and truthfully shows the refunded status", ref.status === 200 && /Rembours|Refunded/i.test(refText), `${ref.status} bytes=${refBytes.length} text=${refText.length} ${Buffer.from(refBytes.slice(0, 8)).toString("hex")}`);
  globalThis.__log = [];
  globalThis.__receipt = receipt();
  await get(ORDER);
  check("the route reads exactly the one existing receipt reader and nothing else", globalThis.__log.length === 1 && globalThis.__log[0][0] === "receipt");
}

// ======================================================================== seller route: existing Shop ownership/visibility
{
  const calls = [];
  const session = (user, profile, ownedRows) => ({
    auth: { getUser: async () => ({ data: { user } }) },
    from(table) {
      const q = { table, filters: [] };
      const chain = {
        select() { return chain; }, eq(c, v) { q.filters.push([c, v]); return chain; },
        single: async () => { calls.push(["single", table, q.filters]); return { data: profile, error: null }; },
        maybeSingle: async () => { calls.push(["maybeSingle", table, q.filters]); const row = (ownedRows || []).find((r) => q.filters.every(([c, v]) => r[c] === v)); return { data: row ?? null, error: null }; },
      };
      return chain;
    },
  });
  const ME = { id: "p-me", user_id: "u-me", username: "elise" };
  const get = (id, q = "") => sellerRoute.GET(new Request(`https://ringo.test/dashboard/shop/${id}/pdf${q}`), { params: { id } });
  globalThis.__receipt = receipt();
  globalThis.__log = [];

  globalThis.__session = session({ id: "u-me" }, ME, [{ id: ORDER, profile_id: "p-me" }]);
  let res = await get(ORDER, "?lang=en");
  const bytes = new Uint8Array(await res.arrayBuffer());
  check("the owner downloads their own paid order's receipt PDF (RCP number preserved)", res.status === 200 && /RCP-000123/.test(pdfText(bytes)) && /attachment; filename="RCP-000123\.pdf"/.test(res.headers.get("content-disposition")));
  check("ownership is proven by the owner-scoped read filtered by id AND the owner's profile", calls.some(([k, t, f]) => k === "maybeSingle" && t === "product_orders" && f.some(([c, v]) => c === "id" && v === ORDER) && f.some(([c, v]) => c === "profile_id" && v === "p-me")));
  check("the profile is resolved from the session user, never from the request", calls.some(([k, t, f]) => k === "single" && t === "profiles" && f.some(([c, v]) => c === "user_id" && v === "u-me")));

  globalThis.__session = session(null, null, []);
  eq("signed-out: 401", (await get(ORDER)).status, 401);
  globalThis.__session = session({ id: "u-me" }, null, []);
  eq("no profile: 404", (await get(ORDER)).status, 404);
  globalThis.__session = session({ id: "u-me" }, ME, [{ id: ORDER, profile_id: "someone-else" }]);
  const other = await get(ORDER);
  check("another seller's order is a plain 404 and the receipt reader is never reached for it", other.status === 404 && !globalThis.__log.some((l) => l[1] === ORDER && false));
  globalThis.__log = [];
  globalThis.__session = session({ id: "u-me" }, ME, [{ id: ORDER, profile_id: "someone-else" }]);
  await get(ORDER);
  eq("…proven: no receipt read happened for a non-owned order", globalThis.__log.length, 0);
  globalThis.__visible = false;
  globalThis.__session = session({ id: "u-me" }, ME, [{ id: ORDER, profile_id: "p-me" }]);
  eq("Shop section not visible for this profile: 404 (same rule as the Shop dashboard)", (await get(ORDER)).status, 404);
  globalThis.__visible = true;
  globalThis.__session = session({ id: "u-me" }, { ...ME, username: "not-elise" }, [{ id: ORDER, profile_id: "p-me" }]);
  eq("defence in depth: the receipt's seller must be the signed-in profile (else 404)", (await get(ORDER)).status, 404);
  globalThis.__session = session({ id: "u-me" }, ME, [{ id: ORDER, profile_id: "p-me" }]);
  eq("malformed id: 404 before any session read", (await get("zzz")).status, 404);
  globalThis.__receipt = receipt({ payment: { status: "pending", method: null, confirmedAt: null }, status: "awaiting_payment" });
  eq("an unpaid order has no seller PDF either (409)", (await get(ORDER)).status, 409);
  globalThis.__receipt = receipt();
  check("the seller route is not gated on the Business Toolkit (no entitlement lookup anywhere in its path)", !/resolveBookkeepingOwner|business_toolkit|bookkeeping\/access/.test(strip(read("src/lib/shopReceiptPdf/access.ts")) + strip(read("src/app/dashboard/shop/[id]/pdf/route.ts"))));
  delete globalThis.__session; delete globalThis.__receipt; delete globalThis.__visible;
  void routes;
}

// ======================================================================== static: nothing else was touched or created
{
  const files = ["src/lib/shopReceiptPdf/render.ts", "src/lib/shopReceiptPdf/access.ts", "src/app/shop/orders/[id]/pdf/route.ts", "src/app/dashboard/shop/[id]/pdf/route.ts", "src/components/shop/ShopReceiptPdfButton.tsx"];
  const code = files.map((f) => [f, strip(read(f))]);
  check("read-only: no insert/update/delete/upsert/rpc anywhere in the receipt PDF path", code.every(([, s]) => !/\.(insert|update|delete|upsert|rpc)\s*\(/.test(s)));
  check("no new bk_documents row, no bookkeeping entry: the receipt PDF path never mentions documents tables, bookkeeping or doc_* functions", code.every(([, s]) => !/bk_documents|bk_record_entry|bk_entries|doc_issue|doc_record_payment|doc_save_draft/i.test(s) && !/bookkeeping(?!\/money)/i.test(s)));
  check("no payment / settlement / checkout logic is imported", code.every(([, s]) => !/settlement|fulfillOrder|initiatePayment|checkPayment|createOrder|onOrderPaid|customer_payments|commerce_sale_earnings|fapshi/i.test(s)));
  check("the only data source is the existing getShopOrderReceiptData (no new query)", /getShopOrderReceiptData/.test(code[1][1]) && !/\.from\("(?!product_orders"|profiles")/.test(code[1][1]));
  check("it uses the shared PDF foundation (Sheet + pdf-lib standard fonts), no new library or font", /Sheet/.test(code[0][1]) && /StandardFonts\.Helvetica/.test(code[0][1]) && !/fontkit|jspdf|pdfkit|puppeteer|@pdf-lib\/fontkit|embedFont\(\s*[a-z]+Bytes/i.test(code[0][1]));
  check("the receipt number printed is the order's RCP number, never allocated or generated here", /data\.receiptNumber/.test(code[0][1]) && !/RCT-|INV-|nextNumber|bk_doc_number/.test(code[0][1]));
  const view = read("src/components/shop/ShopOrderReceiptView.tsx");
  check("the customer receipt page has a Download PDF button, shown only for a succeeded payment, pointing at the receipt's own pdf route", /data\.payment\?\.status === "succeeded"/.test(view) && /\/shop\/orders\/\$\{encodeURIComponent\(data\.orderId\)\}\/pdf/.test(view) && /r\.downloadPdf/.test(view));
  const seller = read("src/components/shop/ShopOrderDetail.tsx");
  check("the seller order page offers the PDF for paid/refunded orders only", /order\.payment === "paid" \|\| order\.payment === "refunded"/.test(seller) && /\/dashboard\/shop\/\$\{encodeURIComponent\(order\.id\)\}\/pdf/.test(seller));
  for (const lang of ["en", "fr"]) {
    const r = translations[lang].shopReceipt;
    check(`${lang}: every new PDF string exists`, ["downloadPdf", "preparingPdf", "pdfFailed", "pdfDescription", "pdfQuantity", "pdfUnitPrice", "pdfAmount", "pdfPaymentDate", "pdfOrderDate", "pdfSeller", "pdfStatus"].every((k) => typeof r[k] === "string" && r[k].length > 0) && translations[lang].shopOrders.downloadReceiptPdf && translations[lang].shopOrders.receiptPdfFailed);
  }
  check("French strings are really translated", translations.fr.shopReceipt.downloadPdf !== translations.en.shopReceipt.downloadPdf && translations.fr.shopOrders.downloadReceiptPdf !== translations.en.shopOrders.downloadReceiptPdf);
  check("the receipt is not relabelled: the receipt page still says Receipt RCP, no invoice wording in the new strings", !/invoice|facture/i.test(JSON.stringify([translations.en.shopReceipt.downloadPdf, translations.fr.shopReceipt.downloadPdf, translations.en.shopOrders.downloadReceiptPdf, translations.fr.shopOrders.downloadReceiptPdf])));

  // protected files: unchanged against HEAD (tracked) and nothing new added inside them (untracked)
  const git = (args) => execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).split("\n").filter(Boolean);
  const PROTECTED = ["src/lib/productCheckout/", "src/lib/protection/", "src/lib/fapshi.ts", "src/lib/fapshiSafety.ts", "src/lib/applyPayment.ts", "src/lib/musicReceipt.ts", "src/lib/musicOrderPayment.ts", "src/lib/shopAuth.ts", "src/lib/email/", "src/app/api/products/", "src/app/api/protection/", "src/app/api/shop/", "src/app/api/billing/", "src/app/api/music/", "src/app/api/orders/", "src/app/order/", "src/app/m/"];
  const changed = [...git(["diff", "--name-only", "HEAD"]), ...git(["ls-files", "--others", "--exclude-standard"])];
  // Phase 5 approved exactly one page-level change under src/app/order/: a metadata-only noindex on the tracking page.
  // The exemption names that single file; the rest of src/app/order/ (and every other protected path) stays protected.
  const APPROVED_METADATA_ONLY = new Set(["src/app/order/[id]/page.tsx"]);
  const hit = changed.filter((f) => !APPROVED_METADATA_ONLY.has(f.replace(/\\/g, "/")) && !isPhase16ProtectedFile(f) && PROTECTED.some((p) => f.replace(/\\/g, "/").startsWith(p)));
  check("NO protected checkout / settlement / payment / protection / receipt-reader / email / music file is modified or added", hit.length === 0, hit.join(","));
  const migrations = changed.filter((f) => /^supabase\/migrations\//.test(f) && !isPhase17Migration(f) && !isPhase18Migration(f) && !isPhase21Migration(f));
  eq("the only migration in the working tree is the Phase 3 one (Phase 1, Phase 2 and every earlier migration are untouched)", migrations, ["supabase/migrations/2026-12-03_debtors_reminders.sql"]);
}

for (const f of tmp) { try { fs.unlinkSync(f); } catch {} }
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
