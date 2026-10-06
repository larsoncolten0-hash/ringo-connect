"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import type { AttentionModel, DebtRow, RecentRow, QuietRow } from "@/lib/customers/attention";
import { callApi, secondaryButton, useCustErrorText, useFormatters } from "./shared";

type ListKey = "overdue" | "outstanding" | "recent" | "quiet";
const LISTS: ListKey[] = ["overdue", "outstanding", "recent", "quiet"];

/** Customers needing attention: four lists derived on the server when this page opens. Nothing is stored here or on the server, nothing is sent, and no
 * amount is computed in the browser or added across currencies. A customer is identified by its id (the link goes to its profile). */
export default function AttentionView() {
  const { t } = useLanguage();
  const u = t.customerAttention.ui;
  const errorText = useCustErrorText();
  const f = useFormatters();
  const [data, setData] = useState<AttentionModel | null>(null);
  const [errorData, setErrorData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<ListKey>("overdue");
  const error = errorData ? errorText(errorData) : "";

  const load = useCallback(async () => {
    setLoading(true);
    setErrorData(null);
    const res = await callApi("GET", "/api/customers/attention");
    setLoading(false);
    if (!res.ok) { setData(null); return setErrorData(res.data); }
    setData(res.data.attention);
  }, []);
  useEffect(() => { load(); }, [load]);

  const counts: Record<ListKey, number> = { overdue: data?.overdue.total ?? 0, outstanding: data?.outstanding.total ?? 0, recent: data?.recent.total ?? 0, quiet: data?.quiet.total ?? 0 };
  const label: Record<ListKey, string> = { overdue: u.cardOverdue, outstanding: u.cardOutstanding, recent: u.cardRecent, quiet: u.cardQuiet };
  const help = (k: ListKey) => k === "overdue" ? u.helpOverdue : k === "outstanding" ? u.helpOutstanding : k === "recent" ? u.helpRecent(data!.thresholds.recentDays) : u.helpQuiet(data!.thresholds.quietDays, data!.thresholds.quietMinAgeDays);
  const empty: Record<ListKey, string> = { overdue: u.emptyOverdue, outstanding: u.emptyOutstanding, recent: u.emptyRecent, quiet: u.emptyQuiet };

  /** rows grouped by currency, in the order the server sent them (amounts of different currencies are never combined) */
  const groups = <R extends { currency: string }>(rows: R[]) => {
    const out: { currency: string; rows: R[] }[] = [];
    for (const r of rows) { const g = out.find((x) => x.currency === r.currency); if (g) g.rows.push(r); else out.push({ currency: r.currency, rows: [r] }); }
    return out;
  };
  const badge = (archived: boolean) => archived ? <span className="rounded-full bg-slate-500/15 px-2 py-0.5 text-[11px] text-ringo-muted">{u.archivedBadge}</span> : null;
  const name = (id: string, n: string, archived: boolean) => (
    <span className="flex flex-wrap items-center gap-2">
      <Link href={`/dashboard/customers/${id}`} className="font-medium text-ringo-text underline-offset-2 hover:underline" aria-label={`${u.openProfile}: ${n}`}>{n}</Link>
      {badge(archived)}
    </span>
  );

  const debtRow = (r: DebtRow, showOverdue: boolean) => (
    <li key={`${r.customerId}-${r.currency}`} className="flex flex-col gap-1 rounded-card border border-ringo-border p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        {name(r.customerId, r.name, r.archived)}
        <span className="whitespace-nowrap font-medium text-ringo-text">{f.money(showOverdue ? r.overdueMinor : r.outstandingMinor, r.currency)}</span>
      </div>
      <p className="text-xs text-ringo-muted">
        {showOverdue ? `${u.overdue} · ${u.outstanding}: ${f.money(r.outstandingMinor, r.currency)}` : u.outstanding} · {u.openInvoices(r.invoiceCount)}
      </p>
      {showOverdue && r.oldestDueDate && r.daysOverdue !== null && <p className="text-xs text-ringo-muted">{u.oldestDue(f.day(r.oldestDueDate), r.daysOverdue)}</p>}
    </li>
  );
  const recentRow = (r: RecentRow) => (
    <li key={`${r.customerId}-${r.currency}`} className="flex flex-col gap-1 rounded-card border border-ringo-border p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        {name(r.customerId, r.name, r.archived)}
        <span className="whitespace-nowrap font-medium text-ringo-text">{f.money(r.unpaidMinor, r.currency)}</span>
      </div>
      <p className="text-xs text-ringo-muted">{u.unpaid} · {u.invoicesRecent(r.invoiceCount)} · {u.latestInvoice(f.day(r.latestIssueDate))}</p>
    </li>
  );
  const quietRow = (r: QuietRow) => (
    <li key={r.customerId} className="flex flex-col gap-1 rounded-card border border-ringo-border p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">{name(r.customerId, r.name, false)}</div>
      <p className="text-xs text-ringo-muted">{u.customerSince(f.day(r.customerSince))}</p>
    </li>
  );

  const body = () => {
    if (!data) return null;
    if ((active === "overdue" || active === "outstanding") && !data.receivables.available) return <p className="text-sm text-ringo-muted">{u.receivablesUnavailable}</p>;
    if (active === "recent" && !data.recent.available) return <p className="text-sm text-ringo-muted">{u.unavailable}</p>;
    if (active === "quiet" && !data.quiet.available) return <p className="text-sm text-ringo-muted">{u.unavailable}</p>;
    const list = data[active];
    if (counts[active] === 0) return <p className="text-sm text-ringo-muted">{empty[active]}</p>;
    return (
      <div className="flex flex-col gap-4">
        {active === "quiet"
          ? <ul className="flex flex-col gap-2">{data.quiet.items.map(quietRow)}</ul>
          : groups((list as any).items as { currency: string }[]).map((g) => (
              <div key={g.currency} className="flex flex-col gap-2">
                <h3 className="text-sm font-medium text-ringo-text">{u.currencyHeading(g.currency)}</h3>
                <ul className="flex flex-col gap-2">
                  {g.rows.map((r) => (active === "recent" ? recentRow(r as unknown as RecentRow) : debtRow(r as unknown as DebtRow, active === "overdue")))}
                </ul>
              </div>
            ))}
        {(list as any).items.length < counts[active] && <p className="text-xs text-ringo-muted">{u.capRows((list as any).items.length, counts[active])}</p>}
        {active === "recent" && data.recent.capped && <p className="rounded-card bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">{u.capRecent(data.thresholds.recentDocCap)}</p>}
        {active === "quiet" && data.quiet.incomplete && <p className="rounded-card bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">{u.quietIncomplete}</p>}
        {active === "quiet" && data.quiet.customersCapped && <p className="rounded-card bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">{u.quietCapped(data.thresholds.quietCustomerCap)}</p>}
        {(active === "overdue" || active === "outstanding") && data.receivables.omitted.map((o) => (
          <p key={o.currency} className="rounded-card bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">{u.capReceivables(o.currency, data.thresholds.receivablesCustomerCap, o.omittedInvoices)}</p>
        ))}
        {(active === "overdue" || active === "outstanding") && <p className="text-xs text-ringo-muted">{u.archivedNote}</p>}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-xl font-medium text-ringo-text">{u.title}</h1>
        <p className="mt-1 text-sm text-ringo-muted">{u.intro}</p>
      </div>

      {loading && <p className="flex items-center gap-2 text-sm text-ringo-muted"><Loader2 size={14} className="animate-spin" />{u.loading}</p>}
      {error && (
        <div role="alert" className="flex flex-col gap-2 rounded-card bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-400">
          <p>{u.unavailable} {error}</p>
          <div><button className={secondaryButton} onClick={load}>{u.retry}</button></div>
        </div>
      )}

      {data && !loading && (
        <div className="flex flex-col gap-5" data-testid="attention">
          <div role="tablist" aria-label={u.listsLabel} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {LISTS.map((k) => (
              <button
                key={k} type="button" role="tab" aria-selected={active === k} onClick={() => setActive(k)}
                className={`flex min-h-[44px] flex-col items-start gap-1 rounded-card border p-3 text-left ${active === k ? "border-ringo-indigo bg-ringo-indigo/5" : "border-ringo-border"}`}
              >
                <span className="text-xs text-ringo-muted">{label[k]}</span>
                <span className="text-lg font-medium text-ringo-text">{counts[k]}</span>
              </button>
            ))}
          </div>

          <section className="flex flex-col gap-3 rounded-card border border-ringo-border p-4" role="tabpanel" aria-label={label[active]}>
            <h2 className="font-display text-base font-medium text-ringo-text">{label[active]}</h2>
            <p className="text-xs text-ringo-muted">{help(active)}</p>
            {body()}
            <p className="text-xs text-ringo-muted">{u.currencyNote}</p>
          </section>

          {data.unassigned.length > 0 && (
            <section className="flex flex-col gap-2 rounded-card border border-ringo-border p-4">
              <h2 className="font-display text-base font-medium text-ringo-text">{u.unassignedTitle}</h2>
              {data.unassigned.map((x) => <p key={x.currency} className="text-sm text-ringo-muted">{u.unassignedBody(x.invoiceCount, f.money(x.outstandingMinor, x.currency), f.money(x.overdueMinor, x.currency))}</p>)}
              <div><Link href="/dashboard/documents/receivables" className="ringo-tactile inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-ringo-border px-4 text-sm font-semibold text-ringo-indigo hover:border-ringo-indigo/40 hover:bg-ringo-indigo/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40">{u.openDebtors}</Link></div>
            </section>
          )}

          <p className="text-xs text-ringo-muted">{u.derivedNote}</p>
        </div>
      )}
    </div>
  );
}
