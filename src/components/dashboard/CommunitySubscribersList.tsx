"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Users, Search, ChevronLeft, ChevronRight, Mail, MessageCircle } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import EmptyState from "@/components/editor/EmptyState";
import { SUBSCRIBER_STATUS_COLOR } from "@/lib/communityStatus";

const SOURCES = ["ringo_profile", "qr_code", "nfc", "product", "music", "event", "restaurant", "other"];
const STATUSES = ["active", "unsubscribed", "removed"];

export default function CommunitySubscribersList({
  subscribers,
  page,
  pageSize,
  totalCount,
  q,
  status,
  source,
}: {
  subscribers: any[];
  page: number;
  pageSize: number;
  totalCount: number;
  q: string;
  status: string;
  source: string;
}) {
  const { t, locale } = useLanguage();
  const router = useRouter();
  const [search, setSearch] = useState(q);
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const buildUrl = (patch: Record<string, string>) => {
    const params = new URLSearchParams({ q, status, source });
    Object.entries(patch).forEach(([k, v]) => {
      if (v) params.set(k, v);
      else params.delete(k);
    });
    // Changing a filter/search (as opposed to explicitly navigating to a
    // page) always resets back to page 1.
    if (!("page" in patch)) params.delete("page");
    const qs = params.toString();
    return `/dashboard/community/subscribers${qs ? `?${qs}` : ""}`;
  };

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    router.push(buildUrl({ q: search }));
  };

  const statusLabel = (s: string) => (t.community as any)[`status${s[0].toUpperCase()}${s.slice(1)}`] || s;
  const sourceLabel = (s: string) => (t.community as any)[`source${s.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join("")}`] || s;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col sm:flex-row gap-2">
        <form onSubmit={submitSearch} className="flex-1 flex items-center gap-2 rounded-card border border-ringo-border bg-ringo-surface px-3.5 py-2.5">
          <Search size={15} className="text-ringo-muted shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.community.searchPlaceholder}
            className="flex-1 min-w-0 bg-transparent text-sm outline-none text-ringo-text"
          />
        </form>
        <select
          value={status}
          onChange={(e) => router.push(buildUrl({ status: e.target.value }))}
          className="border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-surface text-ringo-text"
        >
          <option value="">{t.community.allStatuses}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </select>
        <select
          value={source}
          onChange={(e) => router.push(buildUrl({ source: e.target.value }))}
          className="border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-surface text-ringo-text"
        >
          <option value="">{t.community.allSources}</option>
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {sourceLabel(s)}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
        {subscribers.length === 0 ? (
          <div className="py-10">
            <EmptyState icon={Users} title={t.community.noSubscribersYet} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[680px]">
              <thead>
                <tr className="text-left text-ringo-muted border-b border-ringo-border/70">
                  <th className="py-3 px-4 font-normal">{t.community.columnName}</th>
                  <th className="font-normal">{t.community.columnEmail}</th>
                  <th className="font-normal">{t.community.columnDate}</th>
                  <th className="font-normal">{t.community.columnPreferences}</th>
                  <th className="font-normal">{t.community.columnStatus}</th>
                  <th className="font-normal px-4"></th>
                </tr>
              </thead>
              <tbody>
                {subscribers.map((s) => {
                  const prefs = s.community_subscription_preferences;
                  return (
                    <tr key={s.id} className="border-b border-ringo-border/40 last:border-0 hover:bg-ringo-muted/5 transition-colors">
                      <td className="py-3 px-4">
                        <p className="text-ringo-text font-medium truncate max-w-[160px]">{s.name || "—"}</p>
                        <p className="text-xs text-ringo-muted truncate max-w-[160px]">{s.phone || ""}</p>
                      </td>
                      <td className="text-ringo-text truncate max-w-[200px]">{s.email || "—"}</td>
                      <td className="text-ringo-muted whitespace-nowrap">{new Date(s.created_at).toLocaleDateString(locale)}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <Mail size={13} className={prefs?.email_updates ? "text-ringo-indigo" : "text-ringo-border"} />
                          <MessageCircle size={13} className={prefs?.whatsapp_updates ? "text-ringo-teal" : "text-ringo-border"} />
                        </div>
                      </td>
                      <td>
                        <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${SUBSCRIBER_STATUS_COLOR[s.status] || ""}`}>
                          {statusLabel(s.status)}
                        </span>
                      </td>
                      <td className="px-4 text-right">
                        <Link
                          href={`/dashboard/community/subscribers/${s.id}`}
                          className="text-xs px-3 py-1.5 rounded-card border border-ringo-border text-ringo-text hover:border-ringo-indigo hover:text-ringo-indigo transition-colors"
                        >
                          {t.community.view}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-ringo-border/70 text-sm">
            <span className="text-ringo-muted">
              {page} / {totalPages}
            </span>
            <div className="flex items-center gap-2">
              {page > 1 ? (
                <Link
                  href={buildUrl({ page: String(page - 1) })}
                  className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-card border border-ringo-border text-ringo-text hover:border-ringo-indigo hover:text-ringo-indigo transition-colors"
                >
                  <ChevronLeft size={13} />
                </Link>
              ) : (
                <span className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-card border border-ringo-border/50 text-ringo-muted/50">
                  <ChevronLeft size={13} />
                </span>
              )}
              {page < totalPages ? (
                <Link
                  href={buildUrl({ page: String(page + 1) })}
                  className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-card border border-ringo-border text-ringo-text hover:border-ringo-indigo hover:text-ringo-indigo transition-colors"
                >
                  <ChevronRight size={13} />
                </Link>
              ) : (
                <span className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-card border border-ringo-border/50 text-ringo-muted/50">
                  <ChevronRight size={13} />
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
