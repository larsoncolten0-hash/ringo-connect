"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import type { OverviewModel } from "@/lib/overview/build";
import { callApi, secondaryButton, useFormat, useReportErrorText } from "@/components/reports/shared";

const OUT_KINDS = ["expense", "cash_out"];

/** The Business Toolkit Overview. Every figure is built on the server (the same builder as the Monthly report); this screen only formats it. It never
 * adds one concept to another: revenue, direct cash, online seller earnings, receivables and inventory each keep their own section and meaning. */
export default function OverviewView() {
  const { t } = useLanguage();
  const u = t.overview.ui;
  const L = t.reports.labels;
  const errorText = useReportErrorText();
  const fmt = useFormat();
  const [data, setData] = useState<OverviewModel | null>(null);
  const [errorData, setErrorData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const error = errorData ? errorText(errorData) : "";

  const load = useCallback(async () => {
    setLoading(true);
    setErrorData(null);
    const res = await callApi("GET", "/api/overview");
    setLoading(false);
    if (!res.ok) { setData(null); return setErrorData(res.data); }
    setData(res.data.overview);
  }, []);
  useEffect(() => { load(); }, [load]);

  const cur = data?.currency ?? "XAF";
  const M = (minor: number | null, currency = cur) => (minor === null ? "?" : fmt.money(minor, currency));
  const monthName = (month: number) => t.reports.months[month - 1];

  const excluded = data ? [
    data.exclusions.voidedEntries > 0 ? u.excVoided(data.exclusions.voidedEntries) : "",
    data.exclusions.otherCurrency > 0 ? u.excCurrency(data.exclusions.otherCurrency, cur) : "",
    data.exclusions.doubleCountPrevented > 0 ? u.excDouble(data.exclusions.doubleCountPrevented) : "",
    data.exclusions.unreadable > 0 ? u.excUnreadable(data.exclusions.unreadable) : "",
    data.refundedOrders.count > 0 ? u.excRefunded(data.refundedOrders.count, M(data.refundedOrders.grossMinor)) : "",
  ].filter(Boolean) : [];

  const entryCategory = (c: string | null, invoicePayment: boolean) => (invoicePayment ? t.bookkeeping.ui.fromInvoice : c ? (t.bookkeeping.ui.categories[c] ?? c) : "");

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-xl font-medium text-ringo-text">{u.title}</h1>
        <p className="mt-1 text-sm text-ringo-muted">{u.intro}</p>
      </div>

      {loading && <p className="flex items-center gap-2 text-sm text-ringo-muted"><Loader2 size={14} className="animate-spin" />{u.loading}</p>}
      {error && (
        <div role="alert" className="flex flex-col gap-2 rounded-card bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-400">
          <p>{error}</p>
          <div><button className={secondaryButton} onClick={load}>{u.retry}</button></div>
        </div>
      )}

      {data && !loading && (
        <div className="flex flex-col gap-5" data-testid="overview">
          <div className="text-xs text-ringo-muted">
            <p>{u.updatedAt(fmt.day(data.generatedAt.slice(0, 10)))}</p>
            <p>{u.shownIn(cur)}</p>
          </div>

          <Section title={u.secMonth}>
            <p className="text-sm font-medium text-ringo-text">{u.monthSoFar(monthName(data.period.month), data.period.year)}</p>
            <Note>{u.monthBasis(fmt.day(data.period.from), fmt.day(data.period.to))}</Note>
            <div className="grid gap-3 sm:grid-cols-3">
              <Kpi label={L.revenue} value={M(data.revenue.totalMinor)} />
              <Kpi label={L.expensesRecorded} value={M(data.expenses.totalMinor)} />
              <Kpi label={L.netCash} value={M(data.cash.netMovementMinor)} />
            </div>
            <h3 className="mt-2 text-sm font-medium text-ringo-text">{u.directCashTitle}</h3>
            <Row label={L.cashDirect} value={M(data.cash.receivedDirectMinor)} />
            <Row label={L.cashPaidOut} value={`- ${M(data.cash.paidOutMinor)}`} />
            <Row label={L.netCash} value={M(data.cash.netMovementMinor)} bold />
            <Note>{u.monthNote}</Note>
            <Note>{L.profitNote}</Note>
          </Section>

          <Section title={u.secOnline}>
            {data.counts.paidOnlineOrders === 0 && data.online.grossMinor === 0 ? <Note>{u.noOnline}</Note> : (
              <>
                <Row label={L.grossOnline} value={M(data.online.grossMinor)} />
                <Row label={L.commission} value={M(data.online.commissionMinor)} />
                <Row label={L.netEarnings} value={M(data.online.netMinor)} bold />
                <Row label={L.netPaidOut} value={M(data.online.netPaidOutMinor)} indent muted />
                <Row label={L.netNotPaidOut} value={M(data.online.netNotYetPaidOutMinor)} indent muted />
                <Row label={L.paidOnlineOrders} value={String(data.counts.paidOnlineOrders)} muted />
                <Note>{u.onlineEarningsNote}</Note>
                {data.online.ordersWithoutEarnings > 0 && <Note>{L.missingEarnings(data.online.ordersWithoutEarnings, M(data.online.grossWithoutEarningsMinor))}</Note>}
              </>
            )}
          </Section>

          <Section title={u.secReceivables}>
            {!data.receivables.available ? <Note>{u.receivablesUnavailable}</Note> : (
              <>
                <Note>{u.receivablesBasis(fmt.day(data.receivables.asOfDate))}</Note>
                {data.receivables.currencies.length === 0 && <Note>{u.receivablesNone}</Note>}
                {data.receivables.currencies.map((c) => (
                  <div key={c.currency} className="flex flex-col gap-1">
                    <Row label={`${L.outstanding} (${c.currency})`} value={M(c.outstandingMinor, c.currency)} bold />
                    <Row label={`${L.overdue} (${c.currency})`} value={M(c.overdueMinor, c.currency)} />
                    <Row label={L.invoiceCount} value={String(c.invoiceCount)} muted />
                  </div>
                ))}
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  <Link href="/dashboard/documents/receivables" className="text-sm text-ringo-indigo underline">{u.openDebtors}</Link>
                  <Link href="/dashboard/customers/attention" className="text-sm text-ringo-indigo underline">{u.openAttention}</Link>
                </div>
              </>
            )}
          </Section>

          <Section title={u.secInventory}>
            {!data.inventory.available ? <Note>{u.inventoryUnavailable}</Note> : data.inventory.tracked === 0 && data.inventory.legacy === 0 ? <Note>{u.inventoryNone}</Note> : (
              <>
                <Note>{L.asOf(fmt.day(data.inventory.asOfDate))}</Note>
                <Row label={L.invTracked} value={String(data.inventory.tracked)} />
                <Row label={L.invOk} value={String(data.inventory.ok)} indent />
                <Row label={L.invLow} value={String(data.inventory.low)} indent />
                <Row label={L.invOut} value={String(data.inventory.out)} indent />
                <Row label={L.invLegacy} value={String(data.inventory.legacy)} muted />
                <Note>{u.inventoryNote}</Note>
                {data.inventory.lowStockItems.length > 0 && (
                  <>
                    <h3 className="mt-2 text-sm font-medium text-ringo-text">{u.lowStockTitle}</h3>
                    {data.inventory.lowStockItems.map((i, idx) => <Row key={idx} label={`${i.name} (${L.onHand}: ${i.count ?? 0})`} value={i.state === "out" ? L.invOut : L.invLow} indent />)}
                  </>
                )}
                <div><Link href="/dashboard/inventory" className="text-sm text-ringo-indigo underline">{u.openInventory}</Link></div>
              </>
            )}
          </Section>

          <Section title={u.secActivity}>
            <Note>{u.activityNote}</Note>

            <h3 className="mt-2 text-sm font-medium text-ringo-text">{u.entriesTitle}</h3>
            {!data.recent.entries.available ? <Note>{u.sectionUnavailable}</Note> : data.recent.entries.items.length === 0 ? <Note>{u.noneYet}</Note> : (
              <ul className="flex flex-col gap-1.5">
                {data.recent.entries.items.map((e) => (
                  <li key={e.id} className="flex flex-col gap-0.5 rounded-card border border-ringo-border p-2.5 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0 text-ringo-text">{t.bookkeeping.ui.kind[e.kind] ?? e.kind}{entryCategory(e.category, e.invoicePayment) ? ` · ${entryCategory(e.category, e.invoicePayment)}` : ""}</span>
                      <span className="shrink-0 whitespace-nowrap text-right text-ringo-text">{OUT_KINDS.includes(e.kind) ? "- " : ""}{M(e.amountMinor, e.currency)}</span>
                    </div>
                    <p className="text-xs text-ringo-muted">{fmt.day(e.date)}{e.description ? ` · ${e.description}` : ""}{!e.cashSettled ? ` · ${u.notSettled}` : ""}</p>
                  </li>
                ))}
              </ul>
            )}
            <div><Link href="/dashboard/bookkeeping" className="text-sm text-ringo-indigo underline">{u.viewEntries}</Link></div>

            <h3 className="mt-2 text-sm font-medium text-ringo-text">{u.ordersTitle}</h3>
            {!data.recent.orders.available ? <Note>{u.sectionUnavailable}</Note> : data.recent.orders.items.length === 0 ? <Note>{u.noneYet}</Note> : (
              <ul className="flex flex-col gap-1.5">
                {data.recent.orders.items.map((o) => (
                  <li key={o.id} className="flex flex-col gap-0.5 rounded-card border border-ringo-border p-2.5 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0 text-ringo-text">{u.orderNumber(`#${o.number ?? ""}`)}</span>
                      <span className="shrink-0 whitespace-nowrap text-right text-ringo-text">{M(o.totalMinor, o.currency)}</span>
                    </div>
                    <p className="text-xs text-ringo-muted">{o.paidAt ? fmt.day(o.paidAt.slice(0, 10)) : ""} · {u.orderStatus[o.status] ?? o.status}</p>
                  </li>
                ))}
              </ul>
            )}

            <h3 className="mt-2 text-sm font-medium text-ringo-text">{u.invoicesTitle}</h3>
            {!data.recent.invoices.available ? <Note>{u.sectionUnavailable}</Note> : data.recent.invoices.items.length === 0 ? <Note>{u.noneYet}</Note> : (
              <ul className="flex flex-col gap-1.5">
                {data.recent.invoices.items.map((i) => (
                  <li key={i.id} className="flex flex-col gap-0.5 rounded-card border border-ringo-border p-2.5 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0 text-ringo-text">{i.number ?? ""}</span>
                      <span className="shrink-0 whitespace-nowrap text-right text-ringo-text">{M(i.totalMinor, i.currency)}</span>
                    </div>
                    <p className="text-xs text-ringo-muted">
                      {i.issueDate ? `${fmt.day(i.issueDate)} · ` : ""}{u.invoiceStatus[i.status] ?? i.status} · {u.balance}: {M(i.balanceMinor, i.currency)}
                      {i.overdue ? <span className="ml-1 font-medium text-rose-700 dark:text-rose-400">· {u.overdueBadge}</span> : null}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <Note>{u.invoicesNote}</Note>
            <div><Link href="/dashboard/documents" className="text-sm text-ringo-indigo underline">{u.viewInvoices}</Link></div>
          </Section>

          {excluded.length > 0 && (
            <div className="rounded-card bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
              <p className="font-medium">{u.excludedTitle}</p>
              <p className="mt-1">{u.excludedLine(excluded)}</p>
            </div>
          )}

          <div><Link href="/dashboard/reports/monthly" className="text-sm text-ringo-indigo underline">{u.openReport}</Link></div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5 rounded-card border border-ringo-border p-4">
      <h2 className="mb-1 font-display text-base font-medium text-ringo-text">{title}</h2>
      {children}
    </section>
  );
}
function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-ringo-border p-3">
      <p className="text-xs text-ringo-muted">{label}</p>
      <p className="mt-1 text-lg font-medium text-ringo-text">{value}</p>
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
