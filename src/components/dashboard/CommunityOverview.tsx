"use client";

import { useState } from "react";
import Link from "next/link";
import { Users, UserPlus, Mail, MessageCircle, Megaphone, Copy, Check, Plus } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import StatCard from "@/components/analytics/StatCard";
import EmptyState from "@/components/editor/EmptyState";
import { ANNOUNCEMENT_STATUS_COLOR } from "@/lib/communityStatus";

export default function CommunityOverview({
  username,
  siteUrl,
  totalCount,
  newCount,
  emailCount,
  whatsappCount,
  recentAnnouncements,
}: {
  username: string;
  siteUrl: string;
  totalCount: number;
  newCount: number;
  emailCount: number;
  whatsappCount: number;
  recentAnnouncements: any[];
}) {
  const { t, locale } = useLanguage();
  const [copied, setCopied] = useState(false);
  const profileLink = `${siteUrl.replace(/\/$/, "")}/${username}`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(profileLink);
    } catch {
      // Clipboard API can be unavailable — non-critical convenience feature.
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const statusLabel = (s: string) => (t.community as any)[`${s}Badge`] || s;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-medium text-ringo-text tracking-[-0.01em] mb-1">{t.community.title}</h1>
        <p className="text-sm text-ringo-muted max-w-lg">{t.community.subtitle}</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label={t.community.subscribersLabel} value={totalCount} icon={Users} accent="indigo" />
        <StatCard label={t.community.newSubscribersLabel} value={newCount} icon={UserPlus} accent="teal" />
        <StatCard label={t.community.emailSubscribersLabel} value={emailCount} icon={Mail} accent="teal" />
        <StatCard label={t.community.whatsappSubscribersLabel} value={whatsappCount} icon={MessageCircle} accent="slate" />
      </div>

      {totalCount === 0 ? (
        <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-6">
          <EmptyState icon={Users} title={t.community.emptyTitle} hint={t.community.emptyBody} />
          <div className="flex flex-col sm:flex-row gap-2 mt-4 max-w-md mx-auto">
            <div className="flex-1 min-w-0 flex items-center rounded-card border border-ringo-border bg-ringo-bg px-3.5 py-2.5">
              <p className="text-sm text-ringo-text truncate font-mono">{profileLink}</p>
            </div>
            <button
              onClick={copyLink}
              className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-card bg-ringo-indigo text-white text-sm font-medium hover:brightness-110 transition active:scale-[0.97]"
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {t.community.shareMyRingo}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/community/announcements/new"
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-card bg-ringo-indigo text-white text-sm font-medium hover:brightness-110 transition active:scale-[0.97]"
          >
            <Plus size={15} />
            {t.community.createAnnouncement}
          </Link>
        </div>
      )}

      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-ringo-border/70">
          <p className="text-sm font-semibold text-ringo-text">{t.community.recentAnnouncements}</p>
          {recentAnnouncements.length > 0 && (
            <Link href="/dashboard/community/announcements" className="text-xs font-medium text-ringo-indigo">
              {t.community.viewAll}
            </Link>
          )}
        </div>
        {recentAnnouncements.length === 0 ? (
          <div className="py-8">
            <EmptyState icon={Megaphone} title={t.community.noAnnouncementsYet} />
          </div>
        ) : (
          <div className="divide-y divide-ringo-border/40">
            {recentAnnouncements.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ringo-text truncate">{a.title}</p>
                  <p className="text-xs text-ringo-muted">{new Date(a.created_at).toLocaleDateString(locale)}</p>
                </div>
                <span className={`shrink-0 text-xs px-2.5 py-1 rounded-full font-medium ${ANNOUNCEMENT_STATUS_COLOR[a.status] || ""}`}>
                  {statusLabel(a.status)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
