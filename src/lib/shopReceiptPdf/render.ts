// PDF of an EXISTING platform Shop receipt (RCP-…). It renders the data the receipt page already shows (getShopOrderReceiptData) with
// the shared PDF foundation (pdf-lib standard fonts, the Sheet layout primitives, the exact money formatter). It is NOT a Phase 2
// document: nothing is stored, no bk_documents row exists, no number is allocated, no bookkeeping entry is made. The receipt number
// printed is the order's own RCP number, never an INV-/RCT- number, and the document is never labelled an invoice.
import { PDFDocument, StandardFonts } from "pdf-lib";
import { currencyMinorDigits } from "@/lib/bookkeeping/money";
import { translations } from "@/lib/i18n/translations";
import type { ShopReceiptData } from "@/lib/productCheckout/receipt";
import { formatDateKey, formatMoney } from "@/lib/documents/moneyFormat";
import { safeFilename } from "@/lib/documents/pdfText";
import { ACCENT, BORDER, CONTENT_W, MARGIN, MUTED, PAGE_W, SOFT, Sheet, safe, wrapText } from "@/lib/documents/pdf/layout";

export type ShopReceiptLocale = "en" | "fr";

/** A PDF is offered only for a receipt that shows a succeeded payment (the same fact the receipt page shows as "Paid"). */
export function shopReceiptEligible(data: Pick<ShopReceiptData, "payment">): boolean {
  return data.payment?.status === "succeeded";
}

export function parseReceiptLocale(value: string | null | undefined): ShopReceiptLocale {
  return value === "en" ? "en" : "fr"; // the platform default language is French
}

// The receipt reports amounts as plain numbers of the order currency; format them exactly (integer minor units, no Intl).
function minorOf(amount: number, currency: string): number {
  const digits = currencyMinorDigits(currency);
  return Math.round(amount * Math.pow(10, digits));
}

function dayKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // Business-local date is Africa/Douala (UTC+1, no DST), the same convention as the Phase 2 documents.
  const local = new Date(d.getTime() + 60 * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

export function shopReceiptFilename(data: Pick<ShopReceiptData, "receiptNumber">): string {
  return `${safeFilename(data.receiptNumber)}.pdf`;
}

export async function renderShopReceiptPdf(data: ShopReceiptData, locale: ShopReceiptLocale): Promise<Uint8Array> {
  const t = translations[locale];
  const r = t.shopReceipt;
  const p = t.protectionCheckout;
  const labels = t.documents.pdf;
  const money = (n: number) => formatMoney(minorOf(n, data.currency), data.currency, locale);

  const pdf = await PDFDocument.create({ updateMetadata: false });
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const sheet = new Sheet(pdf, regular, bold);

  // header
  sheet.draw("Ringo Connect", { size: 9, font: bold, color: MUTED });
  sheet.y -= 18;
  sheet.draw(safe(r.title).toUpperCase(), { size: 19, font: bold, color: ACCENT });
  sheet.y -= 26;
  sheet.draw(safe(r.receiptLabel(data.receiptNumber), 40), { size: 12, font: bold });
  sheet.y -= 16;
  sheet.draw(safe(r.orderLabel(data.orderNumber), 40), { size: 10, color: MUTED });
  sheet.y -= 14;
  sheet.draw(`${safe(r.pdfStatus)}: ${safe(r.status[data.status] ?? data.status)}`, { size: 10, color: MUTED });
  sheet.y -= 20;
  sheet.rule();
  sheet.y -= 14;

  // seller + dates
  sheet.draw(safe(r.pdfSeller), { size: 8, color: MUTED });
  sheet.y -= 13;
  sheet.para(safe(data.sellerName, 120), { size: 11, font: bold, maxLines: 2, lineHeight: 14 });
  sheet.y -= 4;
  const placed = dayKey(data.createdAt);
  if (placed) {
    sheet.draw(`${safe(r.pdfOrderDate)}: ${formatDateKey(placed, locale)}`, { size: 9, color: MUTED });
    sheet.y -= 13;
  }
  const paid = dayKey(data.payment?.confirmedAt ?? data.paidAt);
  if (paid) {
    sheet.draw(`${safe(r.pdfPaymentDate)}: ${formatDateKey(paid, locale)}`, { size: 9, color: MUTED });
    sheet.y -= 13;
  }
  sheet.y -= 8;

  // items
  const qtyX = MARGIN + CONTENT_W - 190;
  const unitX = MARGIN + CONTENT_W - 150;
  const descW = qtyX - MARGIN - 10;
  const header = () => {
    sheet.page.drawRectangle({ x: MARGIN, y: sheet.y - 16, width: CONTENT_W, height: 18, color: SOFT });
    sheet.draw(safe(r.pdfDescription), { x: MARGIN + 6, size: 8, font: bold, color: MUTED }, sheet.y - 3);
    sheet.draw(safe(r.pdfQuantity), { x: qtyX, width: 30, size: 8, font: bold, color: MUTED, align: "right" }, sheet.y - 3);
    sheet.draw(safe(r.pdfUnitPrice), { x: unitX, width: 60, size: 8, font: bold, color: MUTED, align: "right" }, sheet.y - 3);
    sheet.draw(safe(r.pdfAmount), { x: MARGIN, width: CONTENT_W - 6, size: 8, font: bold, color: MUTED, align: "right" }, sheet.y - 3);
    sheet.y -= 24;
  };
  header();
  for (const item of data.items) {
    const name = safe(item.name, 200) || "-";
    const lines = wrapText(regular, 10, name, descW - 6);
    sheet.ensure(Math.max(16, lines.length * 13 + 6), header);
    const top = sheet.y;
    lines.slice(0, 4).forEach((l, i) => sheet.draw(l, { x: MARGIN + 6, size: 10 }, top - i * 13));
    sheet.draw(String(item.quantity), { x: qtyX, width: 30, size: 10, align: "right" }, top);
    sheet.draw(money(item.unitPrice), { x: unitX, width: 60, size: 10, align: "right" }, top);
    sheet.draw(money(item.lineTotal), { x: MARGIN, width: CONTENT_W - 6, size: 10, align: "right" }, top);
    sheet.y = top - Math.min(lines.length, 4) * 13 - 4;
    sheet.page.drawLine({ start: { x: MARGIN, y: sheet.y + 1 }, end: { x: PAGE_W - MARGIN, y: sheet.y + 1 }, thickness: 0.5, color: BORDER });
    sheet.y -= 6;
  }

  // totals
  sheet.ensure(60);
  sheet.y -= 4;
  const row = (label: string, value: string, strong = false) => {
    sheet.ensure(18);
    sheet.draw(safe(label), { x: MARGIN, width: CONTENT_W - 130, size: strong ? 11 : 10, font: strong ? bold : regular, color: strong ? undefined : MUTED, align: "right" });
    sheet.draw(value, { x: MARGIN, width: CONTENT_W - 6, size: strong ? 11 : 10, font: strong ? bold : regular, align: "right" });
    sheet.y -= strong ? 18 : 15;
  };
  row(r.subtotal, money(data.subtotal));
  row(r.total, money(data.total), true);

  // payment (exactly the facts the receipt page shows)
  sheet.y -= 8;
  sheet.ensure(60);
  sheet.rule();
  sheet.y -= 14;
  sheet.draw(safe(r.paymentTitle).toUpperCase(), { size: 8, font: bold, color: MUTED });
  sheet.y -= 14;
  if (data.payment) {
    sheet.draw(safe(r.paymentStatus[data.payment.status] ?? data.payment.status), { size: 10 });
    sheet.y -= 14;
    const method = data.payment.method ? r.paymentMethod[data.payment.method] ?? data.payment.method : null;
    if (method) {
      sheet.draw(safe(method, 60), { size: 10, color: MUTED });
      sheet.y -= 14;
    }
  } else {
    sheet.draw(safe(r.noPayment), { size: 10, color: MUTED });
    sheet.y -= 14;
  }

  // Ringo Protection, when this order used it (same figures the receipt page shows)
  if (data.protection) {
    sheet.y -= 6;
    sheet.ensure(70);
    sheet.rule();
    sheet.y -= 14;
    sheet.draw(safe(p.badge).toUpperCase(), { size: 8, font: bold, color: MUTED });
    sheet.y -= 14;
    row(p.productAmount, money(data.protection.protectedAmount));
    row(p.protectionFee, money(data.protection.feeAmount));
    sheet.draw(safe(p.statusLabels[data.protection.status] ?? data.protection.status), { size: 10, font: bold });
    sheet.y -= 14;
  }

  sheet.finish({ footerLeft: labels.generatedWith, pageLabel: labels.page });

  pdf.setTitle(safe(`${r.title} ${data.receiptNumber}`, 120));
  pdf.setProducer("Ringo Connect");
  pdf.setCreator("Ringo Connect");
  // Deterministic: dated by the order itself, so re-downloading the same receipt gives the same file.
  const stamp = new Date(data.paidAt ?? data.createdAt);
  const when = Number.isNaN(stamp.getTime()) ? new Date(0) : stamp;
  pdf.setCreationDate(when);
  pdf.setModificationDate(when);
  return pdf.save();
}
