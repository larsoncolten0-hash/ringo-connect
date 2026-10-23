"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BookOpen, PenLine } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import type { ChurchCapabilities } from "@/lib/church/permissions";
import { Badge, BTN_PRIMARY, BTN_SECONDARY, EmptyState, ErrorLine, INPUT, ListSkeleton, Pager, churchApi, formatDay } from "../people/shared";
import { contentErrorText } from "./shared";

interface Row {
  id: string;
  publish_on: string;
  state: "draft" | "scheduled" | "published";
  title_en: string | null;
  title_fr: string | null;
  has_en: boolean;
  has_fr: boolean;
}
interface ListBody {
  words: Row[];
  page: number;
  pageSize: number;
  total: number;
}

const TONE: Record<Row["state"], string> = { draft: "inactive", scheduled: "pending", published: "active" };

// The Content Studio list: every Daily Word of the church (drafts, scheduled and live), server-paged, filtered by state. A row opens the editor. Nothing here is public by itself.
export default function ContentView({ caps }: { caps: ChurchCapabilities }) {
  const { t, locale } = useLanguage();
  const c = t.churchContent;
  const [view, setView] = useState("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListBody | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => setPage(1), [view]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const r = await churchApi<ListBody>(`/api/church/content?view=${view}&page=${page}`);
    setLoading(false);
    if (r.ok) setData(r.body);
    else setError(contentErrorText(t, r.code));
  }, [view, page, t]);
  useEffect(() => {
    load();
  }, [load]);

  const newButton = caps.manageContent && (
    <Link href="/dashboard/church/content/new" className={BTN_PRIMARY}>
      <PenLine size={16} aria-hidden="true" />
      {c.list.add}
    </Link>
  );

  return (
    <div>
      <p className="mb-4 text-sm leading-relaxed text-ringo-muted">{c.subtitle}</p>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="cc-view">
          {c.list.viewLabel}
        </label>
        <select id="cc-view" value={view} onChange={(e) => setView(e.target.value)} className={`${INPUT} !w-auto`}>
          {(["all", "drafts", "scheduled", "published"] as const).map((v) => (
            <option key={v} value={v}>
              {c.list.views[v]}
            </option>
          ))}
        </select>
        {data && !loading && (
          <span className="text-xs text-ringo-muted" aria-live="polite">
            {c.list.count(data.total)}
          </span>
        )}
        {newButton && <span className="ml-auto">{newButton}</span>}
      </div>

      {error ? (
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-ringo-coral/30 bg-ringo-coral/[0.05] p-4">
          <ErrorLine message={`${c.list.loadError} ${error}`} />
          <button type="button" className={BTN_SECONDARY} onClick={load}>
            {t.churchPeople.common.retry}
          </button>
        </div>
      ) : loading && !data ? (
        <ListSkeleton rows={4} />
      ) : data && data.words.length === 0 ? (
        <EmptyState icon={<BookOpen size={22} />} title={view === "all" ? c.list.emptyTitle : c.list.emptyFilteredTitle} body={view === "all" ? c.list.emptyBody : undefined} action={view === "all" ? newButton || undefined : undefined} />
      ) : data ? (
        <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"} aria-busy={loading}>
          <ul className="flex flex-col gap-2">
            {data.words.map((w) => {
              const title = (locale === "fr" ? w.title_fr || w.title_en : w.title_en || w.title_fr) || c.list.untitled;
              return (
                <li key={w.id}>
                  <Link
                    href={`/dashboard/church/content/${w.id}`}
                    aria-label={c.list.open(title)}
                    className="ringo-tactile flex min-h-[72px] flex-col gap-2 rounded-2xl border border-ringo-border/70 bg-ringo-surface px-4 py-3 hover:border-ringo-indigo/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-semibold text-ringo-text">{title}</span>
                      <span className="text-xs text-ringo-muted">{c.list.forDate(formatDay(w.publish_on, locale))}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={w.has_en ? "active" : "inactive"}>{w.has_en ? c.list.languageReady(c.list.languages.en) : c.list.languageMissing(c.list.languages.en)}</Badge>
                      <Badge tone={w.has_fr ? "active" : "inactive"}>{w.has_fr ? c.list.languageReady(c.list.languages.fr) : c.list.languageMissing(c.list.languages.fr)}</Badge>
                      <Badge tone={TONE[w.state]}>{c.list.state[w.state]}</Badge>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} busy={loading} />
        </div>
      ) : null}
    </div>
  );
}
