"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { MessageSquareHeart } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { churchErrorText } from "../lifecycle/errorText";
import { Badge, BTN_SECONDARY, EmptyState, ErrorLine, INPUT, ListSkeleton, Pager, churchApi, formatDay, useDebounced } from "../people/shared";

interface Row {
  id: string;
  full_name: string;
  phone: string;
  group_label: string | null;
  publish_consent: boolean;
  name_consent: boolean;
  review_status: "submitted" | "under_review" | "approved" | "rejected";
  publication_status: "unpublished" | "published";
  created_at: string;
}
interface ListBody {
  items: Row[];
  page: number;
  pageSize: number;
  total: number;
}

const TONE: Record<Row["review_status"], string> = { submitted: "pending", under_review: "pending", approved: "active", rejected: "inactive" };

// The church's testimonies (private: names and phone numbers). Search, filter by review state, whether it is on the page, and received dates; a row opens the full testimony. The server resolves the
// church and the permissions on every request. Nothing here shows a testimony on the public page: that happens only from the detail screen, after approval and with the person's consent.
export default function TestimoniesList() {
  const { t, locale } = useLanguage();
  const c = t.churchTestimonies.dashboard.list;
  const lang = locale === "fr" ? "fr" : "en";
  const [status, setStatus] = useState("all");
  const [publication, setPublication] = useState("all");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const q = useDebounced(search.trim(), 300);
  const [data, setData] = useState<ListBody | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => setPage(1), [status, publication, q, from, to]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const p = new URLSearchParams({ status, publication, page: String(page) });
    if (q) p.set("q", q);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    const r = await churchApi<ListBody>(`/api/church/testimonies?${p.toString()}`);
    setLoading(false);
    if (r.ok) setData(r.body);
    else setError(churchErrorText(t, r.code));
  }, [status, publication, q, from, to, page, t]);
  useEffect(() => {
    load();
  }, [load]);

  const filtered = status !== "all" || publication !== "all" || q !== "" || from !== "" || to !== "";
  const clear = () => { setStatus("all"); setPublication("all"); setSearch(""); setFrom(""); setTo(""); };

  return (
    <div>
      <p className="mb-4 text-sm leading-relaxed text-ringo-muted">{t.churchTestimonies.dashboard.subtitle}</p>

      <div className="mb-4 grid gap-3 rounded-2xl border border-ringo-border/70 bg-ringo-surface p-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="flex flex-col gap-1 text-xs text-ringo-muted sm:col-span-2 lg:col-span-1" htmlFor="ctl-search">
          {c.searchLabel}
          <input id="ctl-search" type="search" className={INPUT} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={c.searchPlaceholder} maxLength={80} autoComplete="off" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ringo-muted" htmlFor="ctl-status">
          {c.statusLabel}
          <select id="ctl-status" className={INPUT} value={status} onChange={(e) => setStatus(e.target.value)}>
            {Object.entries(c.statuses).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ringo-muted" htmlFor="ctl-publication">
          {c.publicationLabel}
          <select id="ctl-publication" className={INPUT} value={publication} onChange={(e) => setPublication(e.target.value)}>
            {Object.entries(c.publications).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ringo-muted" htmlFor="ctl-from">
          {c.fromLabel}
          <input id="ctl-from" type="date" className={INPUT} value={from} min="2020-01-01" onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ringo-muted" htmlFor="ctl-to">
          {c.toLabel}
          <input id="ctl-to" type="date" className={INPUT} value={to} min={from || "2020-01-01"} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>

      <div className="mb-3 flex items-center gap-3">
        {data && !loading && (
          <span className="text-xs text-ringo-muted" aria-live="polite">
            {c.count(data.total)}
          </span>
        )}
        {filtered && (
          <button type="button" className={`${BTN_SECONDARY} ml-auto`} onClick={clear}>
            {c.clear}
          </button>
        )}
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
        <EmptyState icon={<MessageSquareHeart size={22} />} title={filtered ? c.emptyFilteredTitle : c.emptyTitle} body={filtered ? undefined : c.emptyBody} />
      ) : data ? (
        <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"} aria-busy={loading}>
          <ul className="flex flex-col gap-2">
            {data.items.map((row) => (
              <li key={row.id}>
                <Link
                  href={`/dashboard/church/testimonies/${row.id}`}
                  aria-label={c.open(row.full_name)}
                  className="ringo-tactile flex min-h-[72px] flex-col gap-2 rounded-2xl border border-ringo-border/70 bg-ringo-surface px-4 py-3 hover:border-ringo-indigo/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-semibold text-ringo-text">{row.full_name}</span>
                    <span className="text-xs text-ringo-muted">
                      {row.phone ? `+${row.phone}` : ""}
                      {row.group_label ? ` · ${row.group_label}` : ""} · {c.received(formatDay(row.created_at, lang))}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={row.publish_consent ? "active" : "inactive"}>{row.publish_consent ? c.publishConsentYes : c.publishConsentNo}</Badge>
                    <Badge tone={TONE[row.review_status]}>{c.review[row.review_status]}</Badge>
                    {row.publication_status === "published" && <Badge tone="leader">{c.publishedBadge}</Badge>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} busy={loading} />
        </div>
      ) : null}
    </div>
  );
}
