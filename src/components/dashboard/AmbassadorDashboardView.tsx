"use client";

import { useState } from "react";
import { Check, Copy, Users, TrendingUp, Wallet } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import AmbassadorCodeEditor from "@/components/dashboard/AmbassadorCodeEditor";
import { EarningsHero, STAGE_STYLES, StageChip, StatTile } from "@/components/dashboard/ambassadorParts";
import { formatPrice } from "@/lib/currency";
import type { AmbassadorOverview } from "@/lib/ambassador/dashboard";

// Ambassador Program (Phase D) — purely a display of what
// getMyAmbassadorOverview() (server-side, session-derived, read-only)
// already computed. Nothing here writes to any table, calls any API
// route, or accepts an id from anywhere but that one server-resolved
// overview object — there is no client-side path to another Ambassador's
// data at all.
//
// Reading order: what you have earned, how much of it is ready to be paid out, how many cards and how much revenue it came from, then
// the one thing to do (share your link), then who needs a follow-up and the sales themselves. The sales are a table from the small
// breakpoint up and a stacked list on a phone, so nothing scrolls sideways there.
export default function AmbassadorDashboardView({ overview, siteUrl }: { overview: AmbassadorOverview; siteUrl: string }) {
  const { t, locale } = useLanguage();
  const c = t.ambassadorDashboard;
  const [copied, setCopied] = useState(false);

  const link = `${siteUrl.replace(/\/$/, "")}/get-started-cards?amb=${overview.ambassador.salesCode}`;
  const fmt = (n: number) => formatPrice(n, "XAF", locale);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked — the link is still selectable text
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 flex flex-col gap-5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-xl font-semibold text-ringo-text tracking-[-0.01em]">{c.title}</h1>
          <p className="text-sm text-ringo-muted mt-1">{c.subtitle}</p>
        </div>
        {overview.ambassador.status === "active" && (
          <span className="shrink-0 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">{c.activeStatus}</span>
        )}
      </header>

      <EarningsHero
        label={c.summary.earned}
        value={fmt(overview.summary.commissionEarned)}
        items={[
          { label: c.summary.eligible, value: fmt(overview.summary.commissionEligible) },
          { label: c.summary.paid, value: fmt(overview.summary.commissionPaid) },
        ]}
      />

      <div className="grid grid-cols-2 gap-3">
        <StatTile icon={Users} label={c.summary.cardsSold} value={String(overview.summary.cardsSold)} />
        <StatTile icon={TrendingUp} label={c.summary.revenue} value={fmt(overview.summary.revenueAttributed)} />
        {overview.summary.commissionReversed > 0 && <StatTile icon={Wallet} label={c.summary.reversed} value={fmt(overview.summary.commissionReversed)} />}
      </div>

      <section className="rounded-2xl border border-ringo-border/70 bg-ringo-surface p-4 flex flex-col gap-3">
        <AmbassadorCodeEditor code={overview.ambassador.salesCode} />
        <div>
          <p className="text-xs text-ringo-muted mb-1">{c.yourLink}</p>
          <div className="flex items-center gap-2">
            <a href={link} target="_blank" rel="noopener noreferrer" title={t.ambassadorCode.openLink} className="flex min-h-[44px] flex-1 min-w-0 items-center text-xs bg-ringo-muted/[0.06] rounded-lg px-2.5 text-ringo-indigo hover:underline"><span className="truncate">
              {link}</span>
            </a>
            <button
              type="button"
              onClick={copyLink}
              className="shrink-0 inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium px-3.5 rounded-lg bg-ringo-indigo text-white hover:opacity-90 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/50 focus-visible:ring-offset-2"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? c.copied : c.copy}
            </button>
          </div>
        </div>
        <p className="text-xs text-ringo-muted">{overview.ambassador.teamName ? c.team(overview.ambassador.teamName) : c.noTeam}</p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-ringo-text">{c.followUpTitle}</h2>
        {overview.followUp.length === 0 ? (
          <p className="text-sm text-ringo-muted">{c.followUpEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {overview.followUp.map((f) => (
              <li key={f.saleId} className="rounded-xl border border-ringo-border/60 bg-ringo-surface px-3.5 py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ringo-text truncate">{f.customerName || f.whatsapp || c.noWhatsapp}</p>
                  <p className="text-xs text-ringo-muted mt-0.5">{c.nextAction[f.nextAction]}</p>
                </div>
                <StageChip stage={f.stage} label={c.stages[f.stage]} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-ringo-text">{c.salesTitle}</h2>
        {overview.sales.length === 0 ? (
          <p className="text-sm text-ringo-muted">{c.noSales}</p>
        ) : (
          <>
            <ul className="flex flex-col gap-2 sm:hidden">
              {overview.sales.map((s) => (
                <li key={s.id} className="rounded-xl border border-ringo-border/60 bg-ringo-surface px-3.5 py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ringo-text truncate">{s.customer?.name || s.customer?.whatsapp || "—"}</p>
                    <p className="text-xs text-ringo-muted mt-0.5">{s.cardType} · {new Date(s.attributedAt).toLocaleDateString(locale)}</p>
                  </div>
                  <StageChip stage={s.stage} label={c.stages[s.stage]} />
                </li>
              ))}
            </ul>
            <div className="hidden sm:block rounded-2xl border border-ringo-border/60 bg-ringo-surface overflow-x-auto">
              <table className="w-full min-w-max whitespace-nowrap text-sm">
                <thead>
                  <tr className="text-left text-xs text-ringo-muted border-b border-ringo-border/60">
                    <th className="px-3.5 py-2.5 font-medium">{c.customer}</th>
                    <th className="px-3.5 py-2.5 font-medium">{c.cardType}</th>
                    <th className="px-3.5 py-2.5 font-medium">{c.status}</th>
                    <th className="px-3.5 py-2.5 font-medium">{c.date}</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.sales.map((s) => (
                    <tr key={s.id} className="border-b border-ringo-border/40 last:border-0">
                      <td className="px-3.5 py-2.5 text-ringo-text">{s.customer?.name || s.customer?.whatsapp || "—"}</td>
                      <td className="px-3.5 py-2.5 text-ringo-muted">{s.cardType}</td>
                      <td className="px-3.5 py-2.5">
                        <span className={`text-[11px] font-medium px-2 py-1 rounded-full ${STAGE_STYLES[s.stage]}`}>{c.stages[s.stage]}</span>
                      </td>
                      <td className="px-3.5 py-2.5 text-ringo-muted">{new Date(s.attributedAt).toLocaleDateString(locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
