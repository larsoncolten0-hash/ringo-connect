"use client";

import { useCallback, useEffect, useState } from "react";
import { Archive, ArchiveRestore, Loader2, Pencil, Trash2, UserMinus, UserPlus } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import type { ChurchCapabilities } from "@/lib/church/permissions";
import GroupFormDialog, { type GroupRecord } from "./GroupFormDialog";
import PersonPicker, { type PickedPerson } from "./PersonPicker";
import { Badge, BTN_DANGER, BTN_PRIMARY, BTN_SECONDARY, ConfirmDialog, ErrorLine, Field, INPUT, ListSkeleton, Modal, NoticeBar, churchApi, errorText, useNotice } from "./shared";

interface GroupDetail {
  group: GroupRecord;
  members: Array<{ membership_id: string; member_id: string; role: "leader" | "assistant" | "member" | "volunteer" | "worker"; name: string | null; status: string | null; age_group: "adult" | "youth" | "child" | null }>;
  viewer: { kind: string; canManageGroup: boolean; canManageMembers: boolean; canLeaderEdit: boolean };
}
type Role = GroupDetail["members"][number]["role"];
const ROLES: Role[] = ["leader", "assistant", "member", "volunteer", "worker"];

// One group: its people and their roles. Administrators (groups.manage) add, re-role and remove people and archive, rename or delete the group. A group LEADER (who is not staff) sees the group
// and may re-label or remove plain members only; the database enforces both. Leaders appointed here are roster people: appointing one gives no dashboard access.
export default function GroupDetailDialog({ id, caps, onClose, onChanged }: { id: string; caps: ChurchCapabilities; onClose: () => void; onChanged: (message: string, deleted?: boolean) => void }) {
  const { t } = useLanguage();
  const c = t.churchPeople;
  const d = c.groups.detail;
  const [data, setData] = useState<GroupDetail | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<GroupDetail["members"][number] | null>(null);
  const [confirm, setConfirm] = useState<null | "archive" | "delete">(null);
  const [rowError, setRowError] = useState("");
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const { notice, show } = useNotice();

  const load = useCallback(async () => {
    setError("");
    const r = await churchApi<GroupDetail>(`/api/church/groups/${id}`);
    if (r.ok) setData(r.body);
    else setError(errorText(c.errors, r.code));
  }, [id, c.errors]);
  useEffect(() => {
    load();
  }, [load]);

  const g = data?.group;
  const canManage = !!data?.viewer.canManageGroup;
  const archived = g?.status === "archived";

  const changeRole = async (membershipId: string, role: Role) => {
    setBusyRow(membershipId);
    setRowError("");
    const r = await churchApi(`/api/church/groups/${id}/members/${membershipId}`, { method: "PATCH", body: { role } });
    setBusyRow(null);
    if (!r.ok) {
      setRowError(errorText(c.errors, r.code));
      return;
    }
    show(d.roleChanged);
    load();
  };

  return (
    <>
      <Modal title={g?.name ?? c.groups.loadError} subtitle={g ? `${c.kinds[g.kind]}${g.description ? ` · ${g.description}` : ""}` : undefined} onClose={onClose} wide labelledBy="church-group-detail-title">
        {!data && !error && <ListSkeleton rows={3} />}
        {error && (
          <div className="flex flex-col gap-3">
            <ErrorLine message={error} />
            <button type="button" className={BTN_SECONDARY} onClick={load}>
              {c.common.retry}
            </button>
          </div>
        )}
        {data && g && (
          <div className="flex flex-col gap-4">
            <NoticeBar message={notice} />
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={g.status}>{c.groupStatus[g.status]}</Badge>
              {!canManage && <span className="text-xs text-ringo-muted">{d.viewOnly}</span>}
            </div>
            {archived && <p className="rounded-2xl bg-ringo-muted/10 px-4 py-3 text-sm text-ringo-muted">{d.archivedNote}</p>}

            <section aria-labelledby="gd-members">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 id="gd-members" className="text-xs font-semibold uppercase tracking-wide text-ringo-muted">
                  {d.members} · {data.members.length}
                </h3>
                {canManage && !archived && (
                  <button type="button" className={BTN_SECONDARY} onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
                    <UserPlus size={14} aria-hidden="true" />
                    {d.addPerson}
                  </button>
                )}
              </div>

              {adding && <AddPerson groupId={id} onAdded={() => { setAdding(false); show(d.added); load(); onChanged(d.added); }} />}

              {data.members.length === 0 ? (
                <p className="text-sm text-ringo-muted">{d.noMembers}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {data.members.map((m) => {
                    const isLead = m.role === "leader" || m.role === "assistant";
                    // administrators change anyone; a group leader only plain members (and never their own leading row)
                    const canEditRow = canManage || (data.viewer.canLeaderEdit && !isLead);
                    const isChild = m.age_group === "child";
                    return (
                      <li key={m.membership_id} className="flex flex-col gap-2 rounded-2xl border border-ringo-border/70 bg-ringo-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-semibold text-ringo-text">{m.name ?? d.hiddenName}</span>
                          {isChild && <Badge tone="child">{c.age.child}</Badge>}
                        </span>
                        <span className="flex items-center gap-2">
                          {canEditRow ? (
                            <>
                              <label className="sr-only" htmlFor={`gd-role-${m.membership_id}`}>
                                {d.role}: {m.name ?? d.hiddenName}
                              </label>
                              <select
                                id={`gd-role-${m.membership_id}`}
                                className={`${INPUT} !w-auto`}
                                value={m.role}
                                disabled={busyRow === m.membership_id}
                                onChange={(e) => changeRole(m.membership_id, e.target.value as Role)}
                              >
                                {ROLES.map((r) => (
                                  <option key={r} value={r} disabled={(r === "leader" || r === "assistant") && r !== m.role && (!canManage || m.age_group !== "adult")}>
                                    {c.roles[r]}
                                  </option>
                                ))}
                              </select>
                              {busyRow === m.membership_id && <Loader2 size={14} className="animate-spin text-ringo-muted" aria-hidden="true" />}
                              <button type="button" onClick={() => { setRowError(""); setRemoving(m); }} aria-label={d.removeTitle(m.name ?? d.hiddenName)} className="flex h-11 w-11 items-center justify-center rounded-full text-ringo-muted hover:bg-ringo-coral/10 hover:text-ringo-coral focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-coral/40">
                                <UserMinus size={15} aria-hidden="true" />
                              </button>
                            </>
                          ) : (
                            <Badge tone={isLead ? m.role : "inactive"}>{c.roles[m.role]}</Badge>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              <ErrorLine message={rowError} />
              {canManage && <p className="mt-3 text-xs leading-relaxed text-ringo-muted">{d.leaderNote}</p>}
            </section>

            {canManage && (
              <div className="flex flex-col gap-2 border-t border-ringo-border/70 pt-4 sm:flex-row sm:flex-wrap">
                <button type="button" className={BTN_SECONDARY} onClick={() => setEditing(true)}>
                  <Pencil size={14} aria-hidden="true" />
                  {c.common.edit}
                </button>
                {archived ? (
                  <button
                    type="button"
                    className={BTN_SECONDARY}
                    onClick={async () => {
                      const r = await churchApi(`/api/church/groups/${id}`, { method: "PATCH", body: { status: "active" } });
                      if (!r.ok) setRowError(errorText(c.errors, r.code));
                      else {
                        show(d.reactivated);
                        load();
                        onChanged(d.reactivated);
                      }
                    }}
                  >
                    <ArchiveRestore size={14} aria-hidden="true" />
                    {d.unarchive}
                  </button>
                ) : (
                  <button type="button" className={BTN_SECONDARY} onClick={() => setConfirm("archive")}>
                    <Archive size={14} aria-hidden="true" />
                    {d.archive}
                  </button>
                )}
                <button type="button" className={`${BTN_DANGER} sm:ml-auto`} onClick={() => setConfirm("delete")}>
                  <Trash2 size={14} aria-hidden="true" />
                  {d.delete}
                </button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {editing && g && (
        <GroupFormDialog
          mode="edit"
          group={g}
          onClose={() => setEditing(false)}
          onSaved={(message) => {
            setEditing(false);
            show(message);
            load();
            onChanged(message);
          }}
        />
      )}

      {removing && (
        <ConfirmDialog
          title={d.removeTitle(removing.name ?? d.hiddenName)}
          body={d.removeBody}
          confirmLabel={d.removeAction}
          danger
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            const r = await churchApi(`/api/church/groups/${id}/members/${removing.membership_id}`, { method: "DELETE" });
            if (!r.ok) return errorText(c.errors, r.code);
            setRemoving(null);
            show(d.removed);
            load();
            onChanged(d.removed);
            return "";
          }}
        />
      )}

      {confirm === "archive" && g && (
        <ConfirmDialog
          title={d.archiveTitle(g.name)}
          body={d.archiveBody}
          confirmLabel={d.archiveAction}
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            const r = await churchApi(`/api/church/groups/${id}`, { method: "PATCH", body: { status: "archived" } });
            if (!r.ok) return errorText(c.errors, r.code);
            setConfirm(null);
            show(d.archived);
            load();
            onChanged(d.archived);
            return "";
          }}
        />
      )}

      {confirm === "delete" && g && (
        <ConfirmDialog
          title={d.deleteTitle(g.name)}
          body={`${d.deleteBody}${caps.viewChildren ? ` ${d.deleteBodyChildren}` : ""}`}
          confirmLabel={d.deleteAction}
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            const r = await churchApi(`/api/church/groups/${id}`, { method: "DELETE" });
            if (!r.ok) return errorText(c.errors, r.code);
            setConfirm(null);
            onChanged(d.deleted, true);
            return "";
          }}
        />
      )}
    </>
  );
}

function AddPerson({ groupId, onAdded }: { groupId: string; onAdded: () => void }) {
  const { t } = useLanguage();
  const c = t.churchPeople;
  const d = c.groups.detail;
  const [person, setPerson] = useState<PickedPerson | null>(null);
  const [role, setRole] = useState<Role>("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // only an adult can lead or assist; a child, or a youth, is a plain member
  const adult = person?.age_group === "adult";
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!person) return;
    setBusy(true);
    setError("");
    const r = await churchApi(`/api/church/groups/${groupId}/members`, { method: "POST", body: { member_id: person.id, role: adult ? role : "member" } });
    setBusy(false);
    if (!r.ok) {
      setError(errorText(c.errors, r.code));
      return;
    }
    onAdded();
  };
  return (
    <form onSubmit={submit} className="mb-3 flex flex-col gap-3 rounded-2xl border border-ringo-indigo/30 bg-ringo-indigo/[0.03] p-4" aria-label={d.addTitle}>
      <Field id="gd-pick" label={d.pickPerson}>
        <PersonPicker label={d.pickPerson} placeholder={d.pickPlaceholder} noneText={d.pickNone} clearLabel={c.common.cancel} value={person} onChange={setPerson} />
      </Field>
      {adult && (
        <Field id="gd-add-role" label={d.role}>
          <select id="gd-add-role" className={INPUT} value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {c.roles[r]}
              </option>
            ))}
          </select>
        </Field>
      )}
      <ErrorLine message={error} />
      <button type="submit" disabled={!person || busy} className={`${BTN_PRIMARY} self-start`}>
        {busy && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
        {d.add}
      </button>
    </form>
  );
}
