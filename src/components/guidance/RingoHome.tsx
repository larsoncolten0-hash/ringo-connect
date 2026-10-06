"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, BarChart3, CircleCheck, ExternalLink, Eye, MousePointerClick, MessageCircle, Pencil, Plus, Share2, Flag } from "lucide-react";
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
  const allActions = quickActions(health);
  // Edit profile is THE action of this page (it opens the editor): it leads as the hero button, the rest stay quiet tiles below
  const editAction = allActions.find((a) => a.id === "edit");
  const actions = allActions.filter((a) => a.id !== "edit");

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-6">
      <header className="flex flex-col gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold text-ringo-text tracking-[-0.02em] text-balance">
            {g.home.greetingLine(g.home.greeting[greeting], firstName)}
          </h1>
          <p className="text-sm sm:text-base text-ringo-muted mt-1.5">{g.home.subtitle}</p>
        </div>
        {editAction?.href && (
          <Link
            href={editAction.href}
            className={`ringo-tactile ringo-cta group flex w-full items-center gap-4 rounded-[20px] px-5 py-4 sm:max-w-xl ${focus}`}
          >
            <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/18 ring-1 ring-white/25">
              <Pencil size={19} strokeWidth={2.25} />
            </span>
            <span className="min-w-0 flex-1 text-left">
              <span className="block text-base font-semibold leading-tight">{g.home.quick.edit}</span>
              <span className="mt-0.5 block text-sm leading-snug text-white/80">{g.home.quick.editBody}</span>
            </span>
            <ArrowRight size={18} aria-hidden="true" className="shrink-0 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none" />
          </Link>
        )}
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
                  className={`ringo-tactile ringo-cta mt-1 inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-full text-sm font-semibold ${focus}`}
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
                  className={`ringo-tactile mt-4 inline-flex items-center gap-1.5 min-h-[44px] rounded-full border border-ringo-border px-4 text-xs font-semibold text-ringo-text hover:bg-ringo-muted/[0.06] ${focus}`}
                >
                  {g.home.seeAnalytics}
                  <ArrowRight size={13} aria-hidden="true" />
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
                const cls = `ringo-tactile w-full flex items-center gap-2.5 min-h-[48px] px-3 rounded-xl border border-ringo-border/60 text-sm font-medium text-ringo-text hover:bg-ringo-muted/[0.06] hover:border-ringo-indigo/30 text-left ${focus}`;
                const inner = (
                  <>
                    <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ringo-indigo/10">
                      <Icon size={15} className="text-ringo-indigo" />
                    </span>
                    <span className="min-w-0 flex-1 leading-tight">{g.home.quick[a.id]}</span>
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
