"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { FileText, PenLine } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import type { ChurchCapabilities } from "@/lib/church/permissions";
import { Badge, BTN_PRIMARY, BTN_SECONDARY, EmptyState, ErrorLine, INPUT, ListSkeleton, Pager, churchApi, formatDay } from "../people/shared";
import { churchErrorText } from "./errorText";
import type { LifecycleConfig } from "./types";

interface ListBody {
  items: Record<string, any>[];
  page: number;
  pageSize: number;
  total: number;
}

// One list for every draft -> publish entity of the church workspace: server-paged, filtered by view. A row opens the editor. Nothing here is public by itself.
export default function LifecycleList({ config, caps }: { config: LifecycleConfig; caps: ChurchCapabilities }) {
  const { t, locale } = useLanguage();
  const c = config.texts.list;
  const lang = locale === "fr" ? "fr" : "en";
  const [view, setView] = useState("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListBody | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => setPage(1), [view]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const r = await churchApi<ListBody>(`${config.apiPath}?view=${view}&page=${page}`);
    setLoading(false);
    if (r.ok) setData(r.body);
    else setError(churchErrorText(t, r.code));
  }, [config.apiPath, view, page, t]);
  useEffect(() => {
    load();
  }, [load]);

  const newButton = config.caps.manage(caps) && (
    <Link href={`${config.pagePath}/new`} className={BTN_PRIMARY}>
      <PenLine size={16} aria-hidden="true" />
      {c.add}
    </Link>
  );
  const id = `${config.idPrefix}-view`;

  return (
    <div>
      <p className="mb-4 text-sm leading-relaxed text-ringo-muted">{config.texts.subtitle}</p>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={id}>
          {c.viewLabel}
        </label>
        <select id={id} value={view} onChange={(e) => setView(e.target.value)} className={`${INPUT} !w-auto`}>
          {config.views.map((v) => (
            <option key={v} value={v}>
              {c.views[v]}
            </option>
          ))}
        </select>
        {data && !loading && (
          <span className="text-xs text-ringo-muted" aria-live="polite">
            {c.count(data.total)}
          </span>
        )}
        {newButton && <span className="ml-auto">{newButton}</span>}
      </div>

      {error ? (
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-ringo-coral/30 bg-ringo-coral/[0.05] p-4">
          <ErrorLine message={`${c.loadError} ${error}`} />
          <button type="button" className={BTN_SECONDARY} onClick={load}>
            {t.churchPeople.common.retry}
          </button>
        </div>
      ) : loading && !data ? (
        <ListSkeleton rows={4} />
      ) : data && data.items.length === 0 ? (
        <EmptyState icon={<FileText size={22} />} title={view === "all" ? c.emptyTitle : c.emptyFilteredTitle} body={view === "all" ? c.emptyBody : undefined} action={view === "all" ? newButton || undefined : undefined} />
      ) : data ? (
        <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"} aria-busy={loading}>
          <ul className="flex flex-col gap-2">
            {data.items.map((row) => {
              const title = config.rowTitle(row, lang) || c.untitled;
              return (
                <li key={row.id}>
                  <Link
                    href={`${config.pagePath}/${row.id}`}
                    aria-label={c.open(title)}
                    className="ringo-tactile flex min-h-[72px] flex-col gap-2 rounded-2xl border border-ringo-border/70 bg-ringo-surface px-4 py-3 hover:border-ringo-indigo/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-semibold text-ringo-text">{title}</span>
                      <span className="text-xs text-ringo-muted">{config.subline(row, lang, formatDay)}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={row.has_en ? "active" : "inactive"}>{row.has_en ? c.languageReady(c.languages.en) : c.languageMissing(c.languages.en)}</Badge>
                      <Badge tone={row.has_fr ? "active" : "inactive"}>{row.has_fr ? c.languageReady(c.languages.fr) : c.languageMissing(c.languages.fr)}</Badge>
                      {(config.extraBadges?.(row) ?? []).map((b) => (
                        <Badge key={b} tone="pending">
                          {b}
                        </Badge>
                      ))}
                      <Badge tone={config.stateTone[row.state] ?? "inactive"}>{c.state[row.state] ?? row.state}</Badge>
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
