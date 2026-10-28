"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, Printer } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { hexToRgba } from "@/lib/color";
import type { PublicFund } from "@/lib/church/public/giving";
import { GIFT_MAX_XAF, GIFT_MIN_XAF } from "@/lib/church/giving/gifts/rules";
import { SERIF } from "./churchTheme";

// The public giving page of a church (/{username}/church/give): choose a fund, an amount and a Mobile Money number, approve the payment on the phone, then see the receipt.
// This screen NEVER decides that a gift is paid. It starts the gift, then asks the server (which asks Fapshi) every few seconds; only a "succeeded" answer from the server shows a receipt. The donor's key
// to the gift (an access token) is kept in this tab and in the page address so a refresh or a bookmark still shows the receipt. The payer's number is sent once and never shown again.

type Theme = { accent: string; accentText: string; textColor: string; borderTint: string; radiusClass: string };
type Receipt = {
  receipt_number: string | null;
  church_name: string | null;
  fund_title_en: string | null;
  fund_title_fr: string | null;
  fund_kind: "giving" | "care";
  amount_xaf: number;
  fee_xaf: 0;
  confirmed_at: string | null;
  anonymous: boolean;
  donor_name: string | null;
  reference: string;
};
type View = { gift_id: string; state: "pending" | "succeeded" | "failed" | "expired" | "review" | "refunded"; amount_xaf: number; expires_at: string; receipt?: Receipt; refund_open?: boolean };

const POLL_FIRST_MS = 3_000;
const POLL_MS = 12_000; // Fapshi limits status requests per transaction: the server also enforces a minimum gap

export default function ChurchGiveBody({ church, funds, theme }: { church: { name: string; username: string }; funds: PublicFund[]; theme: Theme }) {
  const { t, locale } = useLanguage();
  const g = t.churchExpansion.gifts.public;
  const lang = locale === "fr" ? "fr" : "en";
  const num = (n: number) => new Intl.NumberFormat(lang === "fr" ? "fr-FR" : "en-US").format(n);
  const say = (code: string) => g.errors[code] ?? g.errors.server_error;

  const [fundId, setFundId] = useState(funds[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [medium, setMedium] = useState<"mobile money" | "orange money">("mobile money");
  const [phone, setPhone] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState(""); // hidden: a person leaves it empty, a bot fills it
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [gift, setGift] = useState<{ id: string; token: string } | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [reason, setReason] = useState("");
  const [refundMsg, setRefundMsg] = useState("");
  const [refundBusy, setRefundBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fund = funds.find((f) => f.id === fundId) ?? null;

  // A returning donor (refresh, bookmark): the gift and its key are in the address.
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      const id = q.get("gift"), tk = q.get("t");
      if (id && tk) setGift({ id, token: tk });
    } catch {
      /* no address to read */
    }
  }, []);

  const poll = useCallback(
    async (id: string, token: string): Promise<View | null> => {
      try {
        const res = await fetch(`/api/public/church-gifts/${encodeURIComponent(id)}?t=${encodeURIComponent(token)}`, { cache: "no-store" });
        const d = await res.json().catch(() => null);
        if (!res.ok || !d?.ok) {
          if (res.status === 404) setError(say("gift_not_found"));
          return null;
        }
        setView(d as View);
        return d as View;
      } catch {
        return null; // a dropped connection: try again at the next tick
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [g]
  );

  useEffect(() => {
    if (!gift) return;
    let stopped = false;
    const tick = async (delay: number) => {
      timer.current = setTimeout(async () => {
        if (stopped) return;
        const v = await poll(gift.id, gift.token);
        if (stopped) return;
        if (!v || v.state === "pending") tick(POLL_MS);
      }, delay);
    };
    tick(POLL_FIRST_MS);
    poll(gift.id, gift.token).then((v) => {
      if (v && v.state !== "pending") {
        stopped = true;
        if (timer.current) clearTimeout(timer.current);
      }
    });
    return () => {
      stopped = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [gift, poll]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const n = Number(amount.replace(/[\s,.]/g, ""));
    if (!Number.isInteger(n) || n <= 0) return setError(say("invalid_amount"));
    if (n < GIFT_MIN_XAF) return setError(say("amount_below_minimum"));
    if (n > GIFT_MAX_XAF) return setError(say("amount_above_maximum"));
    setBusy(true);
    try {
      const res = await fetch("/api/public/church-gifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: church.username, fund_id: fundId, amount_xaf: n, phone, medium, is_anonymous: anonymous, donor_name: name, donor_contact: contact, donor_email: email, language: lang, website }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) {
        setBusy(false);
        return setError(say(d?.error ?? "server_error"));
      }
      setPhone(""); // sent once; not kept on screen
      setGift({ id: d.gift_id, token: d.access_token });
      setView({ gift_id: d.gift_id, state: "pending", amount_xaf: d.amount_xaf, expires_at: d.expires_at });
      try {
        window.history.replaceState(null, "", `?gift=${encodeURIComponent(d.gift_id)}&t=${encodeURIComponent(d.access_token)}`);
      } catch {
        /* the address cannot be changed: the tab still holds the key */
      }
    } catch {
      setError(say("server_error"));
    }
    setBusy(false);
  };

  const startOver = () => {
    setGift(null);
    setView(null);
    setError("");
    try {
      window.history.replaceState(null, "", window.location.pathname);
    } catch {
      /* nothing to reset */
    }
  };

  const refund = async () => {
    if (!gift) return;
    setRefundBusy(true);
    setRefundMsg("");
    try {
      const res = await fetch(`/api/public/church-gifts/${encodeURIComponent(gift.id)}/refund-request`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ t: gift.token, reason }) });
      const d = await res.json().catch(() => null);
      setRefundMsg(res.ok && d?.ok ? g.refundSent : say(d?.error ?? "server_error"));
    } catch {
      setRefundMsg(say("server_error"));
    }
    setRefundBusy(false);
  };

  const card = `border p-5 sm:p-6 ${theme.radiusClass}`;
  const cardStyle = { borderColor: theme.borderTint, backgroundColor: hexToRgba("#FFFFFF", 0.6) };
  const input = "block min-h-[48px] w-full rounded-xl border bg-white px-3 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";
  const inputStyle = { borderColor: theme.borderTint, color: theme.textColor, outlineColor: theme.accentText };
  const btn = "inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full px-6 text-[0.95rem] font-semibold transition hover:brightness-95 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";
  const btnStyle = { backgroundColor: theme.accent, color: "#fff", outlineColor: theme.accentText };

  const heading = (
    <header>
      <h1 className="text-[2rem] font-semibold leading-tight tracking-[-0.01em] sm:text-[2.4rem]" style={{ fontFamily: SERIF }}>
        {g.title}
      </h1>
      <p className="mt-3 max-w-[60ch] text-[0.975rem] leading-relaxed" style={{ opacity: 0.8 }}>
        {g.intro}
      </p>
    </header>
  );

  // ---- a gift in progress, or finished ---------------------------------------------------------------------------------------------------------------------------
  if (gift) {
    const r = view?.receipt;
    return (
      <section aria-labelledby="church-give-title" className="flex flex-col gap-5">
        {heading}
        <div className={card} style={cardStyle} aria-live="polite">
          {!view || view.state === "pending" ? (
            <div className="flex items-start gap-3">
              <Loader2 size={22} className="mt-0.5 shrink-0 animate-spin" style={{ color: theme.accentText }} aria-hidden="true" />
              <div>
                <p className="text-base font-semibold">{g.waiting}</p>
                <p className="mt-1 text-sm leading-relaxed" style={{ opacity: 0.8 }}>
                  {g.approve}
                </p>
                {error && (
                  <p role="alert" className="mt-2 text-sm text-red-700">
                    {error}
                  </p>
                )}
              </div>
            </div>
          ) : view.state === "succeeded" && r ? (
            <div className="receipt">
              <div className="flex items-center gap-2" style={{ color: theme.accentText }}>
                <Check size={20} aria-hidden="true" />
                <h2 className="text-xl font-semibold" style={{ fontFamily: SERIF }}>
                  {g.thanks}
                </h2>
              </div>
              <h3 className="mt-4 text-sm font-semibold uppercase tracking-wide" style={{ opacity: 0.7 }}>
                {g.receipt}
              </h3>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[0.95rem]">
                {[
                  [g.receiptNumber, r.receipt_number ?? "—"],
                  [g.church, r.church_name ?? church.name],
                  [g.fundLabel, (lang === "fr" ? r.fund_title_fr : r.fund_title_en) ?? (r.fund_kind === "care" ? g.kind.care : g.kind.giving)],
                  [g.date, r.confirmed_at ? new Date(r.confirmed_at).toLocaleString(lang === "fr" ? "fr-FR" : "en-GB", { dateStyle: "long", timeStyle: "short", timeZone: "Africa/Douala" }) : "—"],
                  [g.amountPaid, `${num(r.amount_xaf)} XAF`],
                  [g.fee, g.noFee],
                  [g.donor, r.anonymous ? g.anonymousDonor : r.donor_name || g.anonymousDonor],
                  [g.reference, r.reference],
                ].map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt style={{ opacity: 0.7 }}>{k}</dt>
                    <dd className="min-w-0 break-words font-medium">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-4 text-sm leading-relaxed" style={{ opacity: 0.8 }}>
                {g.keep}
              </p>
              <div className="mt-4 flex flex-wrap gap-3 print:hidden">
                <button type="button" className={btn} style={btnStyle} onClick={() => window.print()}>
                  <Printer size={16} aria-hidden="true" />
                  {g.print}
                </button>
              </div>
              <div className="mt-6 border-t pt-4 print:hidden" style={{ borderColor: theme.borderTint }}>
                <h3 className="text-sm font-semibold">{g.refundTitle}</h3>
                {view.refund_open ? (
                  <>
                    <p className="mt-1 text-sm leading-relaxed" style={{ opacity: 0.8 }}>
                      {g.refundHelp}
                    </p>
                    <label htmlFor="gv-reason" className="mt-3 block text-sm font-medium">
                      {g.refundReason}
                    </label>
                    <textarea id="gv-reason" rows={2} maxLength={500} className={`${input} mt-1 py-2`} style={inputStyle} value={reason} onChange={(e) => setReason(e.target.value)} />
                    <button type="button" disabled={refundBusy || reason.trim() === ""} onClick={refund} className={`${btn} mt-3`} style={btnStyle}>
                      {refundBusy ? g.refundSending : g.refundSend}
                    </button>
                  </>
                ) : (
                  <p className="mt-1 text-sm" style={{ opacity: 0.8 }}>
                    {g.refundClosed}
                  </p>
                )}
                {refundMsg && (
                  <p role="status" className="mt-2 text-sm">
                    {refundMsg}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div>
              <p className="text-base font-semibold">{view.state === "failed" ? g.failed : view.state === "expired" ? g.expired : view.state === "refunded" ? g.refunded : g.review}</p>
              {(view.state === "failed" || view.state === "expired") && (
                <button type="button" className={`${btn} mt-4`} style={btnStyle} onClick={startOver}>
                  {g.again}
                </button>
              )}
            </div>
          )}
        </div>
      </section>
    );
  }

  // ---- the form --------------------------------------------------------------------------------------------------------------------------------------------------
  if (funds.length === 0) {
    return (
      <section aria-labelledby="church-give-title" className="flex flex-col gap-5">
        {heading}
        <p className="max-w-[60ch] rounded-2xl border border-dashed px-5 py-6 text-[0.975rem] leading-relaxed" style={{ borderColor: theme.borderTint }}>
          {g.none}
        </p>
      </section>
    );
  }
  return (
    <section aria-labelledby="church-give-title" className="flex flex-col gap-5">
      {heading}
      <form onSubmit={submit} noValidate className={`${card} flex flex-col gap-4`} style={cardStyle}>
        <div>
          <label htmlFor="gv-fund" className="mb-1 block text-sm font-medium">
            {g.fund}
          </label>
          <select id="gv-fund" className={input} style={inputStyle} value={fundId} onChange={(e) => setFundId(e.target.value)}>
            {funds.map((f) => (
              <option key={f.id} value={f.id}>
                {lang === "fr" ? f.title_fr : f.title_en} ({g.kind[f.kind]})
              </option>
            ))}
          </select>
          {fund && (lang === "fr" ? fund.description_fr : fund.description_en) && (
            <p className="mt-2 text-sm leading-relaxed" style={{ opacity: 0.8 }}>
              {lang === "fr" ? fund.description_fr : fund.description_en}
            </p>
          )}
          {fund?.goal_xaf ? (
            <p className="mt-1 text-xs" style={{ opacity: 0.7 }}>
              {g.goal(num(fund.goal_xaf))}
            </p>
          ) : null}
          {fund?.kind === "care" && (
            <p role="note" className="mt-2 rounded-xl border px-3 py-2 text-sm leading-relaxed" style={{ borderColor: theme.borderTint }}>
              {g.careNotice}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="gv-amount" className="mb-1 block text-sm font-medium">
            {g.amount}
          </label>
          <input id="gv-amount" inputMode="numeric" autoComplete="off" className={`${input} sm:max-w-[260px]`} style={inputStyle} value={amount} onChange={(e) => setAmount(e.target.value)} />
          <p className="mt-1 text-xs" style={{ opacity: 0.7 }}>
            {g.amountHint(num(GIFT_MIN_XAF))}
          </p>
        </div>
        <fieldset>
          <legend className="mb-1 text-sm font-medium">{g.medium}</legend>
          <div className="flex flex-wrap gap-4">
            {(
              [
                ["mobile money", g.mtn],
                ["orange money", g.orange],
              ] as const
            ).map(([v, label]) => (
              <label key={v} className="flex min-h-[44px] items-center gap-2 text-sm">
                <input type="radio" name="gv-medium" checked={medium === v} onChange={() => setMedium(v)} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor="gv-phone" className="mb-1 block text-sm font-medium">
            {g.phone}
          </label>
          <input id="gv-phone" type="tel" inputMode="tel" autoComplete="tel" className={`${input} sm:max-w-[260px]`} style={inputStyle} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="6XX XXX XXX" />
          <p className="mt-1 text-xs" style={{ opacity: 0.7 }}>
            {g.phoneHint}
          </p>
        </div>
        <label htmlFor="gv-anon" className="flex min-h-[44px] items-center gap-3 text-sm font-medium">
          <input id="gv-anon" type="checkbox" className="h-5 w-5" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
          {g.anonymous}
        </label>
        {!anonymous && (
          <>
            <div>
              <label htmlFor="gv-name" className="mb-1 block text-sm font-medium">
                {g.name} <span style={{ opacity: 0.6 }}>({g.optional})</span>
              </label>
              <input id="gv-name" autoComplete="name" maxLength={120} className={input} style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label htmlFor="gv-contact" className="mb-1 block text-sm font-medium">
                {g.contact} <span style={{ opacity: 0.6 }}>({g.optional})</span>
              </label>
              <input id="gv-contact" maxLength={120} className={input} style={inputStyle} value={contact} onChange={(e) => setContact(e.target.value)} />
            </div>
          </>
        )}
        <div>
          <label htmlFor="gv-email" className="mb-1 block text-sm font-medium">
            {g.email} <span style={{ opacity: 0.6 }}>({g.optional})</span>
          </label>
          <input id="gv-email" type="email" autoComplete="email" maxLength={200} className={input} style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} />
          <p className="mt-1 text-xs" style={{ opacity: 0.7 }}>
            {g.emailHint}
          </p>
        </div>
        <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
          <label htmlFor="gv-website">Website</label>
          <input id="gv-website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </div>
        {error && (
          <p role="alert" className="text-sm font-medium text-red-700">
            {error}
          </p>
        )}
        <div>
          <button type="submit" disabled={busy || !fundId} className={btn} style={btnStyle}>
            {busy && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
            {busy ? g.submitting : g.submit}
          </button>
        </div>
      </form>
    </section>
  );
}
