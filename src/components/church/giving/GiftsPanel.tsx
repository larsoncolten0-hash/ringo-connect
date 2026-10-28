"use client";

import { useCallback, useEffect, useState } from "react";
import { HandCoins, Loader2, RefreshCw } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { churchErrorText } from "../lifecycle/errorText";
import { Badge, BTN_PRIMARY, BTN_SECONDARY, EmptyState, ErrorLine, Field, INPUT, ListSkeleton, NoticeBar, churchApi, useNotice } from "../people/shared";

interface GiftRow {
  id: string;
  receipt_number: number;
  fund_kind: "giving" | "care";
  amount_xaf: number;
  is_anonymous: boolean;
  donor_name: string | null;
  donor_contact: string | null;
  status: string;
  external_id: string;
  provider_transaction_id: string | null;
  created_at: string;
}
interface Report {
  paid: { count: number; gross: number; by_kind: { giving: { gross: number }; care: { gross: number } } };
  pending: number;
  failed: number;
  review: number;
  refunded: { count: number; gross: number };
  earnings: null | { fee: number; net: number };
  reconciliation: { review_ids: string[]; stale_pending_ids: string[]; paid_without_earning_ids: string[] | null; ok: boolean };
}
interface Balance {
  available: number;
  held: number;
  requested: number;
  paid: number;
}
interface PayoutRow {
  id: string;
  amount: number | string;
  status: string;
  requested_at: string;
}
const tone = (s: string) => (s === "succeeded" || s === "paid" ? "active" : s === "failed" || s === "rejected" || s === "declined" ? "inactive" : "pending");

// The money side of the giving screen: the gifts of the church, the totals of a period, the reconciliation, the owner's balance and payouts. It only DISPLAYS what the server and the
// database return (row-level security decides who sees what: staff never get the commission or the balance, and an anonymous donor has no name). It computes no money itself.
export default function GiftsPanel() {
  const { t, locale } = useLanguage();
  const d = t.churchExpansion.gifts.dashboard;
  const p = t.churchExpansion.gifts.payouts;
  const ge = t.churchExpansion.gifts.errors;
  const err = (code: string) => ge[code] ?? churchErrorText(t, code);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState("");
  const [items, setItems] = useState<GiftRow[] | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [payouts, setPayouts] = useState<PayoutRow[]>([]);
  const [ownerOnly, setOwnerOnly] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [payoutError, setPayoutError] = useState("");
  const { notice, show } = useNotice();
  const money = (n: number | string) => `${new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-US").format(Number(n) || 0)} XAF`;
  const when = (iso: string) => new Date(iso).toLocaleString(locale === "fr" ? "fr-FR" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Douala" });

  const load = useCallback(async () => {
    setError("");
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    if (status) qs.set("status", status);
    const r = await churchApi<{ items: GiftRow[]; report: Report; truncated?: boolean }>(`/api/church/gifts${qs.toString() ? `?${qs}` : ""}`);
    if (!r.ok) {
      setItems([]);
      return setError(err(r.code));
    }
    setItems(r.body.items);
    setReport(r.body.report);
    setTruncated(r.body.truncated === true);
    const b = await churchApi<{ balance: Balance; payouts: PayoutRow[] }>("/api/church/giving-payouts");
    if (b.ok) {
      setBalance(b.body.balance);
      setPayouts(b.body.payouts);
      setOwnerOnly(false);
    } else if (b.status === 403) setOwnerOnly(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, status, t]);
  useEffect(() => {
    load();
  }, [load]);

  const check = async () => {
    setChecking(true);
    const r = await churchApi<{ checked: number; settled: number }>("/api/church/gifts", { method: "POST", body: { action: "check_pending" } });
    setChecking(false);
    if (!r.ok) return setError(err(r.code));
    show(d.checked(r.body.checked, r.body.settled));
    await load();
  };
  const requestPayout = async () => {
    setRequesting(true);
    setPayoutError("");
    const r = await churchApi("/api/church/giving-payouts", { method: "POST", body: {} });
    setRequesting(false);
    if (!r.ok) return setPayoutError(err(r.code));
    show(p.requestedOk);
    await load();
  };

  const rep = report;
  return (
    <section aria-labelledby="church-gifts-title" className="mt-4 flex flex-col gap-4 border-t border-ringo-border pt-6">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="church-gifts-title" className="font-display text-lg font-semibold text-ringo-text">
            {d.title}
          </h2>
          <p className="mt-1 max-w-[65ch] text-sm leading-relaxed text-ringo-muted">{d.intro}</p>
        </div>
        <button type="button" onClick={check} disabled={checking} className={BTN_SECONDARY}>
          {checking ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={15} aria-hidden="true" />}
          {checking ? d.checking : d.check}
        </button>
      </header>
      <NoticeBar message={notice} />
      <p role="note" className="rounded-card border border-ringo-border bg-ringo-bg p-3 text-xs leading-relaxed text-ringo-muted">
        {d.pilotNote}
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <Field id="gf-from" label={d.from}>
          <input id="gf-from" type="date" className={`${INPUT} sm:w-44`} value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field id="gf-to" label={d.to}>
          <input id="gf-to" type="date" className={`${INPUT} sm:w-44`} value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field id="gf-status" label={d.status}>
          <select id="gf-status" className={`${INPUT} sm:w-52`} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{d.allStatuses}</option>
            {Object.keys(d.statuses).map((s) => (
              <option key={s} value={s}>
                {d.statuses[s]}
              </option>
            ))}
          </select>
        </Field>
        {(from || to || status) && (
          <button type="button" className={BTN_SECONDARY} onClick={() => { setFrom(""); setTo(""); setStatus(""); }}>
            {d.reset}
          </button>
        )}
      </div>

      {error ? (
        <div className="flex flex-col items-start gap-3">
          <ErrorLine message={error} />
          <button type="button" onClick={load} className={BTN_SECONDARY}>
            {d.retry}
          </button>
        </div>
      ) : items === null ? (
        <ListSkeleton rows={3} />
      ) : (
        <>
          {rep && (
            <div className="rounded-card border border-ringo-border bg-ringo-surface p-4">
              <h3 className="text-sm font-semibold text-ringo-text">{d.report.title}</h3>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-ringo-muted">{d.report.paid(rep.paid.count)}</dt>
                  <dd className="font-semibold text-ringo-text">{money(rep.paid.gross)}</dd>
                  <dd className="text-xs text-ringo-muted">{d.report.gross}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ringo-muted">{d.report.giving}</dt>
                  <dd className="font-semibold text-ringo-text">{money(rep.paid.by_kind.giving.gross)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ringo-muted">{d.report.care}</dt>
                  <dd className="font-semibold text-ringo-text">{money(rep.paid.by_kind.care.gross)}</dd>
                </div>
                {rep.earnings && (
                  <div>
                    <dt className="text-xs text-ringo-muted">{d.report.net}</dt>
                    <dd className="font-semibold text-ringo-text">{money(rep.earnings.net)}</dd>
                    <dd className="text-xs text-ringo-muted">
                      {d.report.fee}: {money(rep.earnings.fee)}
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs text-ringo-muted">{d.report.pending}</dt>
                  <dd className="font-semibold text-ringo-text">{rep.pending}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ringo-muted">{d.report.failed}</dt>
                  <dd className="font-semibold text-ringo-text">{rep.failed}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ringo-muted">{d.report.review}</dt>
                  <dd className="font-semibold text-ringo-text">{rep.review}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ringo-muted">{d.report.refunded}</dt>
                  <dd className="font-semibold text-ringo-text">{rep.refunded.count > 0 ? `${rep.refunded.count} · ${money(rep.refunded.gross)}` : "0"}</dd>
                </div>
              </dl>
              {truncated && <p className="mt-3 text-xs text-ringo-muted">{d.report.truncated}</p>}
              <div className="mt-3 border-t border-ringo-border pt-3 text-sm" role="status">
                <p className="text-xs font-semibold text-ringo-muted">{d.report.reconciliation}</p>
                {rep.reconciliation.ok ? (
                  <p className="mt-1 text-ringo-text">{d.report.reconOk}</p>
                ) : (
                  <ul className="mt-1 list-disc pl-5 text-ringo-text">
                    {rep.reconciliation.review_ids.length > 0 && <li>{d.report.reconReview(rep.reconciliation.review_ids.length)}</li>}
                    {rep.reconciliation.stale_pending_ids.length > 0 && <li>{d.report.reconStale(rep.reconciliation.stale_pending_ids.length)}</li>}
                    {(rep.reconciliation.paid_without_earning_ids?.length ?? 0) > 0 && <li>{d.report.reconMissing(rep.reconciliation.paid_without_earning_ids!.length)}</li>}
                  </ul>
                )}
              </div>
            </div>
          )}

          {items.length === 0 ? (
            <EmptyState icon={<HandCoins size={22} aria-hidden="true" />} title={d.empty} />
          ) : (
            <ul className="flex flex-col gap-2">
              {items.map((g) => (
                <li key={g.id} className="rounded-card border border-ringo-border bg-ringo-surface p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-ringo-text">{money(g.amount_xaf)}</span>
                    <Badge tone={tone(g.status)}>{d.statuses[g.status] ?? g.status}</Badge>
                    <span className="text-xs text-ringo-muted">{d.kind[g.fund_kind]}</span>
                    <span className="ml-auto text-xs text-ringo-muted">{when(g.created_at)}</span>
                  </div>
                  <p className="mt-1 text-sm text-ringo-text">
                    {g.is_anonymous ? d.anonymous : g.donor_name || "—"}
                    {!g.is_anonymous && g.donor_contact ? ` · ${g.donor_contact}` : ""}
                  </p>
                  <p className="mt-0.5 break-all text-xs text-ringo-muted">
                    {d.reference}: {g.external_id}
                    {g.provider_transaction_id ? ` · ${g.provider_transaction_id}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <div className="rounded-card border border-ringo-border bg-ringo-surface p-4">
        <h3 className="text-sm font-semibold text-ringo-text">{p.title}</h3>
        {ownerOnly || !balance ? (
          <p className="mt-2 text-sm text-ringo-muted">{p.ownerOnly}</p>
        ) : (
          <>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-ringo-muted">{p.available}</dt>
                <dd className="font-semibold text-ringo-text">{money(balance.available)}</dd>
              </div>
              <div>
                <dt className="text-xs text-ringo-muted">{p.held}</dt>
                <dd className="font-semibold text-ringo-text">{money(balance.held)}</dd>
              </div>
              <div>
                <dt className="text-xs text-ringo-muted">{p.requested}</dt>
                <dd className="font-semibold text-ringo-text">{money(balance.requested)}</dd>
              </div>
              <div>
                <dt className="text-xs text-ringo-muted">{p.paid}</dt>
                <dd className="font-semibold text-ringo-text">{money(balance.paid)}</dd>
              </div>
            </dl>
            <p className="mt-3 text-xs leading-relaxed text-ringo-muted">{p.note}</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button type="button" onClick={requestPayout} disabled={requesting || balance.available <= 0} className={BTN_PRIMARY}>
                {requesting && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
                {requesting ? p.requesting : p.request}
              </button>
              <ErrorLine message={payoutError} />
            </div>
            <h4 className="mt-4 text-xs font-semibold text-ringo-muted">{p.history}</h4>
            {payouts.length === 0 ? (
              <p className="mt-1 text-sm text-ringo-muted">{p.none}</p>
            ) : (
              <ul className="mt-1 flex flex-col gap-1">
                {payouts.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center gap-2 text-sm text-ringo-text">
                    <span className="font-semibold">{money(x.amount)}</span>
                    <Badge tone={tone(x.status)}>{p.statuses[x.status] ?? x.status}</Badge>
                    <span className="ml-auto text-xs text-ringo-muted">{when(x.requested_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}
