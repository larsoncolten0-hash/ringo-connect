"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, Plus, Search } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { DIRECTORY_PAGE, SEARCH } from "@/lib/customers/constants";
import CustomerForm from "./CustomerForm";
import { callApi, inputClass, labelClass, primaryButton, secondaryButton, dangerButton, useCustErrorText } from "./shared";

type Row = { id: string; name: string; phone: string | null; email: string | null; archived: boolean; auto_reminders_paused: boolean };
const STATUSES = ["active", "archived", "all"] as const;

/** The customer directory: the business's own contact book, searched and paged on the server. Read-only here; writes use the Phase 3 contact endpoints. */
export default function CustomersView() {
  const { t } = useLanguage();
  const u = t.customers.ui;
  const errorText = useCustErrorText();
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("active");
  const [items, setItems] = useState<Row[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  // the raw API answer is kept and turned into a sentence at render time, so a language change (the saved language is applied just after the first render) never leaves a stale message
  const [errorData, setErrorData] = useState<any>(null);
  const error = errorData ? errorText(errorData) : "";
  const [tooShort, setTooShort] = useState(false);
  const [adding, setAdding] = useState(false);
  const seq = useRef(0);

  // the search box waits for a short pause so every keystroke is not a request
  useEffect(() => {
    const h = setTimeout(() => setQ(typed), 300);
    return () => clearTimeout(h);
  }, [typed]);

  const load = useCallback(async (offset: number) => {
    const my = ++seq.current;
    setBusy(true);
    const qs = `status=${status}&limit=${DIRECTORY_PAGE.default}&offset=${offset}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`;
    const res = await callApi("GET", `/api/customers?${qs}`);
    if (my !== seq.current) return; // a newer search replaced this one
    setBusy(false);
    setLoaded(true);
    if (!res.ok) return setErrorData(res.data);
    setErrorData(null);
    setTooShort(res.data.search_too_short === true);
    setTotal(typeof res.data.total === "number" ? res.data.total : null);
    setHasMore(res.data.has_more === true);
    setItems((prev) => (offset === 0 ? res.data.items : [...prev, ...res.data.items]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, status]);
  useEffect(() => { load(0); }, [load]);

  const act = async (url: string, body: unknown) => {
    setErrorData(null);
    const res = await callApi("POST", url, body);
    if (!res.ok) return setErrorData(res.data);
    load(0);
  };
  const label = { active: u.statusActive, archived: u.statusArchived, all: u.statusAll };
  const searching = q.trim() !== "" && !tooShort;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-xl font-medium text-ringo-text">{u.title}</h1>
          <p className="mt-1 text-sm text-ringo-muted">{u.intro}</p>
          <p className="mt-1 text-xs text-ringo-muted">{u.debtorsNote}</p>
        </div>
        <button className={primaryButton} onClick={() => setAdding(true)}><Plus size={15} />{u.add}</button>
      </div>

      <div className="flex flex-col gap-3">
        <label className={labelClass}>
          {u.searchLabel}
          <span className="relative block">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ringo-muted" />
            <input type="search" value={typed} onChange={(e) => setTyped(e.target.value)} maxLength={SEARCH.maxLength} placeholder={u.searchPlaceholder} className={`${inputClass} pl-9`} />
          </span>
        </label>
        {typed.trim() !== "" && Array.from(typed.trim()).length < SEARCH.minLength && <p className="text-xs text-ringo-muted">{u.searchHint}</p>}
        <div className="flex flex-wrap items-center gap-2">
          {STATUSES.map((s) => (
            <button key={s} aria-pressed={status === s} onClick={() => setStatus(s)} className={`${status === s ? primaryButton : secondaryButton} !min-h-[36px] !px-3 !py-1 text-xs`}>{label[s]}</button>
          ))}
          {total !== null && loaded && !error && <span className="ml-auto text-xs text-ringo-muted">{u.count(total)}</span>}
        </div>
      </div>

      {error && (
        <div role="alert" className="flex flex-col gap-2 rounded-card bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-400">
          <p>{error}</p>
          <div><button className={secondaryButton} onClick={() => load(0)}>{u.retry}</button></div>
        </div>
      )}
      {!loaded && busy && <p className="flex items-center gap-2 text-sm text-ringo-muted"><Loader2 size={14} className="animate-spin" />{u.loading}</p>}
      {loaded && !error && items.length === 0 && (
        searching ? <p className="text-sm text-ringo-muted">{u.noResults(q.trim())}</p> : (
          <div className="rounded-card border border-dashed border-ringo-border p-5 text-center">
            <p className="text-sm font-medium text-ringo-text">{u.empty}</p>
            <p className="mt-1 text-xs text-ringo-muted">{u.emptyHint}</p>
          </div>
        )
      )}

      <ul className="flex flex-col gap-2">
        {items.map((c) => (
          <li key={c.id} className={`flex flex-col gap-3 rounded-card border border-ringo-border p-3 sm:p-4 ${c.archived ? "opacity-80" : ""}`}>
            <div className="min-w-0">
              <Link href={`/dashboard/customers/${c.id}`} className="text-sm font-medium text-ringo-text hover:underline">{c.name}</Link>
              <p className="break-words text-xs text-ringo-muted">{[c.phone, c.email].filter(Boolean).join(" · ") || "—"}</p>
              {(c.archived || c.auto_reminders_paused) && (
                <p className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
                  {c.archived && <span className="rounded-full bg-ringo-muted/15 px-2 py-0.5 text-ringo-muted">{u.archivedBadge}</span>}
                  {c.auto_reminders_paused && <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-700 dark:text-amber-400">{u.pausedBadge}</span>}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={`/dashboard/customers/${c.id}`} className={secondaryButton}>{u.view}</Link>
              <button className={c.archived ? secondaryButton : dangerButton} onClick={() => act(`/api/receivables/customers/${c.id}/archive`, { archived: !c.archived })}>{c.archived ? u.restore : u.archive}</button>
            </div>
          </li>
        ))}
      </ul>
      {hasMore && <button className={secondaryButton} disabled={busy} onClick={() => load(items.length)}>{u.loadMore}</button>}

      {adding && <CustomerForm customer={null} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(0); }} />}
    </div>
  );
}
