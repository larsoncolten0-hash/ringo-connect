"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Check, HandHeart, Loader2, Search, ShieldCheck, Trash2, X } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { churchErrorText } from "../lifecycle/errorText";
import { Badge, BTN_PRIMARY, BTN_SECONDARY, ConfirmDialog, EmptyState, ErrorLine, Field, INPUT, ListSkeleton, NoticeBar, churchApi, formatDay, useDebounced, useNotice } from "../people/shared";

type Status = "pending" | "approved" | "declined";
interface Row {
  id: string;
  full_name: string;
  lang: "en" | "fr";
  status: Status;
  created_at: string;
  updated_at: string;
}
interface Detail extends Row {
  phone: string;
  email: string | null;
  reason: string;
  decision_note: string | null;
}
interface History {
  id: string;
  from_status: Status;
  to_status: Status;
  created_at: string;
}
interface ListBody {
  items: Row[];
  page: number;
  pageSize: number;
  total: number;
}
const TONE: Record<Status, string> = { pending: "pending", approved: "active", declined: "inactive" };

// Counselling requests. The LIST shows a name, a date and a status, never the reason; the reason and the contact details appear only when one request is opened. Deciding and deleting need the manage
// permission (the server and the database check it again). Nothing here is stored in the browser or sent anywhere but /api/church/counselling.
export default function CounsellingView({ canDecide }: { canDecide: boolean }) {
  const { t, locale } = useLanguage();
  const c = t.churchExpansion.counselling;
  const [filter, setFilter] = useState<"" | Status>("");
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search, 300);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListBody | null>(null);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const q = new URLSearchParams({ page: String(page) });
    if (filter) q.set("status", filter);
    if (debounced.trim()) q.set("q", debounced.trim());
    const r = await churchApi<ListBody>(`/api/church/counselling?${q.toString()}`);
    if (!r.ok) return setError(churchErrorText(t, r.code));
    setError("");
    setData(r.body);
  }, [t, page, filter, debounced]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => setPage(1), [filter, debounced]);

  if (openId) return <RequestDetail id={openId} canDecide={canDecide} onBack={() => { setOpenId(null); load(); }} />;

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <section aria-labelledby="church-counselling-title" className="flex flex-col gap-5">
      <header>
        <h1 id="church-counselling-title" className="font-display text-xl font-semibold text-ringo-text">
          {c.title}
        </h1>
        <p className="mt-1 max-w-[65ch] text-sm leading-relaxed text-ringo-muted">{c.intro}</p>
        <p className="mt-2 flex max-w-[65ch] items-start gap-2 text-xs leading-relaxed text-ringo-muted">
          <ShieldCheck size={14} className="mt-0.5 shrink-0 text-ringo-indigo" aria-hidden="true" />
          {c.privacy}
        </p>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label={c.title} className="flex flex-wrap gap-1.5">
          {(["", "pending", "approved", "declined"] as const).map((f) => (
            <button key={f || "all"} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={`min-h-[44px] rounded-full border px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40 ${filter === f ? "border-ringo-indigo bg-ringo-indigo/10 text-ringo-indigo" : "border-ringo-border bg-ringo-surface text-ringo-text"}`}>
              {f === "" ? c.filters.all : c.filters[f]}
            </button>
          ))}
        </div>
        <div className="relative ml-auto w-full sm:w-64">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ringo-muted" aria-hidden="true" />
          <input type="search" aria-label={c.searchLabel} placeholder={c.search} className={`${INPUT} pl-9`} value={search} maxLength={80} onChange={(e) => setSearch(e.target.value)} autoComplete="off" />
        </div>
      </div>
      {error ? (
        <div className="flex flex-col items-start gap-3">
          <ErrorLine message={error} />
          <button type="button" onClick={load} className={BTN_SECONDARY}>
            {c.retry}
          </button>
        </div>
      ) : data === null ? (
        <ListSkeleton rows={4} />
      ) : data.items.length === 0 ? (
        <EmptyState icon={<HandHeart size={22} aria-hidden="true" />} title={filter || debounced.trim() ? c.emptyFiltered : c.empty} />
      ) : (
        <>
          <p className="text-xs text-ringo-muted">{c.count(data.total)}</p>
          <ul className="flex flex-col gap-2">
            {data.items.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => setOpenId(r.id)} aria-label={c.open(r.full_name)} className="flex min-h-[64px] w-full items-center gap-3 rounded-card border border-ringo-border bg-ringo-surface px-4 py-3 text-left transition hover:border-ringo-indigo/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ringo-text">{r.full_name}</span>
                    <span className="mt-0.5 block text-xs text-ringo-muted">{c.received(formatDay(r.created_at, locale))}</span>
                  </span>
                  <Badge tone={TONE[r.status]}>{c.status[r.status]}</Badge>
                </button>
              </li>
            ))}
          </ul>
          {pages > 1 && (
            <nav aria-label={c.title} className="flex items-center justify-between gap-3">
              <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className={BTN_SECONDARY}>
                {c.previous}
              </button>
              <span className="text-xs text-ringo-muted">{c.page(page, pages)}</span>
              <button type="button" onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages} className={BTN_SECONDARY}>
                {c.next}
              </button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}

function RequestDetail({ id, canDecide, onBack }: { id: string; canDecide: boolean; onBack: () => void }) {
  const { t, locale } = useLanguage();
  const c = t.churchExpansion.counselling;
  const d = c.detail;
  const [item, setItem] = useState<Detail | null>(null);
  const [history, setHistory] = useState<History[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [deleting, setDeleting] = useState(false);
  const { notice, show } = useNotice();

  const load = useCallback(async () => {
    const r = await churchApi<{ item: Detail; history: History[] }>(`/api/church/counselling/${id}`);
    if (!r.ok) return setError(churchErrorText(t, r.code));
    setItem(r.body.item);
    setHistory(r.body.history);
    setNote(r.body.item.decision_note ?? "");
  }, [id, t]);
  useEffect(() => {
    load();
  }, [load]);

  const patch = async (changes: Record<string, unknown>, done: string) => {
    if (!item) return;
    setBusy("patch");
    setError("");
    const r = await churchApi<{ item: Detail }>(`/api/church/counselling/${id}`, { method: "PATCH", body: { ...changes, expected_updated_at: item.updated_at } });
    setBusy("");
    if (!r.ok) {
      if (r.code === "stale") {
        show(d.staleReload);
        return load();
      }
      return setError(churchErrorText(t, r.code));
    }
    show(done);
    await load();
  };

  const remove = async (): Promise<string> => {
    if (!item) return "";
    const r = await churchApi(`/api/church/counselling/${id}?expected_updated_at=${encodeURIComponent(item.updated_at)}`, { method: "DELETE" });
    if (!r.ok) return churchErrorText(t, r.code);
    setDeleting(false);
    onBack();
    return "";
  };

  return (
    <section aria-labelledby="church-counselling-detail" className="flex flex-col gap-5">
      <button type="button" onClick={onBack} className="inline-flex min-h-[44px] items-center gap-1.5 self-start rounded-full px-2 text-sm font-semibold text-ringo-indigo hover:bg-ringo-indigo/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40">
        <ArrowLeft size={16} aria-hidden="true" />
        {d.back}
      </button>
      <NoticeBar message={notice} />
      {!item ? (
        error ? <ErrorLine message={error} /> : <ListSkeleton rows={3} />
      ) : (
        <>
          <header className="flex flex-wrap items-center gap-3">
            <h1 id="church-counselling-detail" className="font-display text-xl font-semibold text-ringo-text">
              {item.full_name}
            </h1>
            <Badge tone={TONE[item.status]}>{c.status[item.status]}</Badge>
            <span className="text-xs text-ringo-muted">{c.received(formatDay(item.created_at, locale))}</span>
          </header>
          <div className="flex flex-col gap-4 rounded-card border border-ringo-border bg-ringo-surface p-4 sm:p-5">
            <div>
              <h2 className="text-xs font-semibold text-ringo-muted">{d.reason}</h2>
              <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-ringo-text [overflow-wrap:anywhere]">{item.reason}</p>
            </div>
            <div>
              <h2 className="text-xs font-semibold text-ringo-muted">{d.contact}</h2>
              <dl className="mt-1 grid gap-1 text-sm text-ringo-text sm:grid-cols-[120px_1fr]">
                <dt className="text-ringo-muted">{d.phone}</dt>
                <dd>
                  <a href={`tel:+${item.phone}`} className="font-semibold text-ringo-indigo underline-offset-2 hover:underline">
                    +{item.phone}
                  </a>
                </dd>
                {item.email && (
                  <>
                    <dt className="text-ringo-muted">{d.email}</dt>
                    <dd className="[overflow-wrap:anywhere]">{item.email}</dd>
                  </>
                )}
                <dt className="text-ringo-muted">{d.language}</dt>
                <dd>{d.languages[item.lang]}</dd>
              </dl>
            </div>
          </div>

          {canDecide ? (
            <div className="flex flex-col gap-3 rounded-card border border-ringo-border bg-ringo-surface p-4 sm:p-5">
              <h2 className="font-display text-base font-semibold text-ringo-text">{d.decision}</h2>
              <div className="flex flex-wrap gap-2">
                {item.status !== "approved" && (
                  <button type="button" disabled={busy !== ""} onClick={() => patch({ status: "approved" }, d.approved)} className={BTN_PRIMARY}>
                    {busy === "patch" ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Check size={15} aria-hidden="true" />}
                    {d.approve}
                  </button>
                )}
                {item.status !== "declined" && (
                  <button type="button" disabled={busy !== ""} onClick={() => patch({ status: "declined" }, d.declined)} className={BTN_SECONDARY}>
                    <X size={15} aria-hidden="true" />
                    {d.decline}
                  </button>
                )}
                {item.status !== "pending" && (
                  <button type="button" disabled={busy !== ""} onClick={() => patch({ status: "pending" }, d.reopened)} className={BTN_SECONDARY}>
                    {d.reopen}
                  </button>
                )}
              </div>
              <Field id="cn-note" label={d.note} hint={d.noteHelp} optional>
                <textarea id="cn-note" className={INPUT} rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
              <div>
                <button type="button" disabled={busy !== "" || note === (item.decision_note ?? "")} onClick={() => patch({ decision_note: note }, d.noteSaved)} className={BTN_SECONDARY}>
                  {busy === "patch" ? d.savingNote : d.saveNote}
                </button>
              </div>
              <ErrorLine message={error} />
            </div>
          ) : (
            <p className="text-sm text-ringo-muted">{d.readOnly}</p>
          )}

          {history.length > 0 && (
            <section aria-labelledby="cn-history" className="flex flex-col gap-1">
              <h2 id="cn-history" className="font-display text-base font-semibold text-ringo-text">
                {d.history}
              </h2>
              <ul className="text-sm text-ringo-muted">
                {history.map((h) => (
                  <li key={h.id}>{d.historyLine(c.status[h.from_status], c.status[h.to_status], formatDay(h.created_at, locale))}</li>
                ))}
              </ul>
            </section>
          )}

          {canDecide && (
            <div>
              <button type="button" onClick={() => setDeleting(true)} className={`${BTN_SECONDARY} text-ringo-coral`}>
                <Trash2 size={15} aria-hidden="true" />
                {d.delete}
              </button>
            </div>
          )}
          {deleting && <ConfirmDialog title={d.deleteTitle} body={d.deleteBody} confirmLabel={d.deleteConfirm} danger onConfirm={remove} onCancel={() => setDeleting(false)} />}
        </>
      )}
    </section>
  );
}
