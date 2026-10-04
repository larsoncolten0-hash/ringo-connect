"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BarChart3, CircleCheck, ExternalLink, Eye, MousePointerClick, MessageCircle, Pencil, Plus, Share2, Flag } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import ProfileCompletionCard from "@/components/editor/ProfileCompletionCard";
import NextActionCard from "./NextActionCard";
import { useShareProfile } from "./useShareProfile";
import {
  milestoneHighlights,
  quickActions,
  visitsTrend,
  type HealthActivity,
  type Milestone,
  type ProfileHealth,
  type QuickActionId,
} from "@/lib/profileHealth";

export interface HomeActivity extends HealthActivity {
  linkClicks7d?: number;
  whatsappClicks7d?: number;
}

const card = "rounded-[20px] border border-ringo-border/60 bg-ringo-surface p-5 sm:p-6";
const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40";

// The greeting depends on the visitor's own clock, so it is chosen after mount (the server render
// uses the neutral wording and never mismatches).
function useGreeting(): "morning" | "afternoon" | "evening" | "generic" {
  const [part, setPart] = useState<"morning" | "afternoon" | "evening" | "generic">("generic");
  useEffect(() => {
    const h = new Date().getHours();
    setPart(h < 12 ? "morning" : h < 18 ? "afternoon" : "evening");
  }, []);
  return part;
}

const QUICK_ICONS: Record<QuickActionId, typeof Pencil> = {
  edit: Pencil,
  view: ExternalLink,
  share: Share2,
  addCatalog: Plus,
  editMenu: Pencil,
  addMusic: Plus,
  addEvent: Plus,
  analytics: BarChart3,
};

export default function RingoHome({
  firstName,
  profileId,
  profileUrl,
  shareTitle,
  health,
  activity,
  milestones,
}: {
  firstName: string;
  profileId: string;
  profileUrl: string;
  shareTitle: string;
  health: ProfileHealth;
  activity: HomeActivity;
  milestones: Milestone[];
}) {
  const { t, locale } = useLanguage();
  const g = t.guidance;
  const greeting = useGreeting();
  const { share, status } = useShareProfile(profileUrl, shareTitle);
  const fmt = (n: number | undefined) => (typeof n === "number" ? n.toLocaleString(locale === "fr" ? "fr-FR" : "en-US") : "—");

  const trend = visitsTrend(activity);
  const insight = trend && trend.direction !== "none" ? g.insight[trend.direction] : null;
  const noActivityYet = activity.totalPageViews === 0;
  const { achieved, next } = milestoneHighlights(milestones);
  const shownAchieved = achieved.slice(-3);
  const actions = quickActions(health);

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-6">
      <header>
        <h1 className="font-display text-xl sm:text-2xl font-medium text-ringo-text tracking-[-0.01em]">
          {g.home.greetingLine(g.home.greeting[greeting], firstName)}
        </h1>
        <p className="text-sm text-ringo-muted mt-1">{g.home.subtitle}</p>
      </header>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-6 lg:items-start flex flex-col gap-6">
        <div className="flex flex-col gap-6 min-w-0">
          <NextActionCard
            profileId={profileId}
            recommendations={health.recommendations}
            missingCount={health.missingItems.length}
            profileUrl={profileUrl}
            shareTitle={shareTitle}
          />
          <ProfileCompletionCard health={health} />
        </div>

        <div className="flex flex-col gap-6 min-w-0">
          <section aria-labelledby="ringo-week-title" className={card}>
            <h2 id="ringo-week-title" className="text-xs font-medium uppercase tracking-wide text-ringo-muted mb-4">
              {g.home.weekTitle}
            </h2>

            {noActivityYet ? (
              <div className="flex flex-col items-center text-center gap-2 py-4">
                <span className="w-10 h-10 rounded-full bg-ringo-indigo/10 flex items-center justify-center" aria-hidden="true">
                  <BarChart3 size={17} className="text-ringo-indigo" strokeWidth={2.25} />
                </span>
                <p className="text-sm font-medium text-ringo-text">{g.home.emptyTitle}</p>
                <p className="text-xs text-ringo-muted max-w-[280px] leading-relaxed">{g.home.emptyBody}</p>
                <button
                  type="button"
                  onClick={share}
                  className={`mt-1 inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-full text-sm font-semibold bg-ringo-indigo text-white hover:brightness-110 transition ${focus}`}
                >
                  <Share2 size={14} aria-hidden="true" />
                  {g.home.emptyCta}
                </button>
              </div>
            ) : (
              <>
                <dl className="grid grid-cols-3 gap-3">
                  {[
                    { label: g.home.visits, value: activity.pageViews7d, icon: Eye },
                    { label: g.home.linkClicks, value: activity.linkClicks7d, icon: MousePointerClick },
                    { label: g.home.whatsappClicks, value: activity.whatsappClicks7d, icon: MessageCircle },
                  ].map(({ label, value, icon: Icon }) => (
                    <div key={label} className="min-w-0">
                      <dt className="flex items-start gap-1.5 text-xs text-ringo-muted">
                        <Icon size={13} aria-hidden="true" className="shrink-0 mt-px" />
                        <span className="min-w-0 break-words leading-tight">{label}</span>
                      </dt>
                      <dd className="font-display text-2xl font-medium text-ringo-text tabular-nums mt-1">{fmt(value)}</dd>
                    </div>
                  ))}
                </dl>

                {insight && trend && (
                  <div className="mt-4 pt-4 border-t border-ringo-border/60">
                    <p className="text-sm font-medium text-ringo-text">{insight.title}</p>
                    <p className="text-xs text-ringo-muted mt-0.5">{insight.body(Math.abs(trend.changePct ?? 0))}</p>
                  </div>
                )}

                <Link
                  href="/dashboard/analytics"
                  className={`mt-4 inline-flex items-center min-h-[44px] -mb-2 text-xs font-medium text-ringo-indigo hover:underline rounded-lg ${focus}`}
                >
                  {g.home.seeAnalytics}
                </Link>
              </>
            )}
          </section>

          <section aria-labelledby="ringo-quick-title" className={card}>
            <h2 id="ringo-quick-title" className="text-xs font-medium uppercase tracking-wide text-ringo-muted mb-3">
              {g.home.quick.heading}
            </h2>
            <ul className="grid grid-cols-2 gap-2">
              {actions.map((a) => {
                const Icon = QUICK_ICONS[a.id];
                const cls = `w-full flex items-center gap-2.5 min-h-[44px] px-3 rounded-xl border border-ringo-border/60 text-sm text-ringo-text hover:bg-ringo-muted/[0.06] transition-colors text-left ${focus}`;
                const inner = (
                  <>
                    <Icon size={15} className="text-ringo-indigo shrink-0" aria-hidden="true" />
                    <span className="min-w-0 flex-1">{g.home.quick[a.id]}</span>
                  </>
                );
                return (
                  <li key={a.id}>
                    {a.kind === "share" ? (
                      <button type="button" onClick={share} className={cls}>
                        {inner}
                      </button>
                    ) : a.kind === "external" ? (
                      <a href={profileUrl} target="_blank" rel="noopener noreferrer" className={cls}>
                        {inner}
                      </a>
                    ) : (
                      <Link href={a.href!} className={cls}>
                        {inner}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
            <p role="status" aria-live="polite" className="text-xs text-ringo-muted mt-2 min-h-[1rem]">
              {status === "copied" ? g.home.linkCopied : status === "failed" ? g.home.shareFailed : ""}
            </p>
          </section>

          {(shownAchieved.length > 0 || next) && (
            <section aria-labelledby="ringo-milestones-title" className={card}>
              <h2 id="ringo-milestones-title" className="text-xs font-medium uppercase tracking-wide text-ringo-muted mb-3">
                {g.home.milestonesHeading}
              </h2>
              <ul className="flex flex-col gap-3">
                {shownAchieved.map((m) => (
                  <li key={m.id} className="flex items-start gap-2.5">
                    <CircleCheck size={16} className="text-emerald-500 mt-0.5 shrink-0" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ringo-text">{g.milestone[m.id].title}</p>
                      <p className="text-xs text-ringo-muted">{g.milestone[m.id].body}</p>
                    </div>
                  </li>
                ))}
                {next && (
                  <li className="flex items-start gap-2.5">
                    <Flag size={16} className="text-ringo-muted mt-0.5 shrink-0" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-xs text-ringo-muted">{g.home.nextMilestone}</p>
                      <p className="text-sm font-medium text-ringo-text">{g.milestone[next.id].title}</p>
                      {next.progress && (
                        <p className="text-xs text-ringo-muted tabular-nums">{g.home.visitsProgress(next.progress.current, next.progress.target)}</p>
                      )}
                    </div>
                  </li>
                )}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
