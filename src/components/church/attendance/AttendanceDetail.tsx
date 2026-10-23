"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Loader2, Trash2, UserPlus, Users } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import type { ChurchCapabilities } from "@/lib/church/permissions";
import { churchErrorText } from "../lifecycle/errorText";
import { Badge, BTN_PRIMARY, BTN_SECONDARY, ConfirmDialog, ErrorLine, Field, INPUT, ListSkeleton, NoticeBar, churchApi, formatDay, useDebounced, useNotice } from "../people/shared";

export interface Person {
  member_id: string;
  full_name: string | null;
  recorded_at: string;
}
export interface Detail {
  event: { id: string; event_date: string; start_time: string | null; end_time: string | null; title_en: string | null; title_fr: string | null; venue: string | null; is_cancelled: boolean };
  people: Person[];
  counts: { visitors: number; children: number; updated_at: string } | null;
  can: { record: boolean; remove: boolean; seeNames: boolean };
  open: boolean;
}
export interface Found {
  id: string;
  full_name: string;
  age_group: string;
}
export interface GroupRow {
  id: string;
  name: string;
  member_count: number;
}

// One event's attendance: the people recorded present, a way to record more (search the roster, or a whole group), and the visitor / children counts. Everything the screen shows or does is decided by the
// server and the database: the buttons only reflect it. Recording is idempotent, a child is never named, and attendance is removed, never edited.
export default function AttendanceDetail({ eventId, caps }: { eventId: string; caps: ChurchCapabilities }) {
  const { t, locale } = useLanguage();
  const lang = locale === "fr" ? "fr" : "en";
  const c = t.churchAttendance.detail;
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const q = useDebounced(text.trim(), 250);
  const [found, setFound] = useState<Found[]>([]);
  const [searching, setSearching] = useState(false);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [groupId, setGroupId] = useState("");
  const [removing, setRemoving] = useState<Person | null>(null);
  const [confirmGroup, setConfirmGroup] = useState(false);
  const [visitors, setVisitors] = useState("0");
  const [children, setChildren] = useState("0");
  const [stale, setStale] = useState(false);
  const { notice, show } = useNotice();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    setStale(false);
    const r = await churchApi<Detail>(`/api/church/attendance/${eventId}`);
    setLoading(false);
    if (!r.ok) {
      setLoadError(churchErrorText(t, r.code));
      return;
    }
    setData(r.body);
    setVisitors(String(r.body.counts?.visitors ?? 0));
    setChildren(String(r.body.counts?.children ?? 0));
  }, [eventId, t]);
  useEffect(() => {
    load();
  }, [load]);

  const presentIds = useMemo(() => new Set((data?.people ?? []).map((p) => p.member_id)), [data]);
  const canSearch = !!data?.can.record && !!data?.can.seeNames;

  // search the roster (People permission): active people only, never a child
  useEffect(() => {
    if (!canSearch || q.length < 1) {
      setFound([]);
      return;
    }
    let live = true;
    setSearching(true);
    churchApi<{ members: Found[] }>(`/api/church/members?${new URLSearchParams({ q, status: "active" }).toString()}`).then((r) => {
      if (!live) return;
      setSearching(false);
      setFound(r.ok ? r.body.members.filter((m) => m.age_group !== "child") : []);
    });
    return () => {
      live = false;
    };
  }, [q, canSearch]);

  // groups, for the "record a whole group" shortcut (Groups permission)
  useEffect(() => {
    if (!canSearch || !caps.viewGroups) return;
    churchApi<{ groups: GroupRow[] }>("/api/church/groups?status=active").then((r) => {
      if (r.ok) setGroups(r.body.groups.filter((g) => g.member_count > 0));
    });
  }, [canSearch, caps.viewGroups]);

  const record = async (ids: string[]): Promise<{ ok: true; recorded: number; already: number } | { ok: false; message: string }> => {
    const r = await churchApi<{ recorded: number; already: number }>(`/api/church/attendance/${eventId}`, { method: "POST", body: ids.length === 1 ? { member_id: ids[0] } : { member_ids: ids } });
    if (!r.ok) return { ok: false, message: churchErrorText(t, r.code) };
    return { ok: true, recorded: r.body.recorded, already: r.body.already };
  };

  const markOne = async (m: Found) => {
    setBusy(true);
    setError("");
    const r = await record([m.id]);
    setBusy(false);
    if (!r.ok) return setError(r.message);
    show(c.add.recorded);
    await load();
  };

  const markGroup = async (): Promise<string> => {
    // every page of the group's active members, minus children (the server refuses a child, so none is ever sent)
    const ids: string[] = [];
    for (let page = 1; page <= 40; page++) {
      const r = await churchApi<{ members: Found[]; hasMore: boolean }>(`/api/church/members?${new URLSearchParams({ group_id: groupId, status: "active", page: String(page) }).toString()}`);
      if (!r.ok) return churchErrorText(t, r.code);
      for (const m of r.body.members) if (m.age_group !== "child") ids.push(m.id);
      if (!r.body.hasMore) break;
    }
    if (ids.length === 0) return c.add.groupEmpty;
    let recorded = 0;
    let already = 0;
    for (let i = 0; i < ids.length; i += 100) {
      const r = await record(ids.slice(i, i + 100));
      if (!r.ok) return r.message;
      recorded += r.recorded;
      already += r.already;
    }
    setConfirmGroup(false);
    setGroupId("");
    show(c.add.groupRecorded(recorded, already));
    await load();
    return "";
  };

  const removeOne = async (): Promise<string> => {
    if (!removing) return "";
    const r = await churchApi(`/api/church/attendance/${eventId}?member_id=${encodeURIComponent(removing.member_id)}`, { method: "DELETE" });
    if (!r.ok) return churchErrorText(t, r.code);
    setRemoving(null);
    show(c.people.removed);
    await load();
    return "";
  };

  const saveCounts = async () => {
    setBusy(true);
    setError("");
    const body: Record<string, unknown> = { visitors: Number(visitors), children: Number(children) };
    if (data?.counts) body.expected_updated_at = data.counts.updated_at;
    const r = await churchApi(`/api/church/attendance/${eventId}/counts`, { method: "POST", body });
    setBusy(false);
    if (!r.ok) {
      if (r.code === "stale") setStale(true);
      return setError(churchErrorText(t, r.code));
    }
    show(c.counts.saved);
    await load();
  };

  if (loading && !data) return <ListSkeleton rows={3} />;
  if (loadError || !data) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-2xl border border-ringo-coral/30 bg-ringo-coral/[0.05] p-4">
        <ErrorLine message={`${c.loadError} ${loadError}`} />
        <button type="button" className={BTN_SECONDARY} onClick={load}>
          {t.churchPeople.common.retry}
        </button>
      </div>
    );
  }
  return (
    <AttendanceDetailView
      lang={lang}
      data={data}
      caps={caps}
      notice={notice}
      error={error}
      busy={busy}
      text={text}
      onText={setText}
      q={q}
      searching={searching}
      found={found}
      groups={groups}
      groupId={groupId}
      onGroup={setGroupId}
      presentIds={presentIds}
      canSearch={canSearch}
      stale={stale}
      visitors={visitors}
      childrenCount={children}
      onVisitors={setVisitors}
      onChildren={setChildren}
      onReload={load}
      onMarkOne={markOne}
      removing={removing}
      onAskRemove={setRemoving}
      onRemove={removeOne}
      confirmGroup={confirmGroup}
      onAskGroup={setConfirmGroup}
      onMarkGroup={markGroup}
      onSaveCounts={saveCounts}
    />
  );
}

export interface AttendanceDetailViewProps {
  lang: "en" | "fr";
  data: Detail;
  caps: ChurchCapabilities;
  notice: string;
  error: string;
  busy: boolean;
  text: string;
  onText: (v: string) => void;
  q: string;
  searching: boolean;
  found: Found[];
  groups: GroupRow[];
  groupId: string;
  onGroup: (v: string) => void;
  presentIds: Set<string>;
  canSearch: boolean;
  stale: boolean;
  visitors: string;
  childrenCount: string;
  onVisitors: (v: string) => void;
  onChildren: (v: string) => void;
  onReload: () => void;
  onMarkOne: (m: Found) => void;
  removing: Person | null;
  onAskRemove: (p: Person | null) => void;
  onRemove: () => Promise<string>;
  confirmGroup: boolean;
  onAskGroup: (v: boolean) => void;
  onMarkGroup: () => Promise<string>;
  onSaveCounts: () => void;
}

// The presentational half: everything the screen draws from the data it is given. Exported so every state (names hidden, cancelled, view only, empty, with people) can be rendered and checked offline.
export function AttendanceDetailView(p: AttendanceDetailViewProps) {
  const { t } = useLanguage();
  const c = t.churchAttendance.detail;
  const { lang, data, caps, busy, groups, groupId } = p;
  const title = (lang === "fr" ? data.event.title_fr || data.event.title_en : data.event.title_en || data.event.title_fr) || t.churchAttendance.list.untitled;
  const manage = caps.manageAttendance;
  const countsDirty = String(data.counts?.visitors ?? 0) !== p.visitors || String(data.counts?.children ?? 0) !== p.childrenCount;
  const countsValid = /^\d{1,6}$/.test(p.visitors) && /^\d{1,6}$/.test(p.childrenCount);
  const selectedGroup = groups.find((g) => g.id === groupId);

  return (
    <div>
      <NoticeBar message={p.notice} />
      <Link href="/dashboard/church/attendance" className="mb-4 inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-2 text-sm font-semibold text-ringo-indigo hover:bg-ringo-indigo/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40">
        <ArrowLeft size={15} aria-hidden="true" />
        {c.back}
      </Link>
      <h2 className="font-display text-lg font-semibold text-ringo-text [overflow-wrap:anywhere]">{title}</h2>
      <p className="mb-4 mt-1 text-sm text-ringo-muted">{[formatDay(data.event.event_date, lang), data.event.venue].filter(Boolean).join(" · ")}</p>

      {data.event.is_cancelled && <p className="mb-3 rounded-2xl px-4 py-3 text-sm font-medium text-amber-800 ring-1 ring-amber-600/25">{c.cancelledBanner}</p>}
      {!manage && <p className="mb-3 text-sm text-ringo-muted">{c.viewOnly}</p>}
      {!data.can.seeNames && <p className="mb-3 text-sm text-ringo-muted">{c.namesHidden}</p>}
      {manage && !data.can.seeNames && data.open && <p className="mb-3 text-sm text-ringo-muted">{c.needsPeople}</p>}

      <div className="flex flex-col gap-6">
        <section aria-labelledby="att-people-heading">
          <h3 id="att-people-heading" className="mb-2 flex items-center gap-2 font-display text-base font-semibold text-ringo-text">
            <Users size={16} className="text-ringo-indigo" aria-hidden="true" />
            {c.people.heading(data.people.length)}
          </h3>
          {data.people.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-ringo-border px-4 py-6 text-center text-sm text-ringo-muted">{c.people.empty}</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {data.people.map((person) => {
                const name = person.full_name ?? c.people.unnamed;
                return (
                  <li key={person.member_id} className="flex min-h-[52px] items-center justify-between gap-3 rounded-2xl border border-ringo-border/70 bg-ringo-surface px-4 py-2">
                    <span className="min-w-0 truncate text-sm font-medium text-ringo-text">{name}</span>
                    {data.can.remove && (
                      <button
                        type="button"
                        aria-label={c.people.remove(name)}
                        onClick={() => p.onAskRemove(person)}
                        disabled={busy}
                        className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-ringo-muted hover:bg-ringo-coral/10 hover:text-ringo-coral focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40 disabled:opacity-60"
                      >
                        <Trash2 size={16} aria-hidden="true" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {p.canSearch && (
          <section aria-labelledby="att-add-heading" className="flex flex-col gap-4">
            <h3 id="att-add-heading" className="flex items-center gap-2 font-display text-base font-semibold text-ringo-text">
              <UserPlus size={16} className="text-ringo-indigo" aria-hidden="true" />
              {c.add.heading}
            </h3>
            <Field id="att-search" label={c.add.searchLabel} hint={c.add.searchHint}>
              <input id="att-search" className={INPUT} value={p.text} onChange={(e) => p.onText(e.target.value)} placeholder={c.add.searchPlaceholder} autoComplete="off" disabled={busy} />
            </Field>
            {p.q.length > 0 && (
              <div aria-live="polite">
                {p.searching ? (
                  <p className="text-sm text-ringo-muted">{c.add.searching}</p>
                ) : p.found.length === 0 ? (
                  <p className="text-sm text-ringo-muted">{c.add.noResults}</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {p.found.map((m) => (
                      <li key={m.id} className="flex min-h-[52px] items-center justify-between gap-3 rounded-2xl border border-ringo-border/70 bg-ringo-surface px-4 py-2">
                        <span className="min-w-0 truncate text-sm font-medium text-ringo-text">{m.full_name}</span>
                        {p.presentIds.has(m.id) ? (
                          <Badge tone="active">{c.add.here}</Badge>
                        ) : (
                          <button type="button" aria-label={c.add.mark(m.full_name)} onClick={() => p.onMarkOne(m)} disabled={busy} className={BTN_SECONDARY}>
                            <Check size={15} aria-hidden="true" />
                            {c.add.markShort}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {groups.length > 0 && (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <Field id="att-group" label={c.add.groupLabel}>
                  <select id="att-group" className={INPUT} value={groupId} onChange={(e) => p.onGroup(e.target.value)} disabled={busy}>
                    <option value="">{c.add.groupNone}</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} ({c.add.groupMembers(g.member_count)})
                      </option>
                    ))}
                  </select>
                </Field>
                <button type="button" className={BTN_SECONDARY} onClick={() => p.onAskGroup(true)} disabled={busy || !groupId}>
                  {c.add.groupButton}
                </button>
              </div>
            )}
          </section>
        )}

        <section aria-labelledby="att-counts-heading" className="flex flex-col gap-3">
          <h3 id="att-counts-heading" className="font-display text-base font-semibold text-ringo-text">
            {c.counts.heading}
          </h3>
          <p className="text-sm leading-relaxed text-ringo-muted">{c.counts.help}</p>
          {p.stale && (
            <div role="alert" className="flex flex-col items-start gap-2 rounded-2xl border border-ringo-coral/30 bg-ringo-coral/[0.05] p-4">
              <p className="text-sm text-ringo-coral">{c.counts.stale}</p>
              <button type="button" className={BTN_SECONDARY} onClick={p.onReload}>
                {c.counts.reload}
              </button>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="att-visitors" label={c.counts.visitors}>
              <input id="att-visitors" className={INPUT} inputMode="numeric" value={p.visitors} onChange={(e) => p.onVisitors(e.target.value.replace(/\D/g, "").slice(0, 6))} disabled={!manage || busy} />
            </Field>
            <Field id="att-children" label={c.counts.children}>
              <input id="att-children" className={INPUT} inputMode="numeric" value={p.childrenCount} onChange={(e) => p.onChildren(e.target.value.replace(/\D/g, "").slice(0, 6))} disabled={!manage || busy} />
            </Field>
          </div>
          <ErrorLine message={p.error} />
          {manage && data.open && (
            <div>
              <button type="button" className={BTN_PRIMARY} onClick={p.onSaveCounts} disabled={busy || !countsDirty || !countsValid}>
                {busy && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
                {busy ? c.counts.saving : c.counts.save}
              </button>
            </div>
          )}
        </section>
      </div>

      {p.removing && <ConfirmDialog title={c.people.removeTitle} body={c.people.removeBody(p.removing.full_name ?? c.people.unnamed)} confirmLabel={c.people.removeConfirm} danger onCancel={() => p.onAskRemove(null)} onConfirm={p.onRemove} />}
      {p.confirmGroup && selectedGroup && <ConfirmDialog title={c.add.groupConfirmTitle(selectedGroup.name)} body={c.add.groupConfirmBody} confirmLabel={c.add.groupConfirm} onCancel={() => p.onAskGroup(false)} onConfirm={p.onMarkGroup} />}
    </div>
  );
}
