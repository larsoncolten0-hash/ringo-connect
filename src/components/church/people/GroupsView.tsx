"use client";

import { useCallback, useEffect, useState } from "react";
import { FolderPlus, Layers } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import type { ChurchCapabilities } from "@/lib/church/permissions";
import GroupDetailDialog from "./GroupDetailDialog";
import GroupFormDialog from "./GroupFormDialog";
import { Badge, BTN_PRIMARY, BTN_SECONDARY, EmptyState, ErrorLine, INPUT, ListSkeleton, NoticeBar, churchApi, errorText, useNotice } from "./shared";

interface Row {
  id: string;
  kind: "department" | "group";
  name: string;
  description: string | null;
  status: "active" | "archived";
  member_count: number;
}

// Departments and groups. Archived groups are kept (with their people) but hidden from the default list.
export default function GroupsView({ caps }: { caps: ChurchCapabilities }) {
  const { t } = useLanguage();
  const c = t.churchPeople;
  const gp = c.groups;
  const [status, setStatus] = useState("active");
  const [kind, setKind] = useState("");
  const [groups, setGroups] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const { notice, show } = useNotice();

  const load = useCallback(async () => {
    setError("");
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (kind) params.set("kind", kind);
    const r = await churchApi<{ groups: Row[] }>(`/api/church/groups?${params.toString()}`);
    if (r.ok) setGroups(r.body.groups);
    else setError(errorText(c.errors, r.code));
  }, [status, kind, c.errors]);
  useEffect(() => {
    load();
  }, [load]);

  const changed = (message: string) => {
    show(message);
    load();
  };
  const filtered = !!kind || status !== "active";

  return (
    <div>
      <NoticeBar message={notice} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="cg-status-filter">
          {gp.statusFilter}
        </label>
        <select id="cg-status-filter" value={status} onChange={(e) => setStatus(e.target.value)} className={`${INPUT} !w-auto`}>
          <option value="active">{c.groupStatus.active}</option>
          <option value="archived">{c.groupStatus.archived}</option>
          <option value="">{c.common.all}</option>
        </select>
        <label className="sr-only" htmlFor="cg-kind-filter">
          {gp.kindFilter}
        </label>
        <select id="cg-kind-filter" value={kind} onChange={(e) => setKind(e.target.value)} className={`${INPUT} !w-auto`}>
          <option value="">{`${gp.kindFilter}: ${c.common.all}`}</option>
          <option value="department">{c.kinds.department}</option>
          <option value="group">{c.kinds.group}</option>
        </select>
        {groups && <span className="text-xs text-ringo-muted" aria-live="polite">{gp.count(groups.length)}</span>}
        {caps.manageGroups && (
          <button type="button" className={`${BTN_PRIMARY} ml-auto`} onClick={() => setCreating(true)}>
            <FolderPlus size={16} aria-hidden="true" />
            {gp.add}
          </button>
        )}
      </div>

      {error ? (
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-ringo-coral/30 bg-ringo-coral/[0.05] p-4">
          <ErrorLine message={`${gp.loadError} ${error}`} />
          <button type="button" className={BTN_SECONDARY} onClick={load}>
            {c.common.retry}
          </button>
        </div>
      ) : !groups ? (
        <ListSkeleton rows={4} />
      ) : groups.length === 0 ? (
        <EmptyState
          icon={<Layers size={22} />}
          title={filtered ? gp.emptyFilteredTitle : gp.emptyTitle}
          body={filtered ? undefined : gp.emptyBody}
          action={
            caps.manageGroups && !filtered ? (
              <button type="button" className={BTN_PRIMARY} onClick={() => setCreating(true)}>
                <FolderPlus size={16} aria-hidden="true" />
                {gp.add}
              </button>
            ) : undefined
          }
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {groups.map((g) => (
            <li key={g.id}>
              <button
                type="button"
                onClick={() => setOpenId(g.id)}
                aria-label={gp.open(g.name)}
                className="ringo-tactile flex h-full min-h-[96px] w-full flex-col gap-2 rounded-2xl border border-ringo-border/70 bg-ringo-surface p-4 text-left hover:border-ringo-indigo/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40"
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="font-display text-base font-semibold text-ringo-text">{g.name}</span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <Badge tone="adult">{c.kinds[g.kind]}</Badge>
                    {g.status === "archived" && <Badge tone="archived">{c.groupStatus.archived}</Badge>}
                  </span>
                </span>
                {g.description && <span className="line-clamp-2 text-sm text-ringo-muted">{g.description}</span>}
                <span className="mt-auto text-xs font-medium text-ringo-indigo">{gp.members(g.member_count)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {openId && (
        <GroupDetailDialog
          id={openId}
          caps={caps}
          onClose={() => setOpenId(null)}
          onChanged={(message, deleted) => {
            // a deleted group closes its own dialog; every other change keeps it open and refreshes the list behind it
            if (deleted) setOpenId(null);
            changed(message);
          }}
        />
      )}
      {creating && (
        <GroupFormDialog
          mode="create"
          onClose={() => setCreating(false)}
          onSaved={(message) => {
            setCreating(false);
            changed(message);
          }}
        />
      )}
    </div>
  );
}
