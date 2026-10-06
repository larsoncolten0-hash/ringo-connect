"use client";

import Link from "next/link";
import { Camera, Gift } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import type { ProgramRow } from "@/lib/loyalty/programs";
import type { OverviewStats } from "@/lib/loyalty/history";
import { actionText, fmtMoney, fmtNumber } from "@/components/loyalty/format";

// The first screen: a big Scan Customer button, a few numbers, and the current program(s).
export default function LoyaltyOverview({
  can,
  programs,
  stats,
}: {
  can: { scan: boolean; manage: boolean; reverse: boolean };
  programs: ProgramRow[];
  stats: OverviewStats | null;
}) {
  const { t, locale } = useLanguage();
  const L = t.loyalty;
  const activePrograms = programs.filter((p) => p.active);

  const summary = (p: ProgramRow) => {
    if (p.type === "spend") return L.overview.summarySpend(fmtMoney(p.target, p.currency, locale), p.reward_title);
    if (p.type === "points") return L.overview.summaryPoints(p.target, p.reward_title);
    return L.overview.summaryVisits(p.target, actionText(L, p.action_key).many, p.reward_title);
  };

  const cards = stats
    ? [
        { label: L.overview.members, value: fmtNumber(stats.members, locale) },
        { label: L.overview.rewardsReady, value: fmtNumber(stats.rewardsReady, locale) },
        { label: L.overview.activitiesMonth, value: fmtNumber(stats.activitiesMonth, locale) },
        { label: L.overview.rewardsRedeemed, value: fmtNumber(stats.rewardsRedeemed, locale) },
      ]
    : [];
  const secondary = stats
    ? [
        { label: L.overview.newMembers, value: fmtNumber(stats.newMembersMonth, locale) },
        { label: L.overview.activeMembers, value: fmtNumber(stats.activeMembers30d, locale) },
        { label: L.overview.redemptionRate, value: `${stats.redemptionRate}%` },
        { label: L.overview.activePackages, value: fmtNumber(stats.activePackages, locale) },
      ]
    : [];

  return (
    <div className="flex flex-col gap-5">
      {can.scan && (
        <Link
          href="/dashboard/loyalty/scan"
          className="ringo-tactile ringo-cta flex items-center justify-center gap-3 rounded-2xl px-6 py-5 text-lg font-bold"
        >
          <Camera size={24} aria-hidden="true" /> {L.scan.button}
        </Link>
      )}

      {can.manage && (
        <>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-ringo-muted">{L.overview.status}:</span>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${activePrograms.length > 0 ? "bg-emerald-500/10 text-emerald-600" : "bg-ringo-muted/15 text-ringo-muted"}`}>
              {activePrograms.length > 0 ? L.overview.statusActive : L.overview.statusInactive}
            </span>
          </div>

          {programs.length > 0 && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {cards.map((c) => (
                  <div key={c.label} className="rounded-card border border-ringo-border/70 bg-ringo-surface p-4">
                    <p className="mb-1 text-xs text-ringo-muted">{c.label}</p>
                    <p className="font-display text-3xl font-semibold tracking-[-0.02em] text-ringo-text tabular-nums" suppressHydrationWarning>
                      {c.value}
                    </p>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {secondary.map((c) => (
                  <div key={c.label} className="rounded-card border border-ringo-border/50 bg-ringo-surface/60 p-3">
                    <p className="mb-0.5 text-[11px] text-ringo-muted">{c.label}</p>
                    <p className="text-base font-semibold text-ringo-text" suppressHydrationWarning>
                      {c.value}
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}

          <section className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5">
            {programs.length === 0 ? (
              <div className="flex flex-col items-start gap-3">
                <span aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-full bg-ringo-indigo/10"><Gift size={22} className="text-ringo-indigo" /></span>
                <div>
                  <h2 className="text-base font-semibold text-ringo-text">{L.overview.noProgramTitle}</h2>
                  <p className="mt-1 text-sm text-ringo-muted">{L.overview.noProgramBody}</p>
                </div>
                <Link href="/dashboard/loyalty/setup" className="ringo-tactile ringo-cta inline-flex min-h-[44px] items-center rounded-xl px-5 text-sm font-semibold">
                  {L.overview.activate}
                </Link>
              </div>
            ) : (
              <>
                <h2 className="mb-3 text-sm font-semibold text-ringo-text">{programs.length === 1 ? L.overview.yourProgram : L.overview.yourPrograms}</h2>
                <div className="flex flex-col gap-3">
                  {programs.map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-3 border-b border-ringo-border/50 pb-3 last:border-0 last:pb-0">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ringo-text">
                          {p.name}
                          {!p.active && <span className="ml-2 rounded-full bg-ringo-muted/15 px-2 py-0.5 text-[10px] font-semibold text-ringo-muted">{L.overview.paused}</span>}
                        </p>
                        <p className="truncate text-sm text-ringo-muted">{summary(p)}</p>
                        {stats && stats.programProgress[p.id] !== undefined && (
                          <div className="mt-2">
                            <div
                              role="progressbar"
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={Math.round(stats.programProgress[p.id])}
                              aria-label={L.overview.avgProgress(stats.programProgress[p.id])}
                              className="h-1.5 w-full overflow-hidden rounded-full bg-ringo-indigo/10"
                            >
                              <div
                                className="h-full origin-left rounded-full bg-ringo-indigo transition-transform duration-700 ease-out motion-reduce:transition-none"
                                style={{ transform: `scaleX(${Math.min(100, Math.max(0, stats.programProgress[p.id])) / 100})` }}
                              />
                            </div>
                            <p className="mt-1 text-xs text-ringo-muted">{L.overview.avgProgress(stats.programProgress[p.id])}</p>
                          </div>
                        )}
                      </div>
                      <Link href="/dashboard/loyalty/setup" className="ringo-tactile inline-flex min-h-[44px] shrink-0 items-center rounded-full border border-ringo-border px-4 text-xs font-semibold text-ringo-text hover:border-ringo-indigo/40">
                        {L.overview.edit}
                      </Link>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
