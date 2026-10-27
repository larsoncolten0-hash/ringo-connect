"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, Download, Loader2, Search, UserCheck, X } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { churchErrorText } from "../lifecycle/errorText";
import { Badge, BTN_PRIMARY, BTN_SECONDARY, ConfirmDialog, EmptyState, ErrorLine, INPUT, ListSkeleton, NoticeBar, churchApi, formatDay, useDebounced, useNotice } from "../people/shared";

interface Summary {
  members: number;
  adults: number;
  youth: number;
  children?: number;
  pending: number;
}
interface MemberRow {
  id: string;
  full_name: string;
  age_group: "adult" | "youth" | "child";
  created_at: string;
}
interface ListBody {
  members: MemberRow[];
  page: number;
  pageSize: number;
  total: number;
}

// The Members screen: the people who belong to the church (approved), the requests that came from the church page and wait for a decision, and the printable lists. Counts first, then the requests (they
// need an answer), then the members. Every decision goes through the same /api/church/members routes as the People screen; the server and the database decide what is allowed. A list download is a
// copy of personal information that leaves the app, so it only appears for a person who holds the export permission, and the server checks it again.
export default function MembersView({ canManage, canExport, canExportLeadership, canExportGroups }: { canManage: boolean; canExport: boolean; canExportLeadership: boolean; canExportGroups: boolean }) {
  const { t, locale } = useLanguage();
  const c = t.churchExpansion.members;
  const [summary, setSummary] = useState<Summary | null>(null);
  const [requests, setRequests] = useState<MemberRow[] | null>(null);
  const [members, setMembers] = useState<ListBody | null>(null);
  const [error, setError] = useState("");
  const [rowError, setRowError] = useState("");
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search, 300);
  const [page, setPage] = useState(1);
  const [declining, setDeclining] = useState<MemberRow | null>(null);
  const [busyId, setBusyId] = useState("");
  const { notice, show } = useNotice();

  const loadTop = useCallback(async () => {
    const [s, r] = await Promise.all([churchApi<Summary>("/api/church/members/summary"), churchApi<ListBody>("/api/church/members?status=pending")]);
    if (!s.ok) return setError(churchErrorText(t, s.code));
    if (!r.ok) return setError(churchErrorText(t, r.code));
    setError("");
    setSummary(s.body);
    setRequests(r.body.members);
  }, [t]);
  const loadMembers = useCallback(async () => {
    const q = new URLSearchParams({ status: "active", page: String(page) });
    if (debounced.trim()) q.set("q", debounced.trim());
    const r = await churchApi<ListBody>(`/api/church/members?${q.toString()}`);
    if (!r.ok) return setError(churchErrorText(t, r.code));
    setError("");
    setMembers(r.body);
  }, [t, page, debounced]);
  useEffect(() => {
    loadTop();
  }, [loadTop]);
  useEffect(() => {
    loadMembers();
  }, [loadMembers]);
  useEffect(() => setPage(1), [debounced]);

  const decide = async (row: MemberRow, status: "active" | "removed"): Promise<string> => {
    setRowError("");
    setBusyId(row.id);
    const r = await churchApi(`/api/church/members/${row.id}`, { method: "PATCH", body: { status } });
    setBusyId("");
    if (!r.ok) return churchErrorText(t, r.code);
    show(status === "active" ? c.requests.approved : c.requests.declined);
    await Promise.all([loadTop(), loadMembers()]);
    return "";
  };

  const pages = members ? Math.max(1, Math.ceil(members.total / members.pageSize)) : 1;
  const stat = (label: string, value: number | undefined) =>
    value === undefined ? null : (
      <div className="rounded-card border border-ringo-border bg-ringo-surface px-4 py-3">
        <dt className="text-xs font-semibold text-ringo-muted">{label}</dt>
        <dd className="mt-1 font-display text-2xl font-semibold tabular-nums text-ringo-text">{value}</dd>
      </div>
    );

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="font-display text-xl font-semibold text-ringo-text">{c.title}</h1>
        <p className="mt-1 max-w-[65ch] text-sm leading-relaxed text-ringo-muted">{c.intro}</p>
      </header>
      <NoticeBar message={notice} />
      {error && (
        <div className="flex flex-col items-start gap-3">
          <ErrorLine message={error} />
          <button type="button" onClick={() => { loadTop(); loadMembers(); }} className={BTN_SECONDARY}>
            {c.retry}
          </button>
        </div>
      )}

      {summary && (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5" aria-label={c.title}>
          {stat(c.summary.members, summary.members)}
          {stat(c.summary.adults, summary.adults)}
          {stat(c.summary.youth, summary.youth)}
          {stat(c.summary.children, summary.children)}
          {stat(c.summary.pending, summary.pending)}
        </dl>
      )}

      <section aria-labelledby="church-requests-title" className="flex flex-col gap-3">
        <div>
          <h2 id="church-requests-title" className="font-display text-base font-semibold text-ringo-text">
            {c.requests.title}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-ringo-muted">{c.requests.help}</p>
        </div>
        <ErrorLine message={rowError} />
        {requests === null ? (
          <ListSkeleton rows={2} />
        ) : requests.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-ringo-border px-4 py-5 text-sm text-ringo-muted">{c.requests.empty}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {requests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-card border border-ringo-border bg-ringo-surface p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ringo-text">{r.full_name}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ringo-muted">
                    <Badge tone={r.age_group}>{c.list.ages[r.age_group]}</Badge>
                    {c.requests.asked(formatDay(r.created_at, locale))}
                  </p>
                </div>
                {canManage && (
                  <div className="flex shrink-0 gap-2">
                    <button type="button" disabled={busyId === r.id} onClick={async () => { const m = await decide(r, "active"); if (m) setRowError(m); }} className={BTN_PRIMARY} aria-label={c.requests.approveLabel(r.full_name)}>
                      {busyId === r.id ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Check size={15} aria-hidden="true" />}
                      {c.requests.approve}
                    </button>
                    <button type="button" disabled={busyId === r.id} onClick={() => setDeclining(r)} className={BTN_SECONDARY} aria-label={c.requests.declineLabel(r.full_name)}>
                      <X size={15} aria-hidden="true" />
                      {c.requests.decline}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="church-members-title" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="church-members-title" className="font-display text-base font-semibold text-ringo-text">
            {c.list.title}
          </h2>
          {members && <span className="text-xs text-ringo-muted">{c.list.count(members.total)}</span>}
          <div className="relative ml-auto w-full sm:w-64">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ringo-muted" aria-hidden="true" />
            <input type="search" aria-label={c.list.searchLabel} placeholder={c.list.search} className={`${INPUT} pl-9`} value={search} maxLength={80} onChange={(e) => setSearch(e.target.value)} autoComplete="off" />
          </div>
        </div>
        {members === null ? (
          <ListSkeleton rows={4} />
        ) : members.members.length === 0 ? (
          <EmptyState icon={<UserCheck size={22} aria-hidden="true" />} title={debounced.trim() ? c.list.emptyFiltered : c.list.empty} />
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {members.members.map((m) => (
                <li key={m.id} className="flex items-center gap-3 rounded-card border border-ringo-border bg-ringo-surface px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ringo-text">{m.full_name}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ringo-muted">
                      <Badge tone={m.age_group}>{c.list.ages[m.age_group]}</Badge>
                      {c.list.since(formatDay(m.created_at, locale))}
                    </p>
                  </div>
                  <Link href="/dashboard/church/people" className="shrink-0 rounded-full px-3 text-sm font-semibold text-ringo-indigo hover:bg-ringo-indigo/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40" style={{ minHeight: 44, display: "inline-flex", alignItems: "center" }}>
                    {c.list.open}
                  </Link>
                </li>
              ))}
            </ul>
            {pages > 1 && (
              <nav aria-label={c.list.title} className="flex items-center justify-between gap-3">
                <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className={BTN_SECONDARY}>
                  {c.list.previous}
                </button>
                <span className="text-xs text-ringo-muted">{c.list.page(page, pages)}</span>
                <button type="button" onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages} className={BTN_SECONDARY}>
                  {c.list.next}
                </button>
              </nav>
            )}
          </>
        )}
      </section>

      {canExport && <Lists locale={locale} canMembers={true} canLeadership={canExportLeadership} canGroups={canExportGroups} />}

      {declining && (
        <ConfirmDialog
          title={c.requests.declineTitle}
          body={c.requests.declineBody}
          confirmLabel={c.requests.declineConfirm}
          danger
          onConfirm={async () => {
            const m = await decide(declining, "removed");
            if (!m) setDeclining(null);
            return m;
          }}
          onCancel={() => setDeclining(null)}
        />
      )}
    </div>
  );
}

function Lists({ locale, canMembers, canLeadership, canGroups }: { locale: string; canMembers: boolean; canLeadership: boolean; canGroups: boolean }) {
  const { t } = useLanguage();
  const c = t.churchExpansion.members.lists;
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const download = async (kind: "members" | "leadership" | "groups") => {
    setBusy(kind);
    setError("");
    try {
      const res = await fetch(`/api/church/lists/${kind}?lang=${locale === "fr" ? "fr" : "en"}`, { cache: "no-store" });
      if (!res.ok) {
        let code = "";
        try {
          code = (await res.json())?.error ?? "";
        } catch {
          /* not JSON */
        }
        setError(code === "forbidden" ? c.needPermission : c.failed);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "")?.[1] ?? `${kind}.pdf`;
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setError(c.failed);
    } finally {
      setBusy("");
    }
  };

  const items: Array<["members" | "leadership" | "groups", string, boolean]> = [["members", c.members, canMembers], ["leadership", c.leadership, canLeadership], ["groups", c.groups, canGroups]];
  return (
    <section aria-labelledby="church-lists-title" className="flex flex-col gap-3 rounded-card border border-ringo-border bg-ringo-surface p-4 sm:p-5">
      <div>
        <h2 id="church-lists-title" className="font-display text-base font-semibold text-ringo-text">
          {c.title}
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-ringo-muted">{c.help}</p>
      </div>
      <ul className="grid gap-2 sm:grid-cols-3">
        {items.filter(([, , allowed]) => allowed).map(([kind, label]) => (
          <li key={kind}>
            <button type="button" onClick={() => download(kind)} disabled={busy !== ""} className={`${BTN_SECONDARY} w-full`} aria-label={`${c.download}: ${label}`}>
              {busy === kind ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}
              {busy === kind ? c.preparing : label}
            </button>
          </li>
        ))}
      </ul>
      <ErrorLine message={error} />
    </section>
  );
}
