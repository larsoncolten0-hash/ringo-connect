"use client";

import Link from "next/link";
import { Megaphone, Plus } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import EmptyState from "@/components/editor/EmptyState";
import { ANNOUNCEMENT_STATUS_COLOR } from "@/lib/communityStatus";

export default function CommunityAnnouncementsList({ announcements }: { announcements: any[] }) {
  const { t, locale } = useLanguage();
  const statusLabel = (s: string) => (t.community as any)[`${s}Badge`] || s;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Link
          href="/dashboard/community/announcements/new"
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-card bg-ringo-indigo text-white text-sm font-medium hover:brightness-110 transition active:scale-[0.97]"
        >
          <Plus size={15} />
          {t.community.newAnnouncement}
        </Link>
      </div>

      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
        {announcements.length === 0 ? (
          <div className="py-10">
            <EmptyState icon={Megaphone} title={t.community.noAnnouncementsYet} />
          </div>
        ) : (
          <div className="divide-y divide-ringo-border/40">
            {announcements.map((a) => (
              <Link
                key={a.id}
                href={`/dashboard/community/announcements/new?id=${a.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3.5 hover:bg-ringo-muted/5 transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ringo-text truncate">{a.title}</p>
                  <p className="text-xs text-ringo-muted mt-0.5">
                    {new Date(a.created_at).toLocaleDateString(locale)}
                    {a.status === "sent" && ` · ${t.community.sentSummary(a.sent_count, a.recipient_count)}`}
                  </p>
                </div>
                <span className={`shrink-0 text-xs px-2.5 py-1 rounded-full font-medium ${ANNOUNCEMENT_STATUS_COLOR[a.status] || ""}`}>
                  {statusLabel(a.status)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
