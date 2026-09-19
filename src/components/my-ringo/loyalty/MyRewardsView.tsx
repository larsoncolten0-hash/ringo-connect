"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Gift, QrCode } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import type { CustomerPackage, CustomerProgress, CustomerReward, CustomerRewardsData } from "@/lib/loyalty/customerView";
import { actionText, fmtDate, fmtDateTime, fmtMoney, fmtNumber } from "@/components/loyalty/format";
import EmptyState from "@/components/my-ringo/EmptyState";
import LoyaltyPrefsCard from "./LoyaltyPrefsCard";

// My Ringo -> My Rewards. Everything shown is real database state resolved on the server for the
// signed-in customer (see getCustomerRewards); this component only formats it. The page
// re-reads whenever the customer returns to the app, so progress a business just recorded shows
// up without a manual reload.
const TONE: Record<string, string> = {
  available: "bg-emerald-500/10 text-emerald-600",
  active: "bg-emerald-500/10 text-emerald-600",
  upcoming: "bg-sky-500/10 text-sky-600",
  redeemed: "bg-ringo-muted/15 text-ringo-muted",
  completed: "bg-ringo-muted/15 text-ringo-muted",
  expired: "bg-amber-500/10 text-amber-600",
  voided: "bg-red-500/10 text-red-600",
  cancelled: "bg-red-500/10 text-red-600",
};

function Chip({ status, label }: { status: string; label: string }) {
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE[status] ?? TONE.redeemed}`}>{label}</span>;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 text-sm font-semibold text-ringo-text">{children}</h2>;
}

function Bar({ pct, done }: { pct: number; done: boolean }) {
  const v = Math.min(Math.max(pct, 0), 100);
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-ringo-muted/15" role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full transition-all ${done ? "bg-ringo-teal" : "bg-ringo-indigo"}`} style={{ width: `${v}%` }} />
    </div>
  );
}

export default function MyRewardsView({
  data,
  loadError,
  prefs,
  emailConfirmed,
}: {
  data: CustomerRewardsData;
  loadError: boolean;
  prefs: { notificationsEnabled: boolean; emailEnabled: boolean };
  emailConfirmed: boolean;
}) {
  const { t, locale } = useLanguage();
  const L = t.loyalty;
  const r = t.myRingo.loyalty.rewards;
  const router = useRouter();

  // Re-read from the server whenever the customer comes back to the app or tab.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [router]);

  const daysUntil = (iso: string) => Math.ceil((new Date(iso).getTime() - Date.now()) / 864e5);

  const progressLabel = (p: CustomerProgress) => {
    const shown = Math.min(p.progress, p.target);
    if (p.type === "spend") return `${fmtMoney(shown, p.currency, locale)} / ${fmtMoney(p.target, p.currency, locale)}`;
    if (p.type === "points") return `${fmtNumber(shown, locale)} / ${fmtNumber(p.target, locale)} ${r.points}`;
    return `${shown} / ${p.target} ${actionText(L, p.actionKey).many}`;
  };
  const remainingLabel = (p: CustomerProgress) => {
    const rem = Math.max(p.target - p.progress, 0);
    if (p.type === "spend") return r.remainingAmount(fmtMoney(rem, p.currency, locale));
    if (p.type === "points") return r.remainingAmount(`${fmtNumber(rem, locale)} ${r.points}`);
    return r.remainingCount(rem, rem === 1 ? actionText(L, p.actionKey).one : actionText(L, p.actionKey).many);
  };

  const rewardMeta = (rw: CustomerReward) => {
    if (rw.status === "available") return rw.expiresAt ? r.expiresIn(daysUntil(rw.expiresAt)) : r.noExpiry;
    if (rw.status === "redeemed") return r.redeemedOn(fmtDate(rw.redeemedAt, locale));
    if (rw.status === "expired") return rw.expiresAt ? r.expiresOn(fmtDate(rw.expiresAt, locale)) : "";
    return r.earnedOn(fmtDate(rw.earnedAt, locale));
  };

  const packageCard = (p: CustomerPackage, muted = false) => (
    <div key={p.id} className={`rounded-2xl border border-ringo-border/70 bg-ringo-surface p-4 ${muted ? "opacity-75" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ringo-text">{p.name}</p>
          <p className="truncate text-xs text-ringo-muted">{p.business.name}</p>
        </div>
        <Chip status={p.status} label={r.status[p.status] ?? p.status} />
      </div>
      <div className="mt-3 flex flex-col gap-2.5">
        {p.credits.map((c) => (
          <div key={c.id}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate text-ringo-text">{actionText(L, c.actionKey).many}</span>
              <span className="shrink-0 font-medium text-ringo-text">{r.creditsLeft(Math.max(c.remaining, 0), c.total)}</span>
            </div>
            <Bar pct={c.total > 0 ? (Math.max(c.remaining, 0) / c.total) * 100 : 0} done={c.remaining <= 0} />
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-ringo-muted">{p.status === "upcoming" ? r.startsOn(fmtDate(p.startsAt, locale)) : r.validUntil(fmtDate(p.endsAt, locale))}</p>
    </div>
  );

  const nothing =
    data.ready.length === 0 &&
    data.progress.length === 0 &&
    data.packages.length === 0 &&
    data.history.rewards.length === 0 &&
    data.history.packages.length === 0 &&
    data.history.activity.length === 0;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-ringo-text">{r.title}</h1>
        <p className="mt-1 text-sm text-ringo-muted">{r.subtitle}</p>
      </div>

      {loadError && (
        <p role="alert" className="flex items-start gap-2 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-500">
          <AlertCircle size={16} className="mt-0.5 shrink-0" /> {r.unavailable}
        </p>
      )}

      {!loadError && nothing ? (
        <EmptyState icon={Gift} title={r.emptyTitle} body={r.emptyBody} />
      ) : (
        <>
          <section>
            <SectionTitle>{r.readyTitle}</SectionTitle>
            {data.ready.length === 0 ? (
              <p className="text-sm text-ringo-muted">{r.readyEmpty}</p>
            ) : (
              <div className="flex flex-col gap-3">
                {data.ready.map((rw) => (
                  <div key={rw.id} className="rounded-2xl border border-ringo-teal/40 bg-ringo-teal/[0.06] p-4">
                    <div className="flex items-start gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ringo-teal/15 text-ringo-teal">
                        <Gift size={20} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="truncate text-base font-bold text-ringo-text">{rw.title}</p>
                          <Chip status={rw.status} label={r.status.available} />
                        </div>
                        <p className="truncate text-sm text-ringo-muted">{rw.business.name}</p>
                        <p className="mt-1 text-xs text-ringo-muted">{rewardMeta(rw)}</p>
                      </div>
                    </div>
                    <p className="mt-3 text-xs text-ringo-muted">{r.showAtBusiness(rw.business.name)}</p>
                    <Link href="/my-ringo/qr" className="mt-3 inline-flex items-center gap-2 rounded-xl bg-ringo-indigo px-4 py-2.5 text-sm font-semibold text-white">
                      <QrCode size={15} /> {r.showQr}
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <SectionTitle>{r.progressTitle}</SectionTitle>
            {data.progress.length === 0 ? (
              <p className="text-sm text-ringo-muted">{r.progressEmpty}</p>
            ) : (
              <div className="flex flex-col gap-3">
                {data.progress.map((p) => (
                  <div key={p.programId} className="rounded-2xl border border-ringo-border/70 bg-ringo-surface p-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ringo-text">{p.programName}</p>
                        <p className="truncate text-xs text-ringo-muted">{p.business.name}</p>
                      </div>
                      <p className="shrink-0 text-sm font-semibold text-ringo-text">{progressLabel(p)}</p>
                    </div>
                    <div className="mt-2.5">
                      <Bar pct={(Math.min(p.progress, p.target) / p.target) * 100} done={p.rewardReady} />
                    </div>
                    <p className="mt-2 text-xs text-ringo-muted">{p.rewardReady ? `${p.rewardTitle} · ${r.status.available}` : remainingLabel(p)}</p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <SectionTitle>{r.packagesTitle}</SectionTitle>
            {data.packages.length === 0 ? <p className="text-sm text-ringo-muted">{r.packagesEmpty}</p> : <div className="flex flex-col gap-3">{data.packages.map((p) => packageCard(p))}</div>}
          </section>

          <section>
            <SectionTitle>{r.historyTitle}</SectionTitle>
            {data.history.rewards.length === 0 && data.history.packages.length === 0 && data.history.activity.length === 0 ? (
              <p className="text-sm text-ringo-muted">{r.historyEmpty}</p>
            ) : (
              <div className="flex flex-col gap-5">
                {data.history.rewards.length > 0 && (
                  <div>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ringo-muted">{r.historyRewards}</h3>
                    <ul className="overflow-hidden rounded-2xl border border-ringo-border/70 bg-ringo-surface">
                      {data.history.rewards.map((rw) => (
                        <li key={rw.id} className="flex items-start justify-between gap-3 border-b border-ringo-border/60 px-4 py-3 last:border-0">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-ringo-text">{rw.title}</p>
                            <p className="truncate text-xs text-ringo-muted">
                              {rw.business.name} · {rewardMeta(rw)}
                            </p>
                          </div>
                          <Chip status={rw.status} label={r.status[rw.status] ?? rw.status} />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {data.history.packages.length > 0 && (
                  <div>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ringo-muted">{r.historyPackages}</h3>
                    <div className="flex flex-col gap-3">{data.history.packages.map((p) => packageCard(p, true))}</div>
                  </div>
                )}
                {data.history.activity.length > 0 && (
                  <div>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ringo-muted">{r.historyActivity}</h3>
                    <ul className="overflow-hidden rounded-2xl border border-ringo-border/70 bg-ringo-surface">
                      {data.history.activity.map((a) => {
                        const label = actionText(L, a.actionKey);
                        const abs = Math.abs(a.quantity);
                        const sign = a.quantity > 0 ? "+" : "−";
                        return (
                          <li key={a.id} className="border-b border-ringo-border/60 px-4 py-3 last:border-0">
                            <p className="truncate text-sm font-medium text-ringo-text">
                              {sign}
                              {abs} {abs === 1 ? label.one : label.many}
                              <span className="font-normal text-ringo-muted"> · {a.packageName ? a.packageName : a.programName}</span>
                            </p>
                            <p className="truncate text-xs text-ringo-muted" suppressHydrationWarning>
                              {a.business.name} · {fmtDateTime(a.at, locale)}
                            </p>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </section>
        </>
      )}

      <LoyaltyPrefsCard initial={prefs} emailConfirmed={emailConfirmed} />
    </div>
  );
}
