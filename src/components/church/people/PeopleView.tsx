"use client";

import { useCallback, useEffect, useState } from "react";
import { Search, UserPlus, Users } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import type { ChurchCapabilities } from "@/lib/church/permissions";
import MemberDetailDialog from "./MemberDetailDialog";
import MemberFormDialog from "./MemberFormDialog";
import { Badge, BTN_LINK, BTN_PRIMARY, BTN_SECONDARY, EmptyState, ErrorLine, INPUT, ListSkeleton, NoticeBar, Pager, churchApi, errorText, useDebounced, useNotice } from "./shared";

interface Row {
  id: string;
  full_name: string;
  status: "pending" | "active" | "inactive" | "removed";
  age_group: "adult" | "youth" | "child";
  guardian_name: string | null;
}
interface ListBody {
  members: Row[];
  page: number;
  pageSize: number;
  total: number;
}
interface GroupOption {
  id: string;
  name: string;
}

// The roster. Server-paged (25 per page), searchable and filterable; the list never carries phone or email (a person's contact details are loaded only when their record is opened).
// Children appear only for people who may see them: the database filters them out for everyone else, so this screen simply never receives them.
export default function PeopleView({ caps }: { caps: ChurchCapabilities }) {
  const { t } = useLanguage();
  const c = t.churchPeople;
  const p = c.people;
  const [input, setInput] = useState("");
  const q = useDebounced(input.trim(), 300);
  const [status, setStatus] = useState("");
  const [age, setAge] = useState("");
  const [groupId, setGroupId] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListBody | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const { notice, show } = useNotice();

  // back to page 1 whenever the question changes
  useEffect(() => setPage(1), [q, status, age, groupId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ page: String(page) });
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    if (age) params.set("age_group", age);
    if (groupId) params.set("group_id", groupId);
    const r = await churchApi<ListBody>(`/api/church/members?${params.toString()}`);
    setLoading(false);
    if (r.ok) setData(r.body);
    else setError(errorText(c.errors, r.code));
  }, [page, q, status, age, groupId, c.errors]);
  useEffect(() => {
    load();
  }, [load]);

  // the group filter is only offered to someone who may see groups
  useEffect(() => {
    if (!caps.viewGroups) return;
    churchApi<{ groups: GroupOption[] }>("/api/church/groups?status=active").then((r) => {
      if (r.ok) setGroups(r.body.groups.map((g) => ({ id: g.id, name: g.name })));
    });
  }, [caps.viewGroups]);

  const filtered = !!(q || status || age || groupId);
  const clear = () => {
    setInput("");
    setStatus("");
    setAge("");
    setGroupId("");
  };
  const changed = (message: string) => {
    setOpenId(null);
    setCreating(false);
    show(message);
    load();
  };

  return (
    <div>
      <NoticeBar message={notice} />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="relative flex-1">
          <label htmlFor="cp-search" className="sr-only">
            {p.searchLabel}
          </label>
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ringo-muted" aria-hidden="true" />
          <input id="cp-search" type="search" value={input} onChange={(e) => setInput(e.target.value)} placeholder={p.searchPlaceholder} maxLength={80} autoComplete="off" className={`${INPUT} pl-10`} />
        </div>
        {caps.manageMembers && (
          <button type="button" className={BTN_PRIMARY} onClick={() => setCreating(true)}>
            <UserPlus size={16} aria-hidden="true" />
            {p.add}
          </button>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label={p.filters}>
        <label className="sr-only" htmlFor="cp-status">
          {p.statusFilter}
        </label>
        <select id="cp-status" value={status} onChange={(e) => setStatus(e.target.value)} className={`${INPUT} !w-auto`}>
          <option value="">{`${p.statusFilter}: ${c.common.all}`}</option>
          {(["pending", "active", "inactive", "removed"] as const).map((s) => (
            <option key={s} value={s}>
              {c.status[s]}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="cp-age">
          {p.ageFilter}
        </label>
        <select id="cp-age" value={age} onChange={(e) => setAge(e.target.value)} className={`${INPUT} !w-auto`}>
          <option value="">{`${p.ageFilter}: ${c.common.all}`}</option>
          <option value="adult">{c.age.adult}</option>
          <option value="youth">{c.age.youth}</option>
          {caps.viewChildren && <option value="child">{c.age.child}</option>}
        </select>
        {caps.viewGroups && groups.length > 0 && (
          <>
            <label className="sr-only" htmlFor="cp-group">
              {p.groupFilter}
            </label>
            <select id="cp-group" value={groupId} onChange={(e) => setGroupId(e.target.value)} className={`${INPUT} !w-auto max-w-[14rem]`}>
              <option value="">{`${p.groupFilter}: ${c.common.all}`}</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </>
        )}
        {filtered && (
          <button type="button" className={BTN_LINK} onClick={clear}>
            {p.clearFilters}
          </button>
        )}
        {data && !loading && (
          <span className="ml-auto text-xs text-ringo-muted" aria-live="polite">
            {p.count(data.total)}
          </span>
        )}
      </div>

      {!caps.viewChildren && <p className="mb-3 text-xs text-ringo-muted">{p.childrenHidden}</p>}

      {error ? (
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-ringo-coral/30 bg-ringo-coral/[0.05] p-4">
          <ErrorLine message={`${p.loadError} ${error}`} />
          <button type="button" className={BTN_SECONDARY} onClick={load}>
            {c.common.retry}
          </button>
        </div>
      ) : loading && !data ? (
        <ListSkeleton />
      ) : data && data.members.length === 0 ? (
        filtered ? (
          <EmptyState icon={<Search size={22} />} title={p.emptyFilteredTitle} body={p.emptyFilteredBody} action={<button type="button" className={BTN_SECONDARY} onClick={clear}>{p.clearFilters}</button>} />
        ) : (
          <EmptyState
            icon={<Users size={22} />}
            title={p.emptyTitle}
            body={p.emptyBody}
            action={
              caps.manageMembers ? (
                <button type="button" className={BTN_PRIMARY} onClick={() => setCreating(true)}>
                  <UserPlus size={16} aria-hidden="true" />
                  {p.add}
                </button>
              ) : undefined
            }
          />
        )
      ) : data ? (
        <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"} aria-busy={loading}>
          <ul className="flex flex-col gap-2">
            {data.members.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(m.id)}
                  aria-label={p.viewDetails(m.full_name)}
                  className="ringo-tactile flex min-h-[64px] w-full items-center justify-between gap-3 rounded-2xl border border-ringo-border/70 bg-ringo-surface px-4 py-3 text-left hover:border-ringo-indigo/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-semibold text-ringo-text">{m.full_name}</span>
                    {m.guardian_name && <span className="truncate text-xs text-ringo-muted">{p.guardianOf(m.guardian_name)}</span>}
                  </span>
                  <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                    {m.age_group !== "adult" && <Badge tone={m.age_group}>{c.age[m.age_group]}</Badge>}
                    <Badge tone={m.status}>{c.status[m.status]}</Badge>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} busy={loading} />
        </div>
      ) : null}

      {openId && <MemberDetailDialog id={openId} caps={caps} onClose={() => setOpenId(null)} onChanged={changed} />}
      {creating && <MemberFormDialog mode="create" caps={caps} onClose={() => setCreating(false)} onSaved={changed} />}
    </div>
  );
}
