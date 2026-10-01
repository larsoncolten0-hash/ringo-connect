// Business Toolkit Phase 5 (reports): the monthly report PDF. It renders the ReportModel built by buildMonthlyReport() and nothing else, so the
// PDF and the dashboard can never disagree. No new dependency: pdf-lib with the standard fonts, the same A4 Sheet, colours, footer and safe-text
// helpers as the invoice PDFs (those templates are NOT touched). Output is deterministic for a given model (fixed metadata dates).
// Text is passed through safe() (WinAnsi only, hostile text neutralised); money uses the ASCII-only formatMoney() the invoices use.
import { PDFDocument, StandardFonts } from "pdf-lib";
import { translations } from "@/lib/i18n/translations";
import { currencyLabel, formatDateKey, formatMoney } from "@/lib/documents/moneyFormat";
import { ACCENT, BORDER, CONTENT_W, INK, MARGIN, MUTED, PAGE_W, SOFT, Sheet, safe, textWidth, wrapText } from "@/lib/documents/pdf/layout";
import { safeFilename } from "@/lib/documents/pdfText";
import type { ReportModel } from "./build";
import type { ReportLang } from "./period";

const VALUE_W = 150;
const AGING_ORDER = ["not_due", "no_due_date", "d1_30", "d31_60", "d61_90", "d90_plus"];

export async function renderReportPdf(model: ReportModel, lang: ReportLang): Promise<Uint8Array> {
  const t = translations[lang].reports;
  const L = t.labels;
  const money = (minor: number, currency = model.currency) => formatMoney(minor, currency, lang);

  const pdf = await PDFDocument.create({ updateMetadata: false });
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const sheet = new Sheet(pdf, regular, bold);

  const monthName = t.months[model.period.month - 1] ?? String(model.period.month);
  const rangeText = `${formatDateKey(model.period.from, lang)} - ${formatDateKey(model.period.to, lang)}`;
  const generated = model.generatedAt.slice(0, 10);

  // ---------------------------------------------------------------- header
  const top = sheet.y;
  const leftW = 300;
  sheet.para(safe(model.business.name, 120) || safe(model.business.legalName, 160), { width: leftW, size: 15, font: bold, color: ACCENT, maxLines: 2, lineHeight: 19 });
  const bits: string[] = [];
  if (model.business.legalName && model.business.legalName !== model.business.name) bits.push(safe(model.business.legalName, 160));
  if (model.business.address) bits.push(...safe(model.business.address, 300, true).split("\n").slice(0, 4));
  if (model.business.phone) bits.push(safe(model.business.phone, 40));
  if (model.business.email) bits.push(safe(model.business.email, 200));
  if (model.business.taxId) bits.push(`${L.taxId}: ${safe(model.business.taxId, 60)}`);
  if (model.business.registrationNo) bits.push(`${L.registrationNo}: ${safe(model.business.registrationNo, 60)}`);
  for (const b of bits.filter(Boolean)) sheet.para(b, { width: leftW, size: 9, color: MUTED, maxLines: 2, lineHeight: 12 });
  const leftEnd = sheet.y;
  sheet.y = top;
  const rightX = MARGIN + leftW + 20, rightW = CONTENT_W - leftW - 20;
  sheet.draw(safe(L.reportTitle), { x: rightX, width: rightW, size: 18, font: bold, color: ACCENT, align: "right" });
  sheet.y -= 25;
  sheet.draw(safe(`${monthName} ${model.period.year}`), { x: rightX, width: rightW, size: 12, font: bold, align: "right" });
  sheet.y -= 16;
  sheet.draw(safe(rangeText), { x: rightX, width: rightW, size: 9, color: MUTED, align: "right" });
  sheet.y -= 12;
  if (model.period.kind === "month_to_date") {
    sheet.draw(safe(L.monthToDate), { x: rightX, width: rightW, size: 9, color: MUTED, align: "right" });
    sheet.y -= 12;
  }
  sheet.draw(safe(`${L.generatedOn} ${formatDateKey(generated, lang)}`), { x: rightX, width: rightW, size: 9, color: MUTED, align: "right" });
  sheet.y -= 12;
  sheet.draw(safe(`${L.reportRef} ${model.fingerprint}`), { x: rightX, width: rightW, size: 9, color: MUTED, align: "right" });
  sheet.y = Math.min(sheet.y, leftEnd) - 10;
  sheet.rule();
  sheet.gap(8);
  sheet.para(safe(L.currencyNote(currencyLabel(model.currency))), { size: 8.5, color: MUTED });
  sheet.gap(6);

  // ---------------------------------------------------------------- building blocks
  const heading = (title: string) => {
    sheet.ensure(60);
    sheet.gap(10);
    sheet.page.drawRectangle({ x: MARGIN, y: sheet.y - 18, width: CONTENT_W, height: 18, color: SOFT });
    sheet.draw(safe(title), { x: MARGIN + 6, size: 10.5, font: bold, color: ACCENT }, sheet.y - 3);
    sheet.y -= 26;
  };
  const row = (label: string, value: string, o: { bold?: boolean; indent?: number; muted?: boolean } = {}) => {
    const size = 9.5;
    const font = o.bold ? bold : regular;
    const x = MARGIN + (o.indent ?? 0);
    const lines = wrapText(font, size, safe(label), CONTENT_W - VALUE_W - (o.indent ?? 0) - 12);
    sheet.ensure(14 * lines.length + 2);
    lines.forEach((line, i) => {
      sheet.draw(line, { x, size, font, color: o.muted ? MUTED : INK }, sheet.y);
      if (i === 0 && value) sheet.draw(safe(value), { x: PAGE_W - MARGIN - VALUE_W, width: VALUE_W, size, font, align: "right", color: o.muted ? MUTED : INK }, sheet.y);
      sheet.y -= 13;
    });
    sheet.y -= 1;
  };
  const note = (text: string) => {
    sheet.para(safe(text), { size: 8.5, color: MUTED, lineHeight: 11.5 });
    sheet.gap(3);
  };
  const totalRule = () => {
    sheet.ensure(8);
    sheet.rule(BORDER);
    sheet.gap(4);
  };

  // ---------------------------------------------------------------- 1. summary
  heading(L.secSummary);
  row(L.revenue, money(model.revenue.totalMinor), { bold: true });
  row(L.expensesRecorded, money(model.expenses.totalMinor), { bold: true });
  row(L.netCash, money(model.cash.netMovementMinor), { bold: true });
  note(L.profitNote);

  // ---------------------------------------------------------------- 2. revenue
  heading(L.secRevenue);
  row(L.onlineGross, money(model.revenue.onlineGrossMinor));
  row(L.invoicePayments, money(model.revenue.invoicePaymentsMinor));
  row(L.manualSales, money(model.revenue.manualSalesMinor));
  row(L.otherIncome, money(model.revenue.otherIncomeMinor));
  totalRule();
  row(L.totalRevenue, money(model.revenue.totalMinor), { bold: true });
  row(L.paidOnlineOrders, String(model.counts.paidOnlineOrders), { muted: true });
  row(L.invoicePaymentCount, String(model.counts.invoicePayments), { muted: true });
  row(L.manualSaleCount, String(model.counts.manualSales), { muted: true });
  if (model.uncollected.salesMinor > 0) row(L.uncollectedSales, money(model.uncollected.salesMinor), { muted: true });
  if (model.uncollected.otherIncomeMinor > 0) row(L.uncollectedOther, money(model.uncollected.otherIncomeMinor), { muted: true });
  note(L.revenueNote);

  // ---------------------------------------------------------------- 3. online
  heading(L.secOnline);
  row(L.grossOnline, money(model.online.grossMinor));
  row(L.commission, money(model.online.commissionMinor));
  row(L.netEarnings, money(model.online.netMinor), { bold: true });
  row(L.netPaidOut, money(model.online.netPaidOutMinor), { indent: 8, muted: true });
  row(L.netNotPaidOut, money(model.online.netNotYetPaidOutMinor), { indent: 8, muted: true });
  note(L.onlineNote);
  if (model.online.ordersWithoutEarnings > 0) note(L.missingEarnings(model.online.ordersWithoutEarnings, money(model.online.grossWithoutEarningsMinor)));
  sheet.gap(2);
  sheet.ensure(40);
  sheet.draw(safe(L.topProducts), { size: 9.5, font: bold }, sheet.y);
  sheet.y -= 14;
  if (model.topProducts.length === 0) note(L.noOnlineSales);
  else {
    const colU = PAGE_W - MARGIN - VALUE_W - 40, colG = PAGE_W - MARGIN - VALUE_W + 20;
    const head = () => {
      sheet.page.drawRectangle({ x: MARGIN, y: sheet.y - 13, width: CONTENT_W, height: 14, color: SOFT });
      sheet.draw(safe(L.colProduct), { x: MARGIN + 4, size: 8.5, font: bold, color: MUTED }, sheet.y - 2);
      sheet.draw(safe(L.colUnits), { x: colU, width: 40, size: 8.5, font: bold, color: MUTED, align: "right" }, sheet.y - 2);
      sheet.draw(safe(L.colGross), { x: colG, width: PAGE_W - MARGIN - colG, size: 8.5, font: bold, color: MUTED, align: "right" }, sheet.y - 2);
      sheet.y -= 18;
    };
    head();
    for (const p of model.topProducts) {
      sheet.ensure(16, head);
      const name = safe(p.name, 70);
      let n = name;
      while (n.length > 1 && textWidth(regular, 9, n) > colU - MARGIN - 14) n = n.slice(0, -1);
      sheet.draw(n === name ? n : `${n.trimEnd()}...`, { x: MARGIN + 4, size: 9 }, sheet.y);
      sheet.draw(String(p.units), { x: colU, width: 40, size: 9, align: "right" }, sheet.y);
      sheet.draw(safe(money(p.grossMinor)), { x: colG, width: PAGE_W - MARGIN - colG, size: 9, align: "right" }, sheet.y);
      sheet.y -= 14;
    }
    note(L.topNote);
  }
  if (model.refundedOrders.count > 0) {
    sheet.ensure(40);
    sheet.draw(safe(L.refundedTitle), { size: 9.5, font: bold }, sheet.y);
    sheet.y -= 14;
    note(L.refundedBody(model.refundedOrders.count, money(model.refundedOrders.grossMinor)));
  }

  // ---------------------------------------------------------------- 4. expenses
  heading(L.secExpenses);
  if (model.expenses.totalMinor === 0 && model.expenses.unpaidMinor === 0) note(L.noExpenses);
  else {
    row(L.operatingExpenses, money(model.expenses.operatingMinor));
    row(L.stockPurchases, money(model.expenses.stockPurchasesMinor));
    totalRule();
    row(L.totalExpenses, money(model.expenses.totalMinor), { bold: true });
    if (model.expenses.unpaidMinor > 0) row(L.unpaidExpenses, money(model.expenses.unpaidMinor), { muted: true });
    if (model.expenses.byCategory.length > 0) {
      sheet.gap(2);
      sheet.draw(safe(L.byCategory), { size: 9.5, font: bold }, sheet.y);
      sheet.y -= 14;
      for (const c of model.expenses.byCategory) row(L.categoryNames[c.category] ?? safe(c.category, 60), money(c.minor), { indent: 8 });
    }
    note(L.expensesNote);
  }

  // ---------------------------------------------------------------- 5. cash
  heading(L.secCash);
  row(L.cashDirect, money(model.cash.receivedDirectMinor));
  row(L.cashPaidOut, `- ${money(model.cash.paidOutMinor)}`);
  totalRule();
  row(L.netCash, money(model.cash.netMovementMinor), { bold: true });
  note(L.cashNote);

  // ---------------------------------------------------------------- 6. invoices and debtors (as of the generation date)
  heading(L.secReceivables);
  if (model.invoicing.available) {
    row(L.invoicedTitle, L.invoicedBody(model.invoicing.issuedCount, money(model.invoicing.issuedTotalMinor)));
    note(L.invoicedNote);
  }
  if (!model.receivables.available) note(L.receivablesUnavailable);
  else {
    note(L.asOf(formatDateKey(model.receivables.asOfDate, lang)));
    if (model.receivables.currencies.length === 0) note(L.noReceivables);
    for (const c of model.receivables.currencies) {
      row(`${L.outstanding} (${currencyLabel(c.currency)})`, formatMoney(c.outstandingMinor, c.currency, lang), { bold: true });
      row(`${L.overdue} (${currencyLabel(c.currency)})`, formatMoney(c.overdueMinor, c.currency, lang));
      row(L.invoiceCount, String(c.invoiceCount), { muted: true });
      for (const b of AGING_ORDER) {
        const a = c.aging[b];
        if (a && (a.minor > 0 || a.count > 0)) row(`${L.aging[b]} (${a.count})`, formatMoney(a.minor, c.currency, lang), { indent: 8, muted: true });
      }
    }
  }

  // ---------------------------------------------------------------- 7. inventory (as of the generation date)
  heading(L.secInventory);
  if (!model.inventory.available) note(L.inventoryUnavailable);
  else if (model.inventory.tracked === 0 && model.inventory.legacy === 0) note(L.invNone);
  else {
    note(L.asOf(formatDateKey(model.inventory.asOfDate, lang)));
    row(L.invTracked, String(model.inventory.tracked));
    row(L.invOk, String(model.inventory.ok), { indent: 8 });
    row(L.invLow, String(model.inventory.low), { indent: 8 });
    row(L.invOut, String(model.inventory.out), { indent: 8 });
    row(L.invLegacy, String(model.inventory.legacy), { muted: true });
    row(L.invValue, money(model.inventory.estimatedValueMinor), { muted: true });
    note(L.invValueNote);
    if (model.inventory.valueExcluded > 0) note(L.invValueExcluded(model.inventory.valueExcluded));
    if (model.inventory.lowStockItems.length > 0) {
      sheet.gap(2);
      sheet.ensure(30);
      sheet.draw(safe(L.lowStockList), { size: 9.5, font: bold }, sheet.y);
      sheet.y -= 14;
      for (const i of model.inventory.lowStockItems) row(`${safe(i.name, 70)} (${L.onHand}: ${i.count ?? 0})`, i.state === "out" ? L.invOut : L.invLow, { indent: 8 });
    }
  }

  // ---------------------------------------------------------------- 8. notes
  heading(L.secNotes);
  const ex = model.exclusions;
  let any = false;
  if (ex.voidedEntries > 0) { note(L.excVoided(ex.voidedEntries)); any = true; }
  if (ex.otherCurrency > 0) { note(L.excCurrency(ex.otherCurrency, currencyLabel(model.currency))); any = true; }
  if (ex.doubleCountPrevented > 0) { note(L.excDouble(ex.doubleCountPrevented)); any = true; }
  if (ex.unreadable > 0) { note(L.excUnreadable(ex.unreadable)); any = true; }
  if (!any) note(L.noExclusions);
  note(L.restateNote);
  note(L.disclaimer);

  sheet.finish({ footerLeft: safe(`${L.generatedWith}  |  ${L.reportRef} ${model.fingerprint}`), pageLabel: (n, total) => safe(L.page(n, total)) });

  pdf.setTitle(safe(`${L.reportTitle} ${monthName} ${model.period.year}`, 120));
  pdf.setProducer("Ringo Connect");
  pdf.setCreator("Ringo Connect");
  const stamp = new Date(model.generatedAt);
  const when = Number.isNaN(stamp.getTime()) ? new Date(0) : stamp;
  pdf.setCreationDate(when);
  pdf.setModificationDate(when);
  return pdf.save();
}

export async function renderReportPdfSafe(model: ReportModel, lang: ReportLang): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; error: string }> {
  try {
    return { ok: true, bytes: await renderReportPdf(model, lang) };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e).slice(0, 200) };
  }
}

export function reportFilename(model: ReportModel): string {
  const mm = String(model.period.month).padStart(2, "0");
  return `${safeFilename(`ringo-report-${model.period.year}-${mm}${model.period.kind === "month_to_date" ? "-to-date" : ""}`, "report")}.pdf`;
}
