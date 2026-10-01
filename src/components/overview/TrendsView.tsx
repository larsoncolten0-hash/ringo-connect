"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { periodOptions, previousCompletedMonth } from "@/lib/reports/period";
import type { TrendModel, YtdModel } from "@/lib/overview/trends";
import { callApi, inputClass, labelClass, secondaryButton, useFormat, useReportErrorText } from "@/components/reports/shared";
import TrendChart from "./TrendChart";

// Presentation only (never imported from the server module, which carries the report builder): the order of the metrics and their trend-point fields.
const METRICS = ["revenue", "expenses", "netCash", "cashReceived", "cashPaidOut", "onlineGross", "commission", "onlineNet"] as const;
type Metric = (typeof METRICS)[number];
const FIELD: Record<Metric, string> = {
  revenue: "revenueMinor", expenses: "expensesMinor", netCash: "netCashMinor", cashReceived: "cashReceivedMinor", cashPaidOut: "cashPaidOutMinor",
  onlineGross: "onlineGrossMinor", commission: "commissionMinor", onlineNet: "onlineNetMinor",
};
const SPANS = [3, 6, 12] as const;

/** Trends, the comparison with the previous equivalent period and the year to date. Every figure is built on the server from the Monthly report builder;
 * this screen only formats it. One metric is charted at a time, and the data table below the chart carries the same values. */
export default function TrendsView() {
  const { t, locale } = useLanguage();
  const u = t.overview.ui;
  const L = t.reports.labels;
  const errorText = useReportErrorText();
  const fmt = useFormat();
  const options = useMemo(() => periodOptions(new Date()), []);
  const defaultValue = useMemo(() => { const p = previousCompletedMonth(new Date()); return `${p.year}-${p.month}`; }, []);
  const [value, setValue] = useState(defaultValue);
  const [span, setSpan] = useState<number>(6);
  const [metric, setMetric] = useState<Metric>("revenue");
  const [trend, setTrend] = useState<TrendModel | null>(null);
  const [trendError, setTrendError] = useState<any>(null);
  const [trendLoading, setTrendLoading] = useState(true);
  const [ytd, setYtd] = useState<YtdModel | null>(null);
  const [ytdError, setYtdError] = useState<any>(null);
  const [ytdLoading, setYtdLoading] = useState(true);
  const [year, month] = value.split("-").map(Number);

  const text = (data: any) => (data?.error === "validation_failed" && data.details?.[0] === "invalid_span" ? u.errInvalidSpan : errorText(data));
  const monthLabel = (y: number, m: number) => t.reports.ui.periodTitle(t.reports.months[m - 1], y);
  const short = (y: number, m: number) => `${new Intl.DateTimeFormat(locale === "en" ? "en" : "fr", { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)))} ${String(y).slice(2)}`;

  const loadTrend = useCallback(async () => {
    setTrendLoading(true);
    setTrendError(null);
    const res = await callApi("GET", `/api/overview/trends?year=${year}&month=${month}&span=${span}`);
    setTrendLoading(false);
    if (!res.ok) { setTrend(null); return setTrendError(res.data); }
    setTrend(res.data.trend);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, span]);
  const loadYtd = useCallback(async () => {
    setYtdLoading(true);
    setYtdError(null);
    const res = await callApi("GET", `/api/overview/ytd?year=${year}&month=${month}`);
    setYtdLoading(false);
    if (!res.ok) { setYtd(null); return setYtdError(res.data); }
    setYtd(res.data.ytd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month]);
  useEffect(() => { loadTrend(); }, [loadTrend]);
  useEffect(() => { loadYtd(); }, [loadYtd]);

  const cur = trend?.currency ?? ytd?.currency ?? "XAF";
  const M = (minor: number, currency = cur) => fmt.money(minor, currency);
  const signed = (minor: number) => `${minor > 0 ? "+" : ""}${M(minor)}`;
  const metricName = u.metricNames[metric];
  const values = trend ? trend.points.map((p) => ({ p, minor: (p as any)[FIELD[metric]] as number })) : [];
  const empty = trend ? trend.points.every((p) => METRICS.every((m) => (p as any)[FIELD[m]] === 0) && p.paidOnlineOrders === 0) : false;

  const excluded = (d: { exclusions: { voidedEntries: number; otherCurrency: number; doubleCountPrevented: number; unreadable: number }; refunded: { count: number; grossMinor: number } }) => [
    d.exclusions.voidedEntries > 0 ? u.excVoided(d.exclusions.voidedEntries) : "",
    d.exclusions.otherCurrency > 0 ? u.excCurrency(d.exclusions.otherCurrency, cur) : "",
    d.exclusions.doubleCountPrevented > 0 ? u.excDouble(d.exclusions.doubleCountPrevented) : "",
    d.exclusions.unreadable > 0 ? u.excUnreadable(d.exclusions.unreadable) : "",
    d.refunded.count > 0 ? u.excRefunded(d.refunded.count, M(d.refunded.grossMinor)) : "",
  ].filter(Boolean);

  const percentText = (c: { percent: number | null; percentReason: string | null }) =>
    c.percent !== null ? `${c.percent > 0 ? "+" : ""}${c.percent}%` : c.percentReason === "sign_change" ? u.cmpPercentSignChange : u.cmpPercentPreviousZero;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-xl font-medium text-ringo-text">{u.trendsTitle}</h1>
        <p className="mt-1 text-sm text-ringo-muted">{u.trendsIntro}</p>
      </div>

      <div className="flex flex-col gap-3 rounded-card border border-ringo-border p-4 sm:flex-row sm:flex-wrap sm:items-end">
        <label className={`${labelClass} sm:min-w-[220px]`}>{u.trendsMonth}
          <select className={inputClass} value={value} onChange={(e) => setValue(e.target.value)}>
            {options.map((o) => (
              <option key={`${o.year}-${o.month}`} value={`${o.year}-${o.month}`}>
                {o.kind === "month_to_date" ? t.reports.ui.monthToDateOption(monthLabel(o.year, o.month)) : monthLabel(o.year, o.month)}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>{u.trendsSpan}
          <select className={inputClass} value={span} onChange={(e) => setSpan(Number(e.target.value))}>
            {SPANS.map((n) => <option key={n} value={n}>{u.trendsSpanOption(n)}</option>)}
          </select>
        </label>
        <label className={`${labelClass} sm:min-w-[260px]`}>{u.trendsMetric}
          <select className={inputClass} value={metric} onChange={(e) => setMetric(e.target.value as Metric)}>
            {METRICS.map((m) => <option key={m} value={m}>{u.metricNames[m]}</option>)}
          </select>
        </label>
      </div>
      <p className="-mt-3 text-xs text-ringo-muted">{t.reports.ui.shownIn(cur)}</p>

      {trendLoading && <p className="flex items-center gap-2 text-sm text-ringo-muted"><Loader2 size={14} className="animate-spin" />{u.trendsLoading}</p>}
      {trendError && (
        <div role="alert" className="flex flex-col gap-2 rounded-card bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-400">
          <p>{u.trendsUnavailable} {text(trendError)}</p>
          <div><button className={secondaryButton} onClick={loadTrend}>{u.retry}</button></div>
        </div>
      )}

      {trend && !trendLoading && (
        <div className="flex flex-col gap-5" data-testid="trend">
          <Section title={metricName}>
            <Note>{u.metricNotes[metric]}</Note>
            {empty ? <Note>{u.trendsEmpty}</Note> : (
              <>
                <TrendChart
                  data={values.map(({ p, minor }) => ({ label: `${short(p.year, p.month)}${p.kind === "month_to_date" ? "*" : ""}`, minor, partial: p.kind === "month_to_date" }))}
                  digits={trend.minorDigits}
                  formatMoney={(minor) => M(minor)}
                  ariaLabel={u.chartLabel(metricName, cur)}
                />
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <caption className="pb-1 text-left text-xs text-ringo-muted">{u.tableCaption(metricName)} ({cur})</caption>
                    <thead><tr className="text-left text-xs text-ringo-muted"><th scope="col" className="py-1 pr-2 font-medium">{u.colMonth}</th><th scope="col" className="pl-2 text-right font-medium">{u.colValue}</th></tr></thead>
                    <tbody>
                      {values.map(({ p, minor }) => (
                        <tr key={`${p.year}-${p.month}`} className="border-t border-ringo-border">
                          <th scope="row" className="py-1.5 pr-2 text-left font-normal">{monthLabel(p.year, p.month)}{p.kind === "month_to_date" ? ` (${u.partialMonth})` : ""}</th>
                          <td className="pl-2 text-right whitespace-nowrap">{M(minor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {trend.points.some((p) => p.kind === "month_to_date") && <Note>* {u.partialNote}</Note>}
              </>
            )}
          </Section>

          <Section title={u.cmpTitle}>
            {!trend.comparison.previous || !trend.comparison.metrics ? <Note>{u.cmpNone}</Note> : (
              <>
                <Note>
                  {trend.comparison.previous.basis === "same_days"
                    ? u.cmpBasisSame(monthLabel(trend.comparison.previous.year, trend.comparison.previous.month), fmt.day(trend.comparison.previous.from), fmt.day(trend.comparison.previous.to))
                    : u.cmpBasisFull(monthLabel(trend.comparison.previous.year, trend.comparison.previous.month))}
                </Note>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-ringo-muted">
                        <th scope="col" className="py-1 pr-2 font-medium">{u.cmpColumns.figure}</th>
                        <th scope="col" className="px-2 text-right font-medium">{u.cmpColumns.current}</th>
                        <th scope="col" className="px-2 text-right font-medium">{u.cmpColumns.previous}</th>
                        <th scope="col" className="px-2 text-right font-medium">{u.cmpColumns.change}</th>
                        <th scope="col" className="pl-2 text-right font-medium">{u.cmpColumns.percent}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {METRICS.map((m) => {
                        const c = trend.comparison.metrics![m];
                        return (
                          <tr key={m} className="border-t border-ringo-border align-top">
                            <th scope="row" className="py-1.5 pr-2 text-left font-normal">{u.metricNames[m]}</th>
                            <td className="px-2 text-right whitespace-nowrap">{M(c.currentMinor)}</td>
                            <td className="px-2 text-right whitespace-nowrap">{M(c.previousMinor)}</td>
                            <td className="px-2 text-right whitespace-nowrap">{signed(c.changeMinor)}</td>
                            <td className={`pl-2 text-right ${c.percent === null ? "text-xs text-ringo-muted" : "whitespace-nowrap"}`}>{percentText(c)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <Note>{u.cmpNote}</Note>
              </>
            )}
          </Section>

          {excluded(trend.disclosures).length > 0 && (
            <div className="rounded-card bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
              <p className="font-medium">{u.trendExcludedTitle}</p>
              <p className="mt-1">{u.excludedLine(excluded(trend.disclosures))}</p>
            </div>
          )}
        </div>
      )}

      <Section title={u.ytdTitle}>
        {ytdLoading && <p className="flex items-center gap-2 text-sm text-ringo-muted"><Loader2 size={14} className="animate-spin" />{u.ytdLoading}</p>}
        {ytdError && (
          <div role="alert" className="flex flex-col gap-2 rounded-card bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-400">
            <p>{u.ytdUnavailable} {text(ytdError)}</p>
            <div><button className={secondaryButton} onClick={loadYtd}>{u.retry}</button></div>
          </div>
        )}
        {ytd && !ytdLoading && (
          <div className="flex flex-col gap-1.5" data-testid="ytd">
            <Note>{u.ytdBasis(fmt.day(ytd.from), fmt.day(ytd.to))}</Note>
            {ytd.partial && <Note>{u.ytdPartial}</Note>}
            <Row label={L.revenue} value={M(ytd.totals.revenueMinor)} bold />
            <Row label={L.expensesRecorded} value={M(ytd.totals.expensesMinor)} bold />
            <h3 className="mt-2 text-sm font-medium text-ringo-text">{u.ytdCashTitle}</h3>
            <Row label={u.metricNames.cashReceived} value={M(ytd.totals.cashReceivedMinor)} />
            <Row label={u.metricNames.cashPaidOut} value={`- ${M(ytd.totals.cashPaidOutMinor)}`} />
            <Row label={L.netCash} value={M(ytd.totals.netCashMinor)} bold />
            <h3 className="mt-2 text-sm font-medium text-ringo-text">{L.secOnline}</h3>
            <Row label={u.metricNames.onlineGross} value={M(ytd.totals.onlineGrossMinor)} />
            <Row label={u.metricNames.commission} value={M(ytd.totals.commissionMinor)} />
            <Row label={u.metricNames.onlineNet} value={M(ytd.totals.onlineNetMinor)} bold />
            <Row label={L.netPaidOut} value={M(ytd.totals.onlineNetPaidOutMinor)} indent muted />
            <Row label={L.netNotPaidOut} value={M(ytd.totals.onlineNetNotPaidMinor)} indent muted />
            <Row label={u.ytdOrders} value={String(ytd.totals.paidOnlineOrders)} muted />
            <Note>{u.metricNotes.netCash}</Note>
            <Note>{u.metricNotes.onlineNet}</Note>
            <Note>{u.ytdNote}</Note>
            {excluded(ytd.totals).length > 0 && <Note>{u.trendExcludedTitle}: {u.excludedLine(excluded(ytd.totals))}</Note>}
          </div>
        )}
      </Section>
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
function Row({ label, value, bold, muted, indent }: { label: string; value: string; bold?: boolean; muted?: boolean; indent?: boolean }) {
  return (
    <div className={`flex items-start justify-between gap-3 text-sm ${indent ? "pl-3" : ""} ${muted ? "text-ringo-muted" : "text-ringo-text"} ${bold ? "font-medium" : ""}`}>
      <span className="min-w-0">{label}</span>
      <span className="shrink-0 whitespace-nowrap text-right">{value}</span>
    </div>
  );
}
function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-xs leading-snug text-ringo-muted">{children}</p>;
}
