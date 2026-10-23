"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ClipboardList } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { churchErrorText } from "../lifecycle/errorText";
import { Badge, BTN_SECONDARY, EmptyState, ErrorLine, ListSkeleton, Pager, churchApi, formatDay } from "../people/shared";

interface Row {
  id: string;
  event_date: string;
  start_time: string | null;
  title_en: string | null;
  title_fr: string | null;
  venue: string | null;
  is_cancelled: boolean;
  present: number;
  visitors: number;
  children: number;
  recordable: boolean;
}
interface ListBody {
  items: Row[];
  page: number;
  pageSize: number;
  total: number;
}

// The events that can have attendance (published, already started), newest first, with how many were recorded. A row opens that event's attendance. Attendance is private: it names people, so it is
// never shown on the public page and this list shows numbers only.
export default function AttendanceList() {
  const { t, locale } = useLanguage();
  const c = t.churchAttendance;
  const lang = locale === "fr" ? "fr" : "en";
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListBody | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const r = await churchApi<ListBody>(`/api/church/attendance?page=${page}`);
    setLoading(false);
    if (r.ok) setData(r.body);
    else setError(churchErrorText(t, r.code));
  }, [page, t]);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <p className="mb-4 text-sm leading-relaxed text-ringo-muted">{c.subtitle}</p>
      {data && !loading && (
        <p className="mb-3 text-xs text-ringo-muted" aria-live="polite">
          {c.list.count(data.total)}
        </p>
      )}
      {error ? (
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-ringo-coral/30 bg-ringo-coral/[0.05] p-4">
          <ErrorLine message={`${c.list.loadError} ${error}`} />
          <button type="button" className={BTN_SECONDARY} onClick={load}>
            {t.churchPeople.common.retry}
          </button>
        </div>
      ) : loading && !data ? (
        <ListSkeleton rows={4} />
      ) : data && data.items.length === 0 ? (
        <EmptyState icon={<ClipboardList size={22} />} title={c.list.emptyTitle} body={c.list.emptyBody} />
      ) : data ? (
        <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"} aria-busy={loading}>
          <ul className="flex flex-col gap-2">
            {data.items.map((row) => {
              const title = (lang === "fr" ? row.title_fr || row.title_en : row.title_en || row.title_fr) || c.list.untitled;
              const any = row.present > 0 || row.visitors > 0 || row.children > 0;
              return (
                <li key={row.id}>
                  <Link
                    href={`/dashboard/church/attendance/${row.id}`}
                    aria-label={c.list.open(title)}
                    className="ringo-tactile flex min-h-[72px] flex-col gap-2 rounded-2xl border border-ringo-border/70 bg-ringo-surface px-4 py-3 hover:border-ringo-indigo/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-semibold text-ringo-text">{title}</span>
                      <span className="text-xs text-ringo-muted">{formatDay(row.event_date, lang)}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      {row.is_cancelled && <Badge tone="pending">{c.list.cancelled}</Badge>}
                      {any ? (
                        <>
                          <Badge tone="active">{c.list.present(row.present)}</Badge>
                          {row.visitors > 0 && <Badge tone="inactive">{c.list.visitors(row.visitors)}</Badge>}
                          {row.children > 0 && <Badge tone="inactive">{c.list.children(row.children)}</Badge>}
                        </>
                      ) : (
                        <Badge tone="inactive">{c.list.noneYet}</Badge>
                      )}
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
