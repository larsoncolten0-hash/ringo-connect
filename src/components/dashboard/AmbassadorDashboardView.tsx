"use client";

import { useState } from "react";
import { Check, Copy, Users, Wallet, TrendingUp, CheckCircle2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import AmbassadorCodeEditor from "@/components/dashboard/AmbassadorCodeEditor";
import { formatPrice } from "@/lib/currency";
import type { AmbassadorOverview, AmbassadorSaleStage } from "@/lib/ambassador/dashboard";

// Ambassador Program (Phase D) — purely a display of what
// getMyAmbassadorOverview() (server-side, session-derived, read-only)
// already computed. Nothing here writes to any table, calls any API
// route, or accepts an id from anywhere but that one server-resolved
// overview object — there is no client-side path to another Ambassador's
// data at all.

const STAGE_STYLES: Record<AmbassadorSaleStage, string> = {
  payment_pending: "bg-amber-500/10 text-amber-600",
  payment_confirmed: "bg-sky-500/10 text-sky-600",
  profile_incomplete: "bg-amber-500/10 text-amber-600",
  profile_complete: "bg-indigo-500/10 text-indigo-600",
  fully_activated: "bg-emerald-500/10 text-emerald-600",
  disputed: "bg-ringo-coral/10 text-ringo-coral",
  voided: "bg-ringo-muted/10 text-ringo-muted",
  refunded: "bg-ringo-coral/10 text-ringo-coral",
};

function StatTile({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-ringo-border/60 bg-ringo-surface p-4 flex flex-col gap-1.5">
      <span className="w-8 h-8 rounded-xl bg-ringo-indigo/10 flex items-center justify-center">
        <Icon size={15} className="text-ringo-indigo" strokeWidth={2.25} />
      </span>
      <p className="text-xs text-ringo-muted">{label}</p>
      <p className="text-lg font-semibold text-ringo-text tracking-[-0.01em]">{value}</p>
    </div>
  );
}

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
    <div className="max-w-4xl mx-auto px-4 py-6 flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ringo-text tracking-[-0.01em]">{c.title}</h1>
        <p className="text-sm text-ringo-muted mt-1">{c.subtitle}</p>
      </div>

      <div className="rounded-2xl border border-ringo-border/60 bg-ringo-surface p-4 flex flex-col gap-3">
        <AmbassadorCodeEditor code={overview.ambassador.salesCode} />
        <div>
          <p className="text-xs text-ringo-muted mb-1">{c.yourLink}</p>
          <div className="flex items-center gap-2">
            <a href={link} target="_blank" rel="noopener noreferrer" title={t.ambassadorCode.openLink} className="flex-1 min-w-0 truncate text-xs bg-ringo-muted/[0.06] rounded-lg px-2.5 py-2 text-ringo-indigo hover:underline">
              {link}
            </a>
            <button
              type="button"
              onClick={copyLink}
              className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-2 rounded-lg border border-ringo-border text-ringo-muted hover:text-ringo-text transition"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? c.copied : c.copy}
            </button>
          </div>
        </div>
        <p className="text-xs text-ringo-muted">{overview.ambassador.teamName ? c.team(overview.ambassador.teamName) : c.noTeam}</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatTile icon={Users} label={c.summary.cardsSold} value={String(overview.summary.cardsSold)} />
        <StatTile icon={TrendingUp} label={c.summary.revenue} value={fmt(overview.summary.revenueAttributed)} />
        <StatTile icon={Wallet} label={c.summary.earned} value={fmt(overview.summary.commissionEarned)} />
        <StatTile icon={Wallet} label={c.summary.eligible} value={fmt(overview.summary.commissionEligible)} />
        <StatTile icon={CheckCircle2} label={c.summary.paid} value={fmt(overview.summary.commissionPaid)} />
        {overview.summary.commissionReversed > 0 && <StatTile icon={Wallet} label={c.summary.reversed} value={fmt(overview.summary.commissionReversed)} />}
      </div>

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
                <span className={`shrink-0 text-[11px] font-medium px-2 py-1 rounded-full ${STAGE_STYLES[f.stage]}`}>{c.stages[f.stage]}</span>
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
          <div className="rounded-2xl border border-ringo-border/60 bg-ringo-surface overflow-x-auto">
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
        )}
      </section>
    </div>
  );
}
