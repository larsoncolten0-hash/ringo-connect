// Template version 2 — invoice and receipt, for documents issued from the Record Sale release on. Same layout language as v1 (v1 is untouched, so a
// document issued with it re-renders exactly as before) plus: the business accent colour and logo frozen at issue, a "How to pay" block on invoices, a
// standalone SALE receipt (lines + total + payment method, no invoice behind it), and NO "Generated with Ringo Connect" footer (render.ts drops it for v >= 2).
import { rgb, type PDFImage } from "pdf-lib";
import { LIMITS } from "../../constants";
import { formatDateKey, formatMoney } from "../../moneyFormat";
import { balanceMinor, isOverdue } from "../../totals";
import type { DocumentLabels, DocumentModel } from "../../types";
import { ACCENT, BORDER, CONTENT_W, MARGIN, MUTED, PAGE_W, Sheet, safe } from "../layout";
import { drawTable, formatRate, partyLines, textSections, totalRow, type TemplateResult } from "./v1";

const RIGHT_X = PAGE_W - MARGIN;
const LOGO_MAX_H = 46;
const LOGO_MAX_W = 130;

export const accentColor = (hex: string | null): ReturnType<typeof rgb> => {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return ACCENT;
  const n = parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

function header(sheet: Sheet, m: DocumentModel, labels: DocumentLabels, title: string, accent: ReturnType<typeof rgb>, logo: PDFImage | null, showBilledTo: boolean): void {
  const top = sheet.y;
  const leftW = 290;
  const rightX = MARGIN + leftW + 20;
  const rightW = CONTENT_W - leftW - 20;
  if (logo) {
    const k = Math.min(LOGO_MAX_W / logo.width, LOGO_MAX_H / logo.height, 1);
    const w = logo.width * k;
    const h = logo.height * k;
    sheet.page.drawImage(logo, { x: MARGIN, y: sheet.y - h, width: w, height: h });
    sheet.y -= h + 8;
  }
  const sellerName = safe(m.seller.name, LIMITS.displayName) || safe(m.seller.legalName, LIMITS.legalName);
  sheet.para(sellerName, { x: MARGIN, width: leftW, size: 15, font: sheet.bold, color: accent, maxLines: 2, lineHeight: 19 });
  for (const l of partyLines(m.seller, labels, true)) sheet.para(l, { x: MARGIN, width: leftW, size: 9, color: MUTED, maxLines: 2, lineHeight: 12 });
  const leftEnd = sheet.y;

  sheet.y = top;
  sheet.draw(title, { x: rightX, width: rightW, size: 19, font: sheet.bold, color: accent, align: "right" });
  sheet.y -= 26;
  if (m.number) {
    sheet.draw(`${labels.number} ${safe(m.number, 40)}`, { x: rightX, width: rightW, size: 11, font: sheet.bold, align: "right" });
    sheet.y -= 16;
  }
  const statusText = safe(labels.status[m.status] ?? m.status);
  const overdue = m.todayKey ? isOverdue({ status: m.status, dueDate: m.dueDate, totalMinor: m.totalMinor, amountPaidMinor: m.amountPaidMinor }, m.todayKey) : false;
  sheet.draw(overdue ? `${statusText} - ${labels.overdue}` : statusText, { x: rightX, width: rightW, size: 9, color: overdue ? rgb(0.75, 0.15, 0.15) : MUTED, align: "right" });
  sheet.y -= 18;
  const meta: [string, string][] = [];
  if (m.issueDate) meta.push([labels.issueDate, formatDateKey(m.issueDate, m.locale)]);
  if (m.docType === "invoice" && m.dueDate) meta.push([labels.dueDate, formatDateKey(m.dueDate, m.locale)]);
  for (const [k, v] of meta) {
    sheet.draw(k, { x: rightX, size: 9, color: MUTED });
    sheet.draw(v, { x: rightX, width: rightW, size: 9, align: "right" });
    sheet.y -= 13;
  }
  sheet.y = Math.min(leftEnd, sheet.y) - 14;

  sheet.rule();
  sheet.y -= 12;
  const cust = safe(m.customer.name, LIMITS.customerName);
  if (!showBilledTo && !cust) {
    sheet.y -= 2;
    return;
  }
  sheet.draw(labels.billedTo, { size: 8, color: MUTED });
  sheet.y -= 13;
  if (cust) sheet.para(cust, { x: MARGIN, width: CONTENT_W, size: 11, font: sheet.bold, maxLines: 2, lineHeight: 14 });
  for (const l of partyLines(m.customer, labels, false)) sheet.para(l, { x: MARGIN, width: CONTENT_W, size: 9, color: MUTED, maxLines: 2, lineHeight: 12 });
  sheet.y -= 10;
}

function paymentDetailsBlock(sheet: Sheet, m: DocumentModel, labels: DocumentLabels): void {
  const d = m.branding.paymentDetails;
  if (!d) return;
  const rows: [string, string | null][] = [
    [labels.bankName, d.bankName],
    [labels.accountName, d.accountName],
    [labels.accountNumber, d.accountNumber],
    [labels.momoProvider, d.momoProvider],
    [labels.momoNumber, d.momoNumber],
  ];
  const filled = rows.filter(([, v]) => v);
  if (filled.length === 0 && !d.instructions) return;
  sheet.ensure(40 + filled.length * 13);
  sheet.draw(labels.howToPay, { size: 8, color: MUTED });
  sheet.y -= 13;
  for (const [k, v] of filled) {
    sheet.draw(k, { size: 9, color: MUTED });
    sheet.draw(safe(v, 120), { x: MARGIN + 150, size: 9 });
    sheet.y -= 13;
  }
  if (d.instructions) sheet.para(safe(d.instructions, 500, true), { size: 9, lineHeight: 12.5 });
  sheet.y -= 8;
}

function renderInvoice(sheet: Sheet, m: DocumentModel, labels: DocumentLabels, accent: ReturnType<typeof rgb>, logo: PDFImage | null): void {
  header(sheet, m, labels, labels.invoice, accent, logo, true);
  drawTable(sheet, m, labels, m.lines, true, accent);
  sheet.ensure(110);
  totalRow(sheet, labels.subtotal, formatMoney(m.subtotalMinor, m.currency, m.locale));
  if (m.discountMinor > 0) totalRow(sheet, labels.discount, `-${formatMoney(m.discountMinor, m.currency, m.locale)}`);
  if (m.taxRateBp !== null) totalRow(sheet, `${safe(m.taxLabel, LIMITS.taxLabel) || labels.tax} (${formatRate(m.taxRateBp, m.locale)})`, formatMoney(m.taxMinor, m.currency, m.locale));
  // the divider sits in the gap ABOVE the Total row (v1 drew it through the Subtotal text; v1 stays as it was so issued documents re-render identically)
  sheet.page.drawLine({ start: { x: RIGHT_X - 230, y: sheet.y + 3 }, end: { x: RIGHT_X, y: sheet.y + 3 }, thickness: 0.75, color: BORDER });
  sheet.y -= 2;
  totalRow(sheet, labels.total, formatMoney(m.totalMinor, m.currency, m.locale), { bold: true, size: 12, color: accent });
  if (m.status === "partially_paid" || m.status === "paid") totalRow(sheet, labels.amountPaid, formatMoney(m.amountPaidMinor, m.currency, m.locale));
  if (m.status === "partially_paid" || m.status === "paid" || m.status === "issued") {
    totalRow(sheet, labels.balanceDue, formatMoney(balanceMinor(m.totalMinor, m.amountPaidMinor), m.currency, m.locale), { bold: true, size: 11, color: accent });
  }
  sheet.y -= 10;
  // payment instructions only while something is still owed (a paid or void invoice does not ask for money)
  if (m.status === "issued" || m.status === "partially_paid" || m.status === "draft") paymentDetailsBlock(sheet, m, labels);
  textSections(sheet, m, labels);
}

function renderReceipt(sheet: Sheet, m: DocumentModel, labels: DocumentLabels, accent: ReturnType<typeof rgb>, logo: PDFImage | null): void {
  const p = m.payment;
  const sale = !!p?.sale;
  header(sheet, m, labels, labels.receipt, accent, logo, !sale);
  if (sale && p) {
    drawTable(sheet, m, labels, m.lines, true, accent);
    sheet.ensure(110);
    sheet.page.drawLine({ start: { x: RIGHT_X - 230, y: sheet.y + 8 }, end: { x: RIGHT_X, y: sheet.y + 8 }, thickness: 0.75, color: BORDER });
    sheet.y -= 2;
    totalRow(sheet, labels.totalPaid, formatMoney(p.amountMinor, m.currency, m.locale), { bold: true, size: 13, color: accent });
    totalRow(sheet, labels.paymentMethod, safe(labels.methods[p.method] ?? p.method, 40));
    totalRow(sheet, labels.paymentDate, formatDateKey(p.paidOn, m.locale));
    sheet.y -= 6;
    textSections(sheet, m, labels);
    return;
  }
  if (p) {
    sheet.ensure(130);
    const rows: [string, string][] = [
      [labels.paymentFor, safe(p.invoiceNumber, 40)],
      [labels.paymentDate, formatDateKey(p.paidOn, m.locale)],
      [labels.paymentMethod, safe(labels.methods[p.method] ?? p.method, 40)],
    ];
    if (p.reference) rows.push([labels.reference, safe(p.reference, LIMITS.paymentReference)]);
    for (const [k, v] of rows) {
      sheet.draw(k, { size: 9, color: MUTED });
      sheet.draw(v, { x: MARGIN, width: CONTENT_W, size: 9, align: "right" });
      sheet.y -= 14;
    }
    sheet.page.drawLine({ start: { x: MARGIN, y: sheet.y + 6 }, end: { x: RIGHT_X, y: sheet.y + 6 }, thickness: 0.75, color: BORDER });
    sheet.y -= 4;
    totalRow(sheet, labels.amountReceived, formatMoney(p.amountMinor, m.currency, m.locale), { bold: true, size: 13, color: accent });
    totalRow(sheet, labels.balanceAfter, formatMoney(p.balanceAfterMinor, m.currency, m.locale));
    sheet.y -= 4;
    sheet.para(labels.recordedByBusiness, { size: 8.5, color: MUTED });
    sheet.y -= 14;
  }
  if (m.parent && m.parent.lines.length > 0) {
    sheet.ensure(60);
    sheet.draw(`${labels.itemsOnInvoice} - ${safe(m.parent.number, 40)}`, { size: 8, color: MUTED });
    sheet.y -= 14;
    drawTable(sheet, m, labels, m.parent.lines.slice(0, 40), false, accent);
    if (m.parent.lines.length > 40) {
      sheet.draw("…", { size: 9, color: MUTED });
      sheet.y -= 12;
    }
  }
  textSections(sheet, m, labels);
}

export function renderV2(sheet: Sheet, m: DocumentModel, labels: DocumentLabels, logo: PDFImage | null = null): TemplateResult {
  const accent = accentColor(m.branding.accent);
  if (m.docType === "receipt") renderReceipt(sheet, m, labels, accent, logo);
  else renderInvoice(sheet, m, labels, accent, logo);
  const watermark = m.status === "draft" ? labels.draftWatermark : m.status === "void" ? labels.voidWatermark : null;
  return { watermark };
}
