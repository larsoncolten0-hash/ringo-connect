// Template version 1 — invoice and payment receipt. Standard fonts only (English / French). Do not edit the look of an existing
// version once documents have been issued with it: add a new version file instead, so a re-download reproduces the original.
//
// Nothing here claims tax certification or legal compliance; tax appears only when the business configured it.
import { rgb } from "pdf-lib";
import { LIMITS } from "../../constants";
import { currencyLabel, formatDateKey, formatMoney, formatNumberMinor, formatQuantityMilli } from "../../moneyFormat";
import { balanceMinor, isOverdue } from "../../totals";
import type { DocumentLabels, DocumentModel, LineModel, PartyModel } from "../../types";
import { ACCENT, BORDER, CONTENT_W, MARGIN, MUTED, PAGE_W, SOFT, Sheet, safe, wrapText } from "../layout";

export type TemplateResult = { watermark: string | null };

const RIGHT_X = PAGE_W - MARGIN;

function formatRate(bp: number, locale: "en" | "fr"): string {
  const whole = Math.trunc(bp / 100);
  const frac = String(bp % 100).padStart(2, "0").replace(/0+$/, "");
  return String(whole) + (frac ? (locale === "fr" ? "," : ".") + frac : "") + "%";
}

function partyLines(p: PartyModel, labels: DocumentLabels, seller: boolean): string[] {
  const out: string[] = [];
  const name = safe(p.name, seller ? LIMITS.displayName : LIMITS.customerName);
  if (seller && p.legalName) {
    const legal = safe(p.legalName, LIMITS.legalName);
    if (legal && legal !== name) out.push(legal);
  }
  const address = safe(p.address, seller ? LIMITS.address : LIMITS.customerAddress, true);
  if (address) out.push(...address.split("\n").slice(0, 6));
  if (p.phone) out.push(safe(p.phone, LIMITS.phone));
  if (p.email) out.push(safe(p.email, LIMITS.email));
  if (p.taxId) out.push(`${labels.taxId}: ${safe(p.taxId, LIMITS.taxId)}`);
  if (seller && p.registrationNo) out.push(`${labels.registrationNo}: ${safe(p.registrationNo, LIMITS.registrationNo)}`);
  return out.filter((l) => l.length > 0);
}

function headerBlock(sheet: Sheet, m: DocumentModel, labels: DocumentLabels, title: string): void {
  const top = sheet.y;
  const leftW = 290;
  const rightX = MARGIN + leftW + 20;
  const rightW = CONTENT_W - leftW - 20;

  // left: seller
  const sellerName = safe(m.seller.name, LIMITS.displayName) || safe(m.seller.legalName, LIMITS.legalName);
  sheet.para(sellerName, { x: MARGIN, width: leftW, size: 15, font: sheet.bold, color: ACCENT, maxLines: 2, lineHeight: 19 });
  for (const l of partyLines(m.seller, labels, true)) sheet.para(l, { x: MARGIN, width: leftW, size: 9, color: MUTED, maxLines: 2, lineHeight: 12 });
  const leftEnd = sheet.y;

  // right: title, number, status, dates
  sheet.y = top;
  sheet.draw(title, { x: rightX, width: rightW, size: 19, font: sheet.bold, color: ACCENT, align: "right" });
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

  // customer
  sheet.rule();
  sheet.y -= 12;
  sheet.draw(labels.billedTo, { size: 8, color: MUTED });
  sheet.y -= 13;
  const cust = safe(m.customer.name, LIMITS.customerName);
  if (cust) sheet.para(cust, { x: MARGIN, width: CONTENT_W, size: 11, font: sheet.bold, maxLines: 2, lineHeight: 14 });
  for (const l of partyLines(m.customer, labels, false)) sheet.para(l, { x: MARGIN, width: CONTENT_W, size: 9, color: MUTED, maxLines: 2, lineHeight: 12 });
  sheet.y -= 10;
}

type Col = { key: "desc" | "qty" | "unit" | "disc" | "tax" | "total"; w: number; label: string; right: boolean };

function tableColumns(m: DocumentModel, labels: DocumentLabels, lines: LineModel[], withMoney: boolean): Col[] {
  const showDisc = withMoney && lines.some((l) => l.discountMinor > 0);
  const showTax = withMoney && m.taxRateBp !== null;
  const unitLabel = `${labels.unitPrice}`;
  const cols: Col[] = [{ key: "desc", w: 0, label: labels.description, right: false }, { key: "qty", w: 46, label: labels.quantity, right: true }];
  if (withMoney) cols.push({ key: "unit", w: 78, label: unitLabel, right: true });
  if (showDisc) cols.push({ key: "disc", w: 66, label: labels.discount, right: true });
  if (showTax) cols.push({ key: "tax", w: 60, label: labels.tax, right: true });
  cols.push({ key: "total", w: 84, label: `${labels.amount} (${safe(currencyLabel(m.currency), 6)})`, right: true });
  cols[0].w = CONTENT_W - cols.slice(1).reduce((s, c) => s + c.w, 0);
  return cols;
}

function drawTable(sheet: Sheet, m: DocumentModel, labels: DocumentLabels, lines: LineModel[], withMoney: boolean): void {
  const cols = tableColumns(m, labels, lines, withMoney);
  const xOf = (i: number) => MARGIN + cols.slice(0, i).reduce((s, c) => s + c.w, 0);

  const header = () => {
    sheet.page.drawRectangle({ x: MARGIN, y: sheet.y - 17, width: CONTENT_W, height: 17, color: SOFT });
    cols.forEach((c, i) => {
      sheet.draw(safe(c.label, 28), { x: xOf(i) + 4, width: c.w - 8, size: 8, font: sheet.bold, color: ACCENT, align: c.right ? "right" : "left" }, sheet.y - 4);
    });
    sheet.y -= 22;
  };
  sheet.ensure(60);
  header();

  for (const l of lines) {
    const descW = cols[0].w - 8;
    let dl = wrapText(sheet.regular, 9, safe(l.description, LIMITS.description, true), descW);
    if (dl.length === 0) dl = [""];
    if (dl.length > 6) {
      dl = dl.slice(0, 6);
      let last = dl[5];
      while (last.length > 0 && sheet.regular.widthOfTextAtSize(`${last}…`, 9) > descW) last = last.slice(0, -1);
      dl[5] = `${last.trimEnd()}…`;
    }
    const rowH = dl.length * 12 + 7;
    sheet.ensure(rowH, header);
    const cell = (c: Col, i: number, text: string) => sheet.draw(text, { x: xOf(i) + 4, width: c.w - 8, size: 9, align: "right" }, sheet.y - 2);
    cols.forEach((c, i) => {
      if (c.key === "qty") cell(c, i, formatQuantityMilli(l.quantityMilli, m.locale));
      else if (c.key === "unit") cell(c, i, formatNumberMinor(l.unitPriceMinor, m.minorDigits, m.locale));
      else if (c.key === "disc") cell(c, i, l.discountMinor > 0 ? `-${formatNumberMinor(l.discountMinor, m.minorDigits, m.locale)}` : "");
      else if (c.key === "tax") cell(c, i, formatNumberMinor(l.taxMinor, m.minorDigits, m.locale));
      else if (c.key === "total") cell(c, i, formatNumberMinor(withMoney ? l.totalMinor : l.grossMinor, m.minorDigits, m.locale));
    });
    dl.forEach((line, k) => sheet.draw(line, { x: MARGIN + 4, size: 9 }, sheet.y - 2 - k * 12));
    sheet.y -= rowH;
    sheet.page.drawLine({ start: { x: MARGIN, y: sheet.y + 3 }, end: { x: RIGHT_X, y: sheet.y + 3 }, thickness: 0.5, color: BORDER });
  }
  sheet.y -= 6;
}

function totalRow(sheet: Sheet, label: string, value: string, opts: { bold?: boolean; size?: number; color?: ReturnType<typeof rgb> } = {}): void {
  const size = opts.size ?? 10;
  const font = opts.bold ? sheet.bold : sheet.regular;
  const x = RIGHT_X - 230;
  sheet.draw(label, { x, size, font, color: opts.color ?? MUTED });
  sheet.draw(value, { x, width: 230, size, font, align: "right", color: opts.color });
  sheet.y -= size + 6;
}

function textSections(sheet: Sheet, m: DocumentModel, labels: DocumentLabels): void {
  for (const [label, body, max] of [
    [labels.notes, m.notes, LIMITS.notes],
    [labels.terms, m.terms, LIMITS.terms],
  ] as [string, string | null, number][]) {
    const text = safe(body, max, true);
    if (!text) continue;
    sheet.ensure(40);
    sheet.draw(label, { size: 8, color: MUTED });
    sheet.y -= 13;
    sheet.para(text, { size: 9, lineHeight: 12.5 });
    sheet.y -= 8;
  }
}

function renderInvoice(sheet: Sheet, m: DocumentModel, labels: DocumentLabels): void {
  headerBlock(sheet, m, labels, labels.invoice);
  drawTable(sheet, m, labels, m.lines, true);

  sheet.ensure(110);
  totalRow(sheet, labels.subtotal, formatMoney(m.subtotalMinor, m.currency, m.locale));
  if (m.discountMinor > 0) totalRow(sheet, labels.discount, `-${formatMoney(m.discountMinor, m.currency, m.locale)}`);
  if (m.taxRateBp !== null) totalRow(sheet, `${safe(m.taxLabel, LIMITS.taxLabel) || labels.tax} (${formatRate(m.taxRateBp, m.locale)})`, formatMoney(m.taxMinor, m.currency, m.locale));
  sheet.page.drawLine({ start: { x: RIGHT_X - 230, y: sheet.y + 8 }, end: { x: RIGHT_X, y: sheet.y + 8 }, thickness: 0.75, color: BORDER });
  sheet.y -= 2;
  totalRow(sheet, labels.total, formatMoney(m.totalMinor, m.currency, m.locale), { bold: true, size: 12, color: ACCENT });
  if (m.status === "partially_paid" || m.status === "paid") {
    totalRow(sheet, labels.amountPaid, formatMoney(m.amountPaidMinor, m.currency, m.locale));
    totalRow(sheet, labels.balanceDue, formatMoney(balanceMinor(m.totalMinor, m.amountPaidMinor), m.currency, m.locale), { bold: true, size: 11, color: ACCENT });
  } else if (m.status === "issued") {
    totalRow(sheet, labels.balanceDue, formatMoney(balanceMinor(m.totalMinor, m.amountPaidMinor), m.currency, m.locale), { bold: true, size: 11, color: ACCENT });
  }
  sheet.y -= 10;
  textSections(sheet, m, labels);
}

function renderReceipt(sheet: Sheet, m: DocumentModel, labels: DocumentLabels): void {
  headerBlock(sheet, m, labels, labels.receipt);
  const p = m.payment;
  if (p) {
    sheet.ensure(130);
    const rows: [string, string, boolean][] = [
      [labels.paymentFor, safe(p.invoiceNumber, 40), false],
      [labels.paymentDate, formatDateKey(p.paidOn, m.locale), false],
      [labels.paymentMethod, safe(labels.methods[p.method] ?? p.method, 40), false],
    ];
    if (p.reference) rows.push([labels.reference, safe(p.reference, LIMITS.paymentReference), false]);
    for (const [k, v] of rows) {
      sheet.draw(k, { size: 9, color: MUTED });
      sheet.draw(v, { x: MARGIN, width: CONTENT_W, size: 9, align: "right" });
      sheet.y -= 14;
    }
    sheet.page.drawLine({ start: { x: MARGIN, y: sheet.y + 6 }, end: { x: RIGHT_X, y: sheet.y + 6 }, thickness: 0.75, color: BORDER });
    sheet.y -= 4;
    totalRow(sheet, labels.amountReceived, formatMoney(p.amountMinor, m.currency, m.locale), { bold: true, size: 13, color: ACCENT });
    totalRow(sheet, labels.balanceAfter, formatMoney(p.balanceAfterMinor, m.currency, m.locale));
    sheet.y -= 4;
    sheet.para(labels.recordedByBusiness, { size: 8.5, color: MUTED });
    sheet.y -= 14;
  }
  if (m.parent && m.parent.lines.length > 0) {
    sheet.ensure(60);
    sheet.draw(`${labels.itemsOnInvoice} - ${safe(m.parent.number, 40)}`, { size: 8, color: MUTED });
    sheet.y -= 14;
    drawTable(sheet, m, labels, m.parent.lines.slice(0, 40), false);
    if (m.parent.lines.length > 40) {
      sheet.draw("…", { size: 9, color: MUTED });
      sheet.y -= 12;
    }
  }
  textSections(sheet, m, labels);
}

export function renderV1(sheet: Sheet, m: DocumentModel, labels: DocumentLabels): TemplateResult {
  if (m.docType === "receipt") renderReceipt(sheet, m, labels);
  else renderInvoice(sheet, m, labels);
  const watermark = m.status === "draft" ? labels.draftWatermark : m.status === "void" ? labels.voidWatermark : null;
  return { watermark };
}
