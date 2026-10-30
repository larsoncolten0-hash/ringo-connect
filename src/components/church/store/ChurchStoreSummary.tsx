"use client";

import { useCallback, useEffect, useState } from "react";
import { ShoppingBag } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { formatPrice } from "@/lib/currency";
import { ORDER_STATUSES } from "@/lib/church/store/statuses";
import type { StoreSummary } from "@/lib/church/store/summary";
import { addDays } from "@/lib/church/reports/period";
import { churchErrorText } from "../lifecycle/errorText";
import { BTN_PRIMARY, BTN_SECONDARY, EmptyState, ErrorLine, INPUT, ListSkeleton, churchApi, formatDay } from "../people/shared";

const doualaToday = () => new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);

// Church Store totals for the dates the owner picks: paid sales and orders placed, from the church's own Shop orders (GET /api/church/store-summary). Presentation only; giving is never part of it.
export default function ChurchStoreSummary() {
  const { t, locale } = useLanguage();
  const s = t.churchStore.summary;
  const lang = locale === "fr" ? "fr" : "en";
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<StoreSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(
    async (f?: string, tt?: string) => {
      setLoading(true);
      setError("");
      const qs = f && tt ? `?from=${encodeURIComponent(f)}&to=${encodeURIComponent(tt)}` : "";
      const r = await churchApi<{ summary: StoreSummary }>(`/api/church/store-summary${qs}`);
      setLoading(false);
      if (r.ok) {
        setData(r.body.summary);
        setFrom(r.body.summary.period.from);
        setTo(r.body.summary.period.to);
      } else setError(churchErrorText(t, r.code));
    },
    [t]
  );
  useEffect(() => {
    load();
    // the first load uses the server's default range; later loads are explicit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const preset = (days: number) => {
    const end = doualaToday();
    load(addDays(end, -(days - 1)), end);
  };
  const thisYear = () => {
    const end = doualaToday();
    load(`${end.slice(0, 4)}-01-01`, end);
  };
  const money = (n: number) => formatPrice(n, "XAF", lang);

  return (
    <section aria-labelledby="church-store-summary" className="mt-6 rounded-3xl border border-ringo-border/70 bg-ringo-surface p-4 sm:p-5">
      <h2 id="church-store-summary" className="font-display text-base font-semibold text-ringo-text">
        {s.title}
      </h2>
      <p className="mb-4 mt-1 text-sm leading-relaxed text-ringo-muted">{s.intro}</p>

      <form
        className="mb-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (from && to) load(from, to);
        }}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col gap-1 text-xs text-ringo-muted">
            {s.from}
            <input type="date" className={INPUT} value={from} min="2020-01-01" onChange={(e) => setFrom(e.target.value)} required />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-xs text-ringo-muted">
            {s.to}
            <input type="date" className={INPUT} value={to} onChange={(e) => setTo(e.target.value)} required />
          </label>
          <button type="submit" className={BTN_PRIMARY} disabled={loading || !from || !to}>
            {s.apply}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={() => preset(7)} disabled={loading}>{s.last7}</button>
          <button type="button" className={BTN_SECONDARY} onClick={() => preset(30)} disabled={loading}>{s.last30}</button>
          <button type="button" className={BTN_SECONDARY} onClick={() => preset(90)} disabled={loading}>{s.last90}</button>
          <button type="button" className={BTN_SECONDARY} onClick={thisYear} disabled={loading}>{s.thisYear}</button>
        </div>
        <p className="mt-2 text-xs text-ringo-muted">{s.hint}</p>
      </form>

      {error ? (
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-ringo-coral/30 bg-ringo-coral/[0.05] p-4" role="alert">
          <ErrorLine message={`${s.loadError} ${error}`} />
          <button type="button" className={BTN_SECONDARY} onClick={() => load(from || undefined, to || undefined)}>
            {s.retry}
          </button>
        </div>
      ) : loading && !data ? (
        <div role="status" aria-label={s.loading}>
          <ListSkeleton rows={3} />
        </div>
      ) : data ? (
        <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"} aria-busy={loading} aria-live="polite">
          <p className="mb-3 text-xs text-ringo-muted">{s.updated(formatDay(data.period.from, lang), formatDay(data.period.to, lang))}</p>
          {data.placed.total === 0 && data.sales.orders === 0 && data.sales.otherCurrencyOrders === 0 ? (
            <EmptyState icon={<ShoppingBag size={22} />} title={s.placedTitle} body={s.empty} />
          ) : (
            <>
              <h3 className="mb-2 text-sm font-semibold text-ringo-text">{s.salesTitle}</h3>
              <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Figure label={s.salesRevenue} value={money(data.sales.revenueXaf)} />
                <Figure label={s.salesOrders} value={String(data.sales.orders)} />
                <Figure label={s.salesAverage} value={money(data.sales.averageXaf)} />
              </dl>
              {data.sales.otherCurrencyOrders > 0 && <p className="mt-2 text-xs text-ringo-muted">{s.otherCurrency(data.sales.otherCurrencyOrders)}</p>}

              <h3 className="mb-2 mt-5 text-sm font-semibold text-ringo-text">{s.placedTitle}</h3>
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Figure label={s.placedTotal} value={String(data.placed.total)} />
                {ORDER_STATUSES.filter((st) => data.placed.byStatus[st] > 0).map((st) => (
                  <Figure key={st} label={s.status[st]} value={String(data.placed.byStatus[st])} />
                ))}
              </dl>
              {data.truncated && <p className="mt-3 rounded-2xl bg-ringo-bg px-3 py-2 text-xs text-ringo-muted">{s.truncated}</p>}
            </>
          )}
          <p className="mt-4 text-xs text-ringo-muted">{s.givingNote}</p>
        </div>
      ) : null}
    </section>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-ringo-bg px-3 py-2.5">
      <dt className="text-xs text-ringo-muted">{label}</dt>
      <dd className="font-display text-lg font-semibold text-ringo-text">{value}</dd>
    </div>
  );
}
