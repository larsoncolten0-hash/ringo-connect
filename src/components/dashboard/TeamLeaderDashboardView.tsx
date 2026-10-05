"use client";

import { Users, Wallet, TrendingUp } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { EarningsHero, STAGE_STYLES, StageChip, StatTile } from "@/components/dashboard/ambassadorParts";
import { formatPrice } from "@/lib/currency";
import type { TeamOverview } from "@/lib/ambassador/teamDashboard";

// Ambassador Program (Phase E) — purely a display of what
// getMyTeamOverview() (server-side, session-derived, read-only) already
// computed. Nothing here writes to any table or accepts an id from
// anywhere but that one server-resolved overview object — there is no
// client-side path to another team's data at all. Financial figures are
// read-only here: a Team Leader has no control to edit them from this
// view, matching the approved security model.
//
// Same reading order as the Ambassador dashboard: the team, what it has earned for you, the cards and revenue behind it, then each
// Ambassador, who needs a follow-up, and the sales. Tables from the small breakpoint up; a stacked list on a phone.
export default function TeamLeaderDashboardView({ overview }: { overview: TeamOverview }) {
  const { t, locale } = useLanguage();
  const c = t.teamLeaderDashboard;
  const fmt = (n: number) => formatPrice(n, "XAF", locale);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 flex flex-col gap-5">
      <header>
        <h1 className="font-display text-xl font-semibold text-ringo-text tracking-[-0.01em]">{c.title}</h1>
        <p className="text-sm text-ringo-muted mt-1">{c.subtitle}</p>
      </header>

      <section aria-label={c.teamName} className="rounded-2xl border border-ringo-border/70 bg-ringo-surface p-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <p className="text-xs text-ringo-muted">{c.teamName}</p>
          <p className="break-words font-display text-lg font-semibold text-ringo-text">{overview.team.name}</p>
        </div>
        <dl className="flex gap-6">
          <div>
            <dt className="text-xs text-ringo-muted">{c.ambassadors}</dt>
            <dd className="text-lg font-semibold tabular-nums text-ringo-text">{overview.ambassadorCount}</dd>
          </div>
          <div>
            <dt className="text-xs text-ringo-muted">{c.activeLabel}</dt>
            <dd className="text-lg font-semibold tabular-nums text-ringo-text">{overview.activeAmbassadorCount}</dd>
          </div>
        </dl>
      </section>

      <EarningsHero
        label={c.summary.earned}
        value={fmt(overview.summary.teamLeaderCommissionEarned)}
        items={[
          { label: c.summary.eligible, value: fmt(overview.summary.teamLeaderCommissionEligible) },
          { label: c.summary.paid, value: fmt(overview.summary.teamLeaderCommissionPaid) },
        ]}
      />

      <div className="grid grid-cols-2 gap-3">
        <StatTile icon={Users} label={c.summary.cardsSold} value={String(overview.summary.cardsSold)} />
        <StatTile icon={TrendingUp} label={c.summary.revenue} value={fmt(overview.summary.revenueAttributed)} />
        {overview.summary.teamLeaderCommissionReversed > 0 && <StatTile icon={Wallet} label={c.summary.reversed} value={fmt(overview.summary.teamLeaderCommissionReversed)} />}
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-ringo-text">{c.ambassadorPerformanceTitle}</h2>
        <ul className="flex flex-col gap-2 sm:hidden">
          {overview.ambassadors.map((a) => (
            <li key={a.ambassadorId} className="rounded-xl border border-ringo-border/60 bg-ringo-surface px-3.5 py-3">
              <p className="text-sm font-semibold text-ringo-text">{a.salesCode}</p>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <div><dt className="text-ringo-muted">{c.cardsSoldCol}</dt><dd className="text-sm tabular-nums text-ringo-text">{a.cardsSold}</dd></div>
                <div><dt className="text-ringo-muted">{c.revenueCol}</dt><dd className="text-sm tabular-nums text-ringo-text">{fmt(a.revenue)}</dd></div>
                <div><dt className="text-ringo-muted">{c.activationRate}</dt><dd className="text-sm tabular-nums text-ringo-text">{Math.round(a.activationRate * 100)}%</dd></div>
                <div><dt className="text-ringo-muted">{c.commission}</dt><dd className="text-sm tabular-nums text-ringo-text">{fmt(a.commissionEarned)}</dd></div>
              </dl>
            </li>
          ))}
        </ul>
        <div className="hidden sm:block rounded-2xl border border-ringo-border/60 bg-ringo-surface overflow-x-auto">
          <table className="w-full min-w-max whitespace-nowrap text-sm">
            <thead>
              <tr className="text-left text-xs text-ringo-muted border-b border-ringo-border/60">
                <th className="px-3.5 py-2.5 font-medium">{c.salesCode}</th>
                <th className="px-3.5 py-2.5 font-medium">{c.cardsSoldCol}</th>
                <th className="px-3.5 py-2.5 font-medium">{c.revenueCol}</th>
                <th className="px-3.5 py-2.5 font-medium">{c.activationRate}</th>
                <th className="px-3.5 py-2.5 font-medium">{c.commission}</th>
              </tr>
            </thead>
            <tbody>
              {overview.ambassadors.map((a) => (
                <tr key={a.ambassadorId} className="border-b border-ringo-border/40 last:border-0">
                  <td className="px-3.5 py-2.5 text-ringo-text font-medium">{a.salesCode}</td>
                  <td className="px-3.5 py-2.5 text-ringo-muted">{a.cardsSold}</td>
                  <td className="px-3.5 py-2.5 text-ringo-muted">{fmt(a.revenue)}</td>
                  <td className="px-3.5 py-2.5 text-ringo-muted">{Math.round(a.activationRate * 100)}%</td>
                  <td className="px-3.5 py-2.5 text-ringo-muted">{fmt(a.commissionEarned)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
                  <p className="text-xs text-ringo-muted mt-0.5">
                    {f.ambassadorSalesCode} · {c.nextAction[f.nextAction]}
                  </p>
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
                    <p className="text-xs text-ringo-muted mt-0.5">{s.ambassadorSalesCode} · {s.cardType} · {new Date(s.attributedAt).toLocaleDateString(locale)}</p>
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
                    <th className="px-3.5 py-2.5 font-medium">{c.salesCode}</th>
                    <th className="px-3.5 py-2.5 font-medium">{c.cardType}</th>
                    <th className="px-3.5 py-2.5 font-medium">{c.status}</th>
                    <th className="px-3.5 py-2.5 font-medium">{c.date}</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.sales.map((s) => (
                    <tr key={s.id} className="border-b border-ringo-border/40 last:border-0">
                      <td className="px-3.5 py-2.5 text-ringo-text">{s.customer?.name || s.customer?.whatsapp || "—"}</td>
                      <td className="px-3.5 py-2.5 text-ringo-muted">{s.ambassadorSalesCode}</td>
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
