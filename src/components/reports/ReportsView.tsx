"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, ChevronDown, Clock, Download, Loader2, Wallet, type LucideIcon } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { periodOptions, previousCompletedMonth } from "@/lib/reports/period";
import type { ReportModel } from "@/lib/reports/build";
import { callApi, inputClass, labelClass, primaryButton, secondaryButton, useFormat, useReportErrorText } from "./shared";

const AGING = ["not_due", "no_due_date", "d1_30", "d31_60", "d61_90", "d90_plus"];

/** The monthly report. Every figure is built on the server by the same function that builds the PDF; this screen only formats it. */
export default function ReportsView() {
  const { t, locale } = useLanguage();
  const u = t.reports.ui;
  const L = t.reports.labels;
  const errorText = useReportErrorText();
  const fmt = useFormat();
  const options = useMemo(() => periodOptions(new Date()), []);
  const defaultValue = useMemo(() => { const p = previousCompletedMonth(new Date()); return `${p.year}-${p.month}`; }, []);
  const [value, setValue] = useState(defaultValue);
  const [report, setReport] = useState<ReportModel | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // the PDF language follows the app language until the person picks one (the saved language is applied after the first render)
  const [pdfChoice, setPdfChoice] = useState<"en" | "fr" | null>(null);
  const pdfLang: "en" | "fr" = pdfChoice ?? (locale === "en" ? "en" : "fr");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState("");

  const monthLabel = (year: number, month: number) => u.periodTitle(t.reports.months[month - 1], year);
  const [year, month] = value.split("-").map(Number);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const res = await callApi("GET", `/api/reports/monthly?year=${year}&month=${month}`);
    setLoading(false);
    if (!res.ok) { setReport(null); return setError(errorText(res.data)); }
    setReport(res.data.report);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month]);
  useEffect(() => { load(); }, [load]);

  const download = async () => {
    setPdfBusy(true);
    setPdfError("");
    try {
      const res = await fetch(`/api/reports/monthly/pdf?year=${year}&month=${month}&lang=${pdfLang}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setPdfError(errorText(data));
      } else {
        const blob = await res.blob();
        const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") || "")?.[1] || `ringo-report-${year}-${String(month).padStart(2, "0")}.pdf`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch {
      setPdfError(t.reports.errors.network);
    }
    setPdfBusy(false);
  };

  const cur = report?.currency ?? "XAF";
  const M = (minor: number, currency = cur) => fmt.money(minor, currency);
  // what customers still owe, in the report's own currency (the server's figure; shown only when there is something owed)
  const outstanding = report?.receivables.available ? report.receivables.currencies.find((c) => c.currency === cur)?.outstandingMinor ?? 0 : 0;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-xl font-medium text-ringo-text">{u.title}</h1>
        <p className="mt-1 text-sm text-ringo-muted">{u.intro}</p>
      </div>

      <div className="flex flex-col gap-3 rounded-card border border-ringo-border p-4 sm:flex-row sm:items-end">
        <label className={`${labelClass} sm:min-w-[260px]`}>{u.month}
          <select className={inputClass} value={value} onChange={(e) => setValue(e.target.value)}>
            {options.map((o) => (
              <option key={`${o.year}-${o.month}`} value={`${o.year}-${o.month}`}>
                {o.kind === "month_to_date" ? u.monthToDateOption(monthLabel(o.year, o.month)) : monthLabel(o.year, o.month)}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>{u.pdfLanguage}
          <select className={inputClass} value={pdfLang} onChange={(e) => setPdfChoice(e.target.value === "en" ? "en" : "fr")}>
            <option value="fr">Français</option>
            <option value="en">English</option>
          </select>
        </label>
        <button className={primaryButton} disabled={pdfBusy || !report} onClick={download}>
          {pdfBusy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
          {pdfBusy ? u.downloading : u.download}
        </button>
      </div>
      {pdfError && <p role="alert" className="rounded-card bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-400">{pdfError}</p>}

      {loading && <p className="flex items-center gap-2 text-sm text-ringo-muted"><Loader2 size={14} className="animate-spin" />{u.loading}</p>}
      {error && (
        <div role="alert" className="flex flex-col gap-2 rounded-card bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-400">
          <p>{error}</p>
          <div><button className={secondaryButton} onClick={load}>{u.retry}</button></div>
        </div>
      )}

      {report && !loading && (
        <div className="flex flex-col gap-5" data-testid="report">
          <div className="text-xs text-ringo-muted">
            <p className="text-sm font-medium text-ringo-text">
              {report.period.kind === "month_to_date" ? `${monthLabel(report.period.year, report.period.month)} (${L.monthToDate})` : monthLabel(report.period.year, report.period.month)} · {fmt.day(report.period.from)} - {fmt.day(report.period.to)}
            </p>
            <p>{u.generatedAt(fmt.day(report.generatedAt.slice(0, 10)))} · {u.reference} {report.fingerprint}</p>
            <p>{u.shownIn(cur)}</p>
          </div>

          <section aria-label={u.keyFigures} className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi icon={ArrowDownLeft} tone="in" label={L.revenue} value={M(report.revenue.totalMinor)} />
              <Kpi icon={ArrowUpRight} tone="out" label={L.expensesRecorded} value={M(report.expenses.totalMinor)} />
              <Kpi icon={Wallet} tone="net" label={L.netCash} value={M(report.cash.netMovementMinor)} />
              {outstanding > 0 && <Kpi icon={Clock} tone="owed" label={L.outstanding} value={M(outstanding)} />}
            </div>
            {/* how to read the numbers: the profit and net-cash notes stay on the page, one tap away */}
            <details className="text-xs text-ringo-muted">
              <summary className="inline-flex min-h-[44px] cursor-pointer items-center">{u.howToRead}</summary>
              <div className="flex flex-col gap-1.5 pb-2">
                <p>{u.howToReadBody}</p>
                <Note>{L.profitNote}</Note>
              </div>
            </details>
          </section>

          {report.revenue.totalMinor === 0 && report.expenses.totalMinor === 0 && (
            <div className="flex flex-col items-start gap-1 rounded-2xl border border-dashed border-ringo-border p-5">
              <p className="font-display text-base font-medium text-ringo-text">{u.emptyTitle}</p>
              <p className="text-sm text-ringo-muted">{u.emptyBody}</p>
              <Link href="/dashboard/bookkeeping" className={`${primaryButton} mt-2`}>{u.emptyCta}</Link>
            </div>
          )}

          <h2 className="-mb-2 text-xs font-medium uppercase tracking-wider text-ringo-muted">{u.details}</h2>

          <Section title={L.secRevenue} value={M(report.revenue.totalMinor)}>
            <Row label={L.onlineGross} value={M(report.revenue.onlineGrossMinor)} />
            <Row label={L.invoicePayments} value={M(report.revenue.invoicePaymentsMinor)} />
            <Row label={L.manualSales} value={M(report.revenue.manualSalesMinor)} />
            <Row label={L.otherIncome} value={M(report.revenue.otherIncomeMinor)} />
            <Row label={L.totalRevenue} value={M(report.revenue.totalMinor)} bold />
            <Row label={L.paidOnlineOrders} value={String(report.counts.paidOnlineOrders)} muted />
            <Row label={L.invoicePaymentCount} value={String(report.counts.invoicePayments)} muted />
            <Row label={L.manualSaleCount} value={String(report.counts.manualSales)} muted />
            {report.uncollected.salesMinor > 0 && <Row label={L.uncollectedSales} value={M(report.uncollected.salesMinor)} muted />}
            {report.uncollected.otherIncomeMinor > 0 && <Row label={L.uncollectedOther} value={M(report.uncollected.otherIncomeMinor)} muted />}
            <Note>{L.revenueNote}</Note>
          </Section>

          <Section title={L.secOnline} value={M(report.online.netMinor)}>
            <Row label={L.grossOnline} value={M(report.online.grossMinor)} />
            <Row label={L.commission} value={M(report.online.commissionMinor)} />
            <Row label={L.netEarnings} value={M(report.online.netMinor)} bold />
            <Row label={L.netPaidOut} value={M(report.online.netPaidOutMinor)} indent muted />
            <Row label={L.netNotPaidOut} value={M(report.online.netNotYetPaidOutMinor)} indent muted />
            <Note>{L.onlineNote}</Note>
            {report.online.ordersWithoutEarnings > 0 && <Note>{L.missingEarnings(report.online.ordersWithoutEarnings, M(report.online.grossWithoutEarningsMinor))}</Note>}
            <h3 className="mt-2 text-sm font-medium text-ringo-text">{L.topProducts}</h3>
            {report.topProducts.length === 0 ? <Note>{L.noOnlineSales}</Note> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-ringo-muted"><th className="py-1 pr-2 font-medium">{L.colProduct}</th><th className="px-2 text-right font-medium">{L.colUnits}</th><th className="pl-2 text-right font-medium">{L.colGross}</th></tr></thead>
                  <tbody>{report.topProducts.map((p, i) => <tr key={i} className="border-t border-ringo-border"><td className="py-1.5 pr-2">{p.name}</td><td className="px-2 text-right">{p.units}</td><td className="pl-2 text-right whitespace-nowrap">{M(p.grossMinor)}</td></tr>)}</tbody>
                </table>
              </div>
            )}
            {report.topProducts.length > 0 && <Note>{L.topNote}</Note>}
            {report.refundedOrders.count > 0 && (
              <div className="rounded-card bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
                <p className="font-medium">{L.refundedTitle}</p>
                <p className="mt-1">{L.refundedBody(report.refundedOrders.count, M(report.refundedOrders.grossMinor))}</p>
              </div>
            )}
          </Section>

          <Section title={L.secExpenses} value={M(report.expenses.totalMinor)}>
            {report.expenses.totalMinor === 0 && report.expenses.unpaidMinor === 0 ? <Note>{L.noExpenses}</Note> : (
              <>
                <Row label={L.operatingExpenses} value={M(report.expenses.operatingMinor)} />
                <Row label={L.stockPurchases} value={M(report.expenses.stockPurchasesMinor)} />
                <Row label={L.totalExpenses} value={M(report.expenses.totalMinor)} bold />
                {report.expenses.unpaidMinor > 0 && <Row label={L.unpaidExpenses} value={M(report.expenses.unpaidMinor)} muted />}
                {report.expenses.byCategory.length > 0 && (
                  <>
                    <h3 className="mt-2 text-sm font-medium text-ringo-text">{L.byCategory}</h3>
                    {report.expenses.byCategory.map((c) => <Row key={c.category} label={L.categoryNames[c.category] ?? c.category} value={M(c.minor)} indent />)}
                  </>
                )}
                <Note>{L.expensesNote}</Note>
              </>
            )}
          </Section>

          <Section title={L.secCash} value={M(report.cash.netMovementMinor)}>
            <Row label={L.cashDirect} value={M(report.cash.receivedDirectMinor)} />
            <Row label={L.cashPaidOut} value={`- ${M(report.cash.paidOutMinor)}`} />
            <Row label={L.netCash} value={M(report.cash.netMovementMinor)} bold />
            <Note>{L.cashNote}</Note>
          </Section>

          <Section title={L.secReceivables}>
            {report.invoicing.available && <><Row label={L.invoicedTitle} value={L.invoicedBody(report.invoicing.issuedCount, M(report.invoicing.issuedTotalMinor))} /><Note>{L.invoicedNote}</Note></>}
            {!report.receivables.available ? <Note>{L.receivablesUnavailable}</Note> : (
              <>
                <Note>{L.asOf(fmt.day(report.receivables.asOfDate))}</Note>
                {report.receivables.currencies.length === 0 && <Note>{L.noReceivables}</Note>}
                {report.receivables.currencies.map((c) => (
                  <div key={c.currency} className="flex flex-col gap-1">
                    <Row label={`${L.outstanding} (${c.currency})`} value={M(c.outstandingMinor, c.currency)} bold />
                    <Row label={`${L.overdue} (${c.currency})`} value={M(c.overdueMinor, c.currency)} />
                    <Row label={L.invoiceCount} value={String(c.invoiceCount)} muted />
                    {AGING.filter((b) => c.aging[b] && (c.aging[b].minor > 0 || c.aging[b].count > 0)).map((b) => <Row key={b} label={`${L.aging[b]} (${c.aging[b].count})`} value={M(c.aging[b].minor, c.currency)} indent muted />)}
                  </div>
                ))}
              </>
            )}
          </Section>

          <Section title={L.secInventory}>
            {!report.inventory.available ? <Note>{L.inventoryUnavailable}</Note> : report.inventory.tracked === 0 && report.inventory.legacy === 0 ? <Note>{L.invNone}</Note> : (
              <>
                <Note>{L.asOf(fmt.day(report.inventory.asOfDate))}</Note>
                <Row label={L.invTracked} value={String(report.inventory.tracked)} />
                <Row label={L.invOk} value={String(report.inventory.ok)} indent />
                <Row label={L.invLow} value={String(report.inventory.low)} indent />
                <Row label={L.invOut} value={String(report.inventory.out)} indent />
                <Row label={L.invLegacy} value={String(report.inventory.legacy)} muted />
                <Row label={L.invValue} value={M(report.inventory.estimatedValueMinor)} muted />
                <Note>{L.invValueNote}</Note>
                {report.inventory.valueExcluded > 0 && <Note>{L.invValueExcluded(report.inventory.valueExcluded)}</Note>}
                {report.inventory.lowStockItems.length > 0 && (
                  <>
                    <h3 className="mt-2 text-sm font-medium text-ringo-text">{L.lowStockList}</h3>
                    {report.inventory.lowStockItems.map((i, idx) => <Row key={idx} label={`${i.name} (${L.onHand}: ${i.count ?? 0})`} value={i.state === "out" ? L.invOut : L.invLow} indent />)}
                  </>
                )}
              </>
            )}
          </Section>

          <Section title={L.secNotes}>
            {report.exclusions.voidedEntries > 0 && <Note>{L.excVoided(report.exclusions.voidedEntries)}</Note>}
            {report.exclusions.otherCurrency > 0 && <Note>{L.excCurrency(report.exclusions.otherCurrency, cur)}</Note>}
            {report.exclusions.doubleCountPrevented > 0 && <Note>{L.excDouble(report.exclusions.doubleCountPrevented)}</Note>}
            {report.exclusions.unreadable > 0 && <Note>{L.excUnreadable(report.exclusions.unreadable)}</Note>}
            {report.exclusions.voidedEntries + report.exclusions.otherCurrency + report.exclusions.doubleCountPrevented + report.exclusions.unreadable === 0 && <Note>{L.noExclusions}</Note>}
            <Note>{L.restateNote}</Note>
            <Note>{L.disclaimer}</Note>
          </Section>
        </div>
      )}
    </div>
  );
}

// A detail block: closed by default, the headline figure on the row itself. A native <details>, so Enter / Space toggle it, the open state is
// announced to screen readers, and everything inside stays in the page.
function Section({ title, value, children }: { title: string; value?: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-card border border-ringo-border bg-ringo-surface">
      <summary className="flex min-h-[48px] cursor-pointer list-none items-center justify-between gap-3 rounded-card px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/50 [&::-webkit-details-marker]:hidden">
        <span className="font-display text-base font-medium text-ringo-text">{title}</span>
        <span className="flex shrink-0 items-center gap-2">
          {value && <span className="text-sm tabular-nums text-ringo-muted">{value}</span>}
          <ChevronDown size={16} aria-hidden="true" className="text-ringo-muted transition-transform group-open:rotate-180 motion-reduce:transition-none" />
        </span>
      </summary>
      <div className="flex flex-col gap-1.5 border-t border-ringo-border/60 px-4 py-3">{children}</div>
    </details>
  );
}
const KPI_TONES: Record<string, string> = {
  in: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  out: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
  net: "bg-ringo-indigo/10 text-ringo-indigo",
  owed: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
};
function Kpi({ icon: Icon, tone, label, value }: { icon: LucideIcon; tone: "in" | "out" | "net" | "owed"; label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-2xl border border-ringo-border/70 bg-ringo-surface p-4">
      <span aria-hidden="true" className={`flex h-8 w-8 items-center justify-center rounded-xl ${KPI_TONES[tone]}`}><Icon size={16} /></span>
      <p className="text-xs text-ringo-muted">{label}</p>
      <p className="text-base sm:text-lg font-semibold tabular-nums tracking-[-0.01em] text-ringo-text">{value}</p>
    </div>
  );
}
function Row({ label, value, bold, muted, indent }: { label: string; value: string; bold?: boolean; muted?: boolean; indent?: boolean }) {
  return (
    <div className={`flex items-start justify-between gap-3 text-sm ${indent ? "pl-3" : ""} ${muted ? "text-ringo-muted" : "text-ringo-text"} ${bold ? "border-t border-ringo-border pt-1.5 font-medium" : ""}`}>
      <span className="min-w-0">{label}</span>
      <span className="shrink-0 whitespace-nowrap text-right">{value}</span>
    </div>
  );
}
function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-xs leading-snug text-ringo-muted">{children}</p>;
}
