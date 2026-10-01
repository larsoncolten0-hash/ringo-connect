// Business Toolkit Phase 2 — the shared documents library (src/lib/documents): numbering, exact totals, safe PDF text,
// money formatting, snapshot building and PDF rendering. Pure: no network, no database, no payments.
//   Run:  node scripts/tests/documents.test.mjs
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const jiti = require("jiti")(import.meta.url, { alias: { "@": SRC }, interopDefault: true });
const { PDFDocument, StandardFonts } = require("pdf-lib");
const D = (f) => jiti(path.join(SRC, "lib/documents", f));
const N = D("numbering.ts"), T = D("totals.ts"), P = D("pdfText.ts"), M = D("moneyFormat.ts"), S = D("snapshot.ts"), C = D("constants.ts");
const R = D("pdf/render.ts");
const { translations } = jiti(path.join(SRC, "lib/i18n/translations.ts"));
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8").replace(/\r\n/g, "\n");

let pass = 0, fail = 0;
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", name, "|", detail); } };
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

// ======================================================================= numbering
eq("INV number", N.formatDocumentNumber("invoice", 2026, 1), "INV-2026-0001");
eq("RCT number", N.formatDocumentNumber("receipt", 2026, 42), "RCT-2026-0042");
eq("number grows past 4 digits, never truncates", N.formatDocumentNumber("invoice", 2026, 12345), "INV-2026-12345");
eq("platform receipts keep their own RCP- prefix: it is not producible here", Object.values(C.NUMBER_PREFIX).includes("RCP"), false);
eq("parse round trip", N.parseDocumentNumber("RCT-2027-0003"), { type: "receipt", year: 2027, seq: 3 });
check("parse rejects foreign numbers", N.parseDocumentNumber("RCP-000123") === null && N.parseDocumentNumber("INV-26-1") === null && N.parseDocumentNumber("inv-2026-0001") === null);
for (const bad of [[1999, 1], [3000, 1], [2026, 0], [2026, 1.5]]) { let t = false; try { N.formatDocumentNumber("invoice", ...bad); } catch { t = true; } check(`format rejects ${bad}`, t); }
eq("quotation is not an implemented type", [...C.DOCUMENT_TYPES], ["invoice", "receipt"]);

// ======================================================================= exact totals
{
  const L = (o, cur = "XAF", rate = null) => T.computeLine(o, cur, rate);
  let r = L({ quantity: "2", unitPrice: "1500", discount: "500" }, "XAF", 1900);
  eq("XAF: 2 x 1500, discount 500, 19% => gross 3000 net 2500 tax 475 total 2975", r.line, { grossMinor: 3000, discountMinor: 500, taxMinor: 475, totalMinor: 2975 });
  eq("half-up: 0.5 x 1001 = 500.5 -> 501", L({ quantity: "0.5", unitPrice: "1001" }).line.grossMinor, 501);
  eq("half-up: 0.499 x 1000 = 499 (no rounding needed)", L({ quantity: "0.499", unitPrice: "1000" }).line.grossMinor, 499);
  eq("tax tie rounds up: 10 x 5% = 0.5 -> 1", L({ quantity: "1", unitPrice: "10" }, "XAF", 500).line.taxMinor, 1);
  eq("tax tie rounds up: 30 x 5% = 1.5 -> 2", L({ quantity: "1", unitPrice: "30" }, "XAF", 500).line.taxMinor, 2);
  eq("tax below tie rounds down: 29 x 5% = 1.45 -> 1", L({ quantity: "1", unitPrice: "29" }, "XAF", 500).line.taxMinor, 1);
  eq("USD: 3 x 19.99 = 59.97, 7.5% tax = 4.49775 -> 4.50", L({ quantity: "3", unitPrice: "19.99" }, "USD", 750).line, { grossMinor: 5997, discountMinor: 0, taxMinor: 450, totalMinor: 6447 });
  eq("KWD: 1.5 x 1.234 = 1.851, 5% = 0.09255 -> 0.093", L({ quantity: "1.5", unitPrice: "1.234" }, "KWD", 500).line, { grossMinor: 1851, discountMinor: 0, taxMinor: 93, totalMinor: 1944 });
  eq("tax OFF by default (null rate) adds nothing", L({ quantity: "1", unitPrice: "1000" }).line.taxMinor, 0);
  eq("a 0% rate is allowed and adds nothing", L({ quantity: "1", unitPrice: "1000" }, "XAF", 0).line.taxMinor, 0);
  for (const [name, o, err] of [
    ["zero quantity", { quantity: "0", unitPrice: "10" }, "invalid_quantity"],
    ["negative quantity", { quantity: "-1", unitPrice: "10" }, "invalid_quantity"],
    ["exponent quantity", { quantity: "1e3", unitPrice: "10" }, "invalid_quantity"],
    ["4-decimal quantity", { quantity: "1.0001", unitPrice: "10" }, "invalid_quantity"],
    ["fractional XAF price (would round)", { quantity: "1", unitPrice: "10.5" }, "invalid_unit_price"],
    ["negative price", { quantity: "1", unitPrice: "-5" }, "invalid_unit_price"],
    ["fractional XAF discount", { quantity: "1", unitPrice: "100", discount: "0.5" }, "invalid_discount"],
    ["discount above the line amount", { quantity: "1", unitPrice: "100", discount: "101" }, "discount_exceeds_amount"],
  ]) check(`rejects ${name}`, L(o).ok === false && L(o).error === err, JSON.stringify(L(o)));
  check("rejects tax rate above 100%", L({ quantity: "1", unitPrice: "10" }, "XAF", 10001).error === "invalid_tax_rate");
  eq("an amount beyond the exact range is refused, not silently wrong", L({ quantity: "999999999", unitPrice: "9999999999" }).error, "amount_too_large");
  eq("free line (price 0) is allowed", L({ quantity: "3", unitPrice: "0" }).line.totalMinor, 0);

  const doc = T.computeDocument([{ quantity: "2", unitPrice: "1500", discount: "500" }, { quantity: "1", unitPrice: "2500" }], "XAF", 1900);
  eq("document: sums of the line results", [doc.totals.subtotalMinor, doc.totals.discountMinor, doc.totals.taxMinor, doc.totals.totalMinor], [5500, 500, 950, 5950]);
  check("document identity: total = subtotal - discount + tax", doc.totals.totalMinor === doc.totals.subtotalMinor - doc.totals.discountMinor + doc.totals.taxMinor);
  eq("document: first bad line is reported", T.computeDocument([{ quantity: "1", unitPrice: "1" }, { quantity: "x", unitPrice: "1" }], "XAF", null).lineIndex, 1);
  eq("101 lines refused", T.computeDocument(Array.from({ length: 101 }, () => ({ quantity: "1", unitPrice: "1" })), "XAF", null).error, "too_many_lines");
  eq("100 lines accepted", T.computeDocument(Array.from({ length: 100 }, () => ({ quantity: "1", unitPrice: "1" })), "XAF", null).ok, true);
  // randomised identity check (exact arithmetic must hold for any input)
  let bad = 0;
  for (let i = 0; i < 400; i++) {
    const cur = ["XAF", "USD", "KWD"][i % 3];
    const dg = cur === "XAF" ? 0 : cur === "USD" ? 2 : 3;
    const price = (Math.floor(Math.random() * 10 ** (dg + 4)) / 10 ** dg).toFixed(dg);
    const qty = (1 + Math.floor(Math.random() * 20000)) / 1000;
    const rate = i % 2 ? Math.floor(Math.random() * 3000) : null;
    const d = T.computeDocument([{ quantity: String(qty), unitPrice: price }, { quantity: "1", unitPrice: price }], cur, rate);
    if (!d.ok || d.totals.totalMinor !== d.totals.subtotalMinor - d.totals.discountMinor + d.totals.taxMinor || d.totals.lines.some((l) => l.totalMinor !== l.grossMinor - l.discountMinor + l.taxMinor)) bad++;
  }
  eq("400 random documents keep every identity exact", bad, 0);

  eq("balance never negative", [T.balanceMinor(1000, 400), T.balanceMinor(1000, 1000), T.balanceMinor(1000, 1200)], [600, 0, 0]);
  const od = (o) => T.isOverdue({ status: "issued", dueDate: "2026-09-01", totalMinor: 1000, amountPaidMinor: 0, ...o }, "2026-10-01");
  check("overdue is calculated from due date and balance", od({}) && od({ status: "partially_paid", amountPaidMinor: 400 }));
  check("not overdue: due today / future / paid / void / draft / no due date", !od({ dueDate: "2026-10-01" }) && !od({ dueDate: "2026-11-01" }) && !od({ status: "paid", amountPaidMinor: 1000 }) && !od({ status: "void" }) && !od({ status: "draft" }) && !od({ dueDate: null }));
  eq("quantity parsing", [T.parseQuantityMilli("2"), T.parseQuantityMilli("2.5"), T.parseQuantityMilli(0.125), T.parseQuantityMilli("0")], [2000, 2500, 125, null]);
}

// ======================================================================= safe PDF text
{
  const t = P.toPdfText;
  eq('DB "Chukwudi 😊" -> PDF "Chukwudi"', t("Chukwudi 😊"), "Chukwudi");
  eq("narrow no-break spaces become ASCII spaces", t("12 000 FCFA"), "12 000 FCFA");
  eq("no-break space and thin space too", t("a b c"), "a b c");
  const french = "L’Étoile d’Or œuvre Ça va — “bonjour” €5 …";
  eq("French accents, apostrophes, oe ligature, dashes, quotes, euro are kept", t(french), french);
  eq("Yoruba: base-letter fallback (O, S), already-encodable accents stay", t("Ọálá Ṣadé"), "Oálá Sadé");
  eq("Arabic name becomes a visible ?", t("محمد"), "?");
  eq("run of unsupported letters is one ?", t("A محمد B"), "A ? B");
  eq("CJK", t("张伟"), "?");
  eq("currency sign outside WinAnsi becomes ?", t("₦500"), "?500");
  eq("ZWJ family emoji dropped entirely", t("👨‍👩‍👧"), "");
  eq("emoji with variation selector dropped", t("Shop 🛍️"), "Shop");
  eq("flags and keycaps dropped", t("a🇸🇳b 1️⃣"), "ab 1");
  eq("control characters removed", t("a\u0000b\u0007c\u007fd"), "abcd");
  eq("lone surrogate removed", t("a\ud800b"), "ab");
  eq("newlines collapse to a space in single-line mode", t("a\r\n\r\nb"), "a b");
  eq("multiline keeps at most one blank line", t("a\r\n\r\n\r\n\r\nb", { multiline: true }), "a\n\nb");
  eq("length cap ends in an ellipsis", t("x".repeat(50), { maxLength: 10 }), "xxxxxxxxx…");
  eq("null / undefined / objects are empty, never throw", [t(null), t(undefined), t({}), t([])], ["", "", "", ""]);
  eq("numbers stringify", t(12000), "12000");
  eq("filename is restricted", P.safeFilename("INV-2026-0001"), "INV-2026-0001");
  eq("hostile filename", P.safeFilename('../..\\x"; rm -rf / .pdf'), "x_rm_-rf_.pdf");
  eq("empty filename falls back", P.safeFilename("😊"), "document");
  const corpus = ["Chukwudi 😊", french, "Ọálá", "محمد x", "a\u0000b", "  many   spaces  "];
  check("idempotent: sanitising twice equals once", corpus.every((s) => t(t(s)) === t(s)));

  // PROPERTY: whatever goes in, the real standard font can draw what comes out.
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  // The renderer splits multiline text on "\n" BEFORE drawing (wrapText), so the contract is: every LINE is drawable.
  const drawable = (s) => s.split("\n").every((line) => { try { font.widthOfTextAtSize(line, 10); bold.widthOfTextAtSize(line, 10); return true; } catch { return false; } });
  let bmpBad = 0;
  for (let cp = 0; cp <= 0xffff; cp++) if (!drawable(t(String.fromCharCode(cp)))) bmpBad++;
  eq("EVERY BMP code point (incl. lone surrogates) sanitises to something the font can draw", bmpBad, 0);
  let astralBad = 0;
  for (let cp = 0x10000; cp <= 0x2ffff; cp += 7) if (!drawable(t(String.fromCodePoint(cp)))) astralBad++;
  eq("sampled astral code points too", astralBad, 0);
  let fuzzBad = 0, encBad = 0;
  for (let i = 0; i < 1500; i++) {
    let s = "";
    const n = Math.floor(Math.random() * 40);
    for (let k = 0; k < n; k++) s += String.fromCodePoint(Math.random() < 0.3 ? Math.floor(Math.random() * 0x300) : Math.floor(Math.random() * 0x2ffff));
    const out = t(s, { multiline: i % 2 === 0, maxLength: i % 3 === 0 ? 12 : undefined });
    if (!drawable(out)) fuzzBad++;
    if ([...out].some((ch) => ch !== "\n" && !P.isPdfEncodable(ch.codePointAt(0)))) encBad++;
  }
  eq("1,500 random strings: always drawable", fuzzBad, 0);
  eq("1,500 random strings: only WinAnsi characters in the output", encBad, 0);
  check("isPdfEncodable agrees with the real font for every Latin-1/WinAnsi code point", (() => { for (let cp = 0x20; cp <= 0x2200; cp++) { const ok = P.isPdfEncodable(cp); let real = true; try { font.widthOfTextAtSize(String.fromCodePoint(cp), 10); } catch { real = false; } if (ok && !real) return false; } return true; })());
}

// ======================================================================= money / quantity / date formatting
{
  const f = M.formatMoney;
  eq("fr XAF", f(12000, "XAF", "fr"), "12 000 FCFA");
  eq("en XAF", f(12000, "XAF", "en"), "FCFA 12,000");
  eq("XOF is also FCFA", f(500, "XOF", "fr"), "500 FCFA");
  eq("fr USD", f(123450, "USD", "fr"), "1 234,50 USD");
  eq("en USD", f(123450, "USD", "en"), "USD 1,234.50");
  eq("fr KWD 3 decimals", f(1234, "KWD", "fr"), "1,234 KWD");
  eq("en KWD 3 decimals", f(1234, "KWD", "en"), "KWD 1.234");
  eq("small USD amount keeps leading zero", f(5, "USD", "fr"), "0,05 USD");
  eq("zero", f(0, "XAF", "fr"), "0 FCFA");
  eq("negative", f(-5000, "XAF", "fr"), "-5 000 FCFA");
  eq("millions group correctly", f(1234567890, "XAF", "fr"), "1 234 567 890 FCFA");
  eq("an inexact (unsafe) integer prints ? instead of a wrong number", M.formatNumberMinor(Number.MAX_SAFE_INTEGER + 2, 0, "fr"), "?");
  const doc = await PDFDocument.create(); const font = await doc.embedFont(StandardFonts.Helvetica);
  const samples = [f(12000, "XAF", "fr"), f(123450, "USD", "fr"), f(-1234, "KWD", "fr"), f(99999999999, "XAF", "en")];
  check("every formatted amount is pure ASCII and drawable (no U+202F)", samples.every((s) => /^[\x20-\x7e]+$/.test(s)) && samples.every((s) => { try { font.widthOfTextAtSize(s, 10); return true; } catch { return false; } }));
  eq("quantities", [M.formatQuantityMilli(2000, "en"), M.formatQuantityMilli(2500, "fr"), M.formatQuantityMilli(125, "en"), M.formatQuantityMilli(1, "fr")], ["2", "2,5", "0.125", "0,001"]);
  eq("dates", [M.formatDateKey("2026-10-01", "en"), M.formatDateKey("2026-10-01", "fr"), M.formatDateKey("2026-02-14", "fr"), M.formatDateKey("garbage", "en"), M.formatDateKey("2026-13-01", "en"), M.formatDateKey(null, "en")], ["1 Oct 2026", "1 oct. 2026", "14 févr. 2026", "", "", ""]);
}

// ======================================================================= snapshot builder (stored rows -> model)
const seller = { display_name: "Boutique Élise 🛍️", legal_name: "Élise SARL", address: "12 rue de la Paix\nDouala", phone: "+237 600 000 000", email: "shop@example.cm", tax_id: "M0123", registration_no: "RC/DLA/2020" };
const customer = { name: "Chukwudi 😊", phone: "+237 677 000 000", email: "c@example.com", address: "Akwa Douala", tax_id: null };
const baseDoc = (o = {}) => ({ id: "d1", doc_type: "invoice", status: "issued", number: "INV-2026-0001", number_year: 2026, number_seq: 1, issue_date: "2026-10-01", due_date: "2026-10-15", currency: "XAF", locale: "fr", seller_snapshot: seller, customer_snapshot: customer, type_snapshot: null, subtotal: "5500.000", discount_total: "500.000", tax_label: "TVA", tax_rate_bp: 1900, tax_total: "950.000", total: "5950.000", amount_paid: "0.000", notes: "Merci 🙏", terms: null, template_version: 1, ...o });
const baseLines = [
  { position: 2, description: "Service É", quantity: "1.000", unit_price: "2500.000", gross_amount: "2500.000", discount_amount: "0.000", tax_amount: "475.000", line_total: "2975.000" },
  { position: 1, description: "Article 😊", quantity: "2.000", unit_price: "1500.000", gross_amount: "3000.000", discount_amount: "500.000", tax_amount: "475.000", line_total: "2975.000" },
];
{
  const m = S.modelFromRows({ doc: baseDoc(), lines: baseLines });
  eq("lines are ordered by position and parsed exactly", m.lines.map((l) => [l.position, l.quantityMilli, l.unitPriceMinor, l.totalMinor]), [[1, 2000, 1500, 2975], [2, 1000, 2500, 2975]]);
  eq("totals parsed from numeric text", [m.subtotalMinor, m.discountMinor, m.taxMinor, m.totalMinor, m.amountPaidMinor], [5500, 500, 950, 5950, 0]);
  check("STORED TEXT IS NEVER SANITISED: emoji and U+202F survive in the model", m.customer.name === "Chukwudi 😊" && m.seller.name === "Boutique Élise 🛍️" && m.customer.address === "Akwa Douala" && m.lines[0].description === "Article 😊" && m.notes === "Merci 🙏");
  eq("seller and customer mapping", [m.seller.taxId, m.seller.registrationNo, m.customer.taxId, m.taxLabel, m.taxRateBp], ["M0123", "RC/DLA/2020", null, "TVA", 1900]);
  const r = S.modelFromRows({ doc: baseDoc({ doc_type: "receipt", number: "RCT-2026-0001", subtotal: "2000.000", discount_total: "0.000", tax_total: "0.000", total: "2000.000", tax_label: null, tax_rate_bp: null, type_snapshot: { method: "mobile_money", reference: "TX 12", paid_on: "2026-10-02", amount: "2000.000", balance_after: "3950.000", invoice_number: "INV-2026-0001" } }), lines: [baseLines[1]], parent: { doc: baseDoc(), lines: baseLines } });
  eq("receipt carries the frozen payment facts and the parent's lines", [r.payment.method, r.payment.amountMinor, r.payment.balanceAfterMinor, r.payment.invoiceNumber, r.parent.number, r.parent.lines.length], ["mobile_money", 2000, 3950, "INV-2026-0001", "INV-2026-0001", 2]);
  let threw = false; try { S.modelFromRows({ doc: baseDoc({ total: "12.5" }), lines: baseLines }); } catch { threw = true; }
  check("an unreadable stored amount throws instead of rendering a wrong document", threw);
  threw = false; try { S.modelFromRows({ doc: baseDoc({ doc_type: "quotation" }), lines: [] }); } catch { threw = true; }
  check("an unknown document type is refused", threw);
  eq("USD numbers given as JSON numbers parse exactly", S.modelFromRows({ doc: baseDoc({ currency: "USD", subtotal: 1234.5, discount_total: 0, tax_total: 0, total: 1234.5, tax_rate_bp: null, tax_label: null }), lines: [] }).totalMinor, 123450);
}

// ======================================================================= PDF rendering end to end
const hostile = () => {
  const model = S.modelFromRows({ doc: baseDoc(), lines: baseLines });
  return { ...model, todayKey: "2026-10-20" };
};
const pages = async (bytes) => (await PDFDocument.load(bytes)).getPageCount();
{
  const m = hostile();
  for (const locale of ["fr", "en"]) {
    const bytes = await R.renderDocumentPdf({ ...m, locale });
    check(`invoice (${locale}) renders to a real PDF`, Buffer.from(bytes).subarray(0, 5).toString() === "%PDF-" && bytes.length > 1500);
  }
  check("rendering is deterministic: the same model gives the same bytes", Buffer.compare(Buffer.from(await R.renderDocumentPdf(m)), Buffer.from(await R.renderDocumentPdf(m))) === 0);
  check("draft, void, partially paid and paid all render", await Promise.all(["draft", "void", "partially_paid", "paid"].map((status) => R.renderDocumentPdf({ ...m, status, number: status === "draft" ? null : m.number, issueDate: status === "draft" ? null : m.issueDate, amountPaidMinor: status === "paid" ? m.totalMinor : 2000 }))).then((a) => a.length === 4));

  // hostile content: 100 lines, 300-char tokens with no spaces, 300-char multi-line addresses, emoji and non-Latin names, tax and discounts
  const long = "W".repeat(300);
  const many = Array.from({ length: 100 }, (_, i) => ({ position: i + 1, description: i % 3 === 0 ? long : `Ligne ${i + 1} 😊 محمد ${"mot ".repeat(40)}`, quantityMilli: 1500 + i, unitPriceMinor: 1000 + i, grossMinor: 1500, discountMinor: 100, taxMinor: 266, totalMinor: 1666 }));
  const big = { ...m, lines: many, customer: { ...m.customer, name: "张伟 😊 " + "N".repeat(150), address: ("Rue très longue  ".repeat(15) + "\n").repeat(8) }, seller: { ...m.seller, name: "محمد 🛍️ " + "S".repeat(200), address: "A".repeat(300) }, notes: "Né ".repeat(250), terms: "T".repeat(1000) };
  const bytes = await R.renderDocumentPdf(big);
  const n = await pages(bytes);
  check("100 hostile lines paginate across several pages without crashing", n >= 4, `pages=${n}`);
  check("French locale with narrow no-break spaces everywhere renders", Buffer.from(await R.renderDocumentPdf({ ...big, locale: "fr" })).subarray(0, 5).toString() === "%PDF-");

  const receipt = S.modelFromRows({ doc: baseDoc({ doc_type: "receipt", number: "RCT-2026-0001", subtotal: "2000.000", discount_total: "0.000", tax_total: "0.000", total: "2000.000", tax_label: null, tax_rate_bp: null, type_snapshot: { method: "bank_transfer", reference: "Ref 😊 0001", paid_on: "2026-10-02", amount: "2000.000", balance_after: "3950.000", invoice_number: "INV-2026-0001" } }), lines: [baseLines[1]], parent: { doc: baseDoc(), lines: baseLines } });
  for (const locale of ["fr", "en"]) check(`receipt (${locale}) renders`, Buffer.from(await R.renderDocumentPdf({ ...receipt, locale })).subarray(0, 5).toString() === "%PDF-");
  const rBig = { ...receipt, parent: { number: "INV-2026-0001", lines: many }, payment: { ...receipt.payment, reference: "م".repeat(100) } };
  check("a receipt whose invoice has 100 lines renders (reference list is capped)", (await pages(await R.renderDocumentPdf(rBig))) >= 1);

  let err = null; try { await R.renderDocumentPdf({ ...m, templateVersion: 99 }); } catch (e) { err = e.message; }
  check("an unknown template version is an error, never a different layout", /unsupported document template version 99/.test(err || ""));
  const safeRes = await R.renderDocumentPdfSafe({ ...m, templateVersion: 99 });
  check("renderDocumentPdfSafe turns that into a result, not an exception", safeRes.ok === false && /unsupported/.test(safeRes.error));
  eq("only template version 1 exists", R.supportedTemplateVersions(), [1]);

  // fuzz: random hostile text in every field never crashes the renderer
  const rs = (max) => { let s = ""; const k = Math.floor(Math.random() * max); for (let i = 0; i < k; i++) s += String.fromCodePoint(Math.random() < 0.4 ? 32 + Math.floor(Math.random() * 200) : Math.floor(Math.random() * 0x2ffff)); return s; };
  let fuzzFail = 0;
  for (let i = 0; i < 60; i++) {
    const fm = { ...(i % 2 ? receipt : m), locale: i % 3 ? "fr" : "en", seller: { name: rs(80), legalName: rs(80), address: rs(200), phone: rs(30), email: rs(60), taxId: rs(30), registrationNo: rs(30) }, customer: { name: rs(80), legalName: null, address: rs(200), phone: rs(30), email: rs(60), taxId: rs(30), registrationNo: null }, notes: rs(300), terms: rs(300), taxLabel: rs(20), lines: m.lines.map((l) => ({ ...l, description: rs(200) })) };
    if (fm.payment) fm.payment = { ...fm.payment, reference: rs(60) };
    try { await R.renderDocumentPdf(fm); } catch { fuzzFail++; }
  }
  eq("60 fully random documents never crash the renderer", fuzzFail, 0);
}

// ======================================================================= bilingual labels + isolation from payment code
{
  const keys = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? keys(v, `${p}${k}.`) : [`${p}${k}`])).sort();
  eq("documents.pdf has identical keys in English and French", keys(translations.fr.documents.pdf), keys(translations.en.documents.pdf));
  check("every label is a non-empty string or function in both languages", ["en", "fr"].every((l) => Object.values(translations[l].documents.pdf).every((v) => typeof v === "function" || typeof v === "object" || (typeof v === "string" && v.length > 0))));
  check("all five payment methods and five statuses are labelled in both languages", ["en", "fr"].every((l) => ["cash", "mobile_money", "bank_transfer", "card", "other"].every((k) => translations[l].documents.pdf.methods[k]) && ["draft", "issued", "partially_paid", "paid", "void"].every((k) => translations[l].documents.pdf.status[k])));
  check("French labels are actually French", translations.fr.documents.pdf.invoice === "FACTURE" && translations.en.documents.pdf.invoice === "INVOICE");
  const files = fs.readdirSync(path.join(SRC, "lib/documents"), { recursive: true }).filter((f) => String(f).endsWith(".ts")).map((f) => read(`src/lib/documents/${f}`));
  check("the documents library never imports payment, checkout or order code", files.every((s) => !/productCheckout|customer_payments|commerce_sale_earnings|settlement|fapshi|stripe|protection|musicReceipt/i.test(s.replace(/\/\/.*$/gm, ""))));
  const names = fs.readdirSync(path.join(SRC, "lib/documents"), { recursive: true }).filter((f) => String(f).endsWith(".ts")).map((f) => String(f).replace(/\\/g, "/"));
  const importsServer = names.filter((n) => /supabase\/server/.test(read(`src/lib/documents/${n}`).replace(/\/\/.*$/gm, "")));
  check("only access.ts (the page/nav gate) touches the server database client; the calculation, PDF and handler code stays free of it", importsServer.join() === "access.ts", importsServer.join());
  check("no BigInt literals (project target is ES2017)", files.every((s) => !/\b\d+n\b/.test(s.replace(/\/\/.*$/gm, ""))));
  check("the music receipt route is unchanged by this library (no import of it)", files.every((s) => !/receipt-pdf/.test(s.replace(/\/\/.*$/gm, ""))));
}

// ======================================================================= static checks on the Phase 2 migration text (NOT applied)
{
  const raw = read("supabase/migrations/2026-12-02_documents_invoices_receipts.sql");
  const stripSql = (s) => s.replace(/--.*$/gm, "");
  const main = stripSql(raw).split(/\ncommit;/i)[0];
  const NEW = ["bk_business_profiles", "bk_documents", "bk_document_lines", "bk_document_counters", "bk_document_payments", "bk_document_events", "bk_document_shares", "bk_document_rate_events"];
  const alters = [...main.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?(\w+)/gi)].map((m) => m[1]);
  check("migration alters ONLY the new tables (no existing table, not even plans)", alters.length > 0 && alters.every((t) => NEW.includes(t)), alters.join(","));
  check("migration never mentions an existing payment, order, earnings or protection object in executable SQL", !/\b(customer_payments|commerce_sale_earnings|product_orders|product_order_items|music_orders|music_order_items|restaurant|protection_|payment_transactions|platform_settings|commerce_rate_limit_hit|commerce_rate_events|settleProductPayment|fapshi|stripe)\b/i.test(main) && !/\borders\b/i.test(main));
  check("migration only READS profiles, users, plans and products (no insert/update/delete on them)", !/\b(insert\s+into|update|delete\s+from)\s+(public\.)?(profiles|users|plans|products)\b/i.test(main));
  check("no DROP or TRUNCATE before commit; the only DELETEs are draft-line replacement (trigger-restricted to drafts) and the rate limiter's own counters; drop trigger only on new tables", !/\bdrop\s+(table|column|function|policy|index|constraint|schema|type)\b/i.test(main) && [...main.matchAll(/^\s*delete\s+from\s+(\w+)/gim)].every((m) => m[1] === "bk_document_rate_events" || m[1] === "bk_document_lines") && !/^\s*truncate\b/im.test(main) && [...main.matchAll(/drop trigger if exists \w+ on (\w+)/gi)].every((m) => NEW.includes(m[1])));
  check("no CASCADE in the executable migration (the rollback is checked separately)", !/cascade/i.test(main), "");
  check("single transaction, with a fail-fast Phase 1 dependency check at the top", /^\s*begin;/im.test(main) && /\ncommit;/i.test(raw) && main.indexOf("Phase 2 requires the Phase 1") > 0 && main.indexOf("Phase 2 requires the Phase 1") < main.indexOf("create table"));
  check("no GRANT of insert/update/delete/truncate to any role", !/grant\s+[^;]*\b(insert|update|delete|truncate|all)\b[^;]*\bto\b/i.test(main));
  check("every client role is revoked on every new table before the SELECT grants", /revoke all on bk_business_profiles, bk_documents, bk_document_lines, bk_document_counters, bk_document_payments, bk_document_events,\s+bk_document_shares, bk_document_rate_events from anon, authenticated, service_role;/.test(main));
  check("RLS is enabled on all eight tables", NEW.every((t) => new RegExp(`alter table ${t} enable row level security`, "i").test(main)));
  check("only owner-read policies exist (no policy for insert/update/delete/all, none for staff)", [...main.matchAll(/create policy "[^"]+" on (\w+) for (\w+)/gi)].every((m) => m[2].toLowerCase() === "select") && !/organization_members|has_org_permission|is_admin|is_org_member/.test(main));
  const defined = [...main.matchAll(/create or replace function (\w+)\(/gi)].map((m) => m[1]);
  const revokeList = (main.match(/'bk_doc_number'[\s\S]*?'bk_document_shares_guard'\)/) || [""])[0];
  check("every function the migration defines is covered by the explicit EXECUTE revoke loop", defined.length >= 29 && defined.every((f) => revokeList.includes(`'${f}'`)), JSON.stringify(defined.filter((f) => !revokeList.includes(`'${f}'`))));
  const SECDEF = ["bk_doc_gate", "doc_save_draft", "doc_issue", "doc_record_payment", "doc_void_payment", "doc_void_document", "doc_create_share", "doc_revoke_share", "doc_resolve_share", "bk_doc_rate_limit_hit", "doc_upsert_business_profile"];
  check("every service-role entry point is SECURITY DEFINER with a pinned search_path", SECDEF.every((f) => new RegExp(`function ${f}\\([\\s\\S]*?security definer set search_path = public, pg_temp as \\$\\$`).test(main)));
  check("every entry point starts with the owner/plan/demo gate (resolve_share and the rate limiter are the two token/anonymous helpers)", ["doc_save_draft", "doc_issue", "doc_record_payment", "doc_void_payment", "doc_void_document", "doc_create_share", "doc_revoke_share", "doc_upsert_business_profile"].every((f) => new RegExp(`function ${f}\\([\\s\\S]*?begin\\s+(?:--[^\\n]*\\n\\s*)*(?:v_currency := |perform )bk_doc_gate\\(`).test(main)));
  check("record_payment writes the bookkeeping entry through the existing Phase 1 function with a fresh unique request id", /bk_record_entry\(p_profile_id, p_actor_user_id, 'sale', p_amount, p_paid_on, 'invoice_payment', v_inv\.number, true, null, null, null, v_payment_id\)/.test(main) && /v_payment_id uuid := gen_random_uuid\(\)/.test(main));
  check("record_payment does not call anything outside Phase 1/2 and never writes bk_entries directly", !/insert\s+into\s+bk_entries|update\s+bk_entries/i.test(main));
  check("issue and payment never read the client's currency, date of issue or number", !/p_currency|p_number|p_issue_date/.test(main));
  check("numbers are allocated only through the counter upsert (one place)", (main.match(/insert into bk_document_counters/g) || []).length === 1);
  const rbl = raw.split("-- ROLLBACK")[1].split("\n").filter((l) => /^--\s{3}\S/.test(l)).map((l) => l.replace(/^--\s+/, ""));
  const allowedDrops = new Set([...NEW, ...defined, "bk_doc_hash"]);
  check("rollback drops only Phase 2 objects, by exact name, with no CASCADE", rbl.filter((l) => /^drop /i.test(l)).every((l) => allowedDrops.has((l.match(/^drop (?:function|table) if exists (\w+)/i) || [])[1])) && !rbl.some((l) => /cascade/i.test(l)) && !rbl.some((l) => /^alter /i.test(l)), rbl.join(" | ").slice(0, 200));
  check("rollback drops functions that use a table's row type BEFORE that table", rbl.findIndex((l) => /bk_doc_issue_core/.test(l)) < rbl.findIndex((l) => /drop table if exists bk_documents;/.test(l)) && rbl.findIndex((l) => /bk_doc_hash_of/.test(l)) < rbl.findIndex((l) => /drop table if exists bk_documents;/.test(l)));
  const pre = stripSql(read("supabase/support/2026-12-02_documents_invoices_receipts.preflight.sql")).replace(/'[^']*'/g, "");
  check("the preflight file is read-only", !/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/i.test(pre));
  check("the migration states it is proposed and not applied, and names its design document", /NOT APPLIED/.test(raw) && /business-toolkit-phase2-invoices-receipts\.md/.test(raw));
  check("quotation is not present in the schema (not built in Phase 2)", !/quotation/i.test(main));
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
