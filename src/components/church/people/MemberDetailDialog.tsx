"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, RotateCcw, Trash2, UserMinus } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import type { ChurchCapabilities } from "@/lib/church/permissions";
import MemberFormDialog, { type MemberRecord } from "./MemberFormDialog";
import { Badge, BTN_DANGER, BTN_SECONDARY, ConfirmDialog, ErrorLine, ListSkeleton, Modal, churchApi, errorText, formatDay } from "./shared";

interface Detail {
  member: MemberRecord & { removed_at: string | null; created_at: string };
  guardian: { id: string; full_name: string } | null;
  dependents: Array<{ id: string; full_name: string; status: string }>;
  groups: Array<{ membership_id: string; group_id: string; role: string; name: string | null; kind: string | null; status: string | null }>;
  leadership: Array<{ id: string; title: string; started_on: string | null; ended_on: string | null }>;
  can: { edit: boolean; remove: boolean; delete: boolean };
  /** Present (true) when the viewer is a group leader: contact details are not sent. */
  contact_hidden?: boolean;
}

type Pending = null | { kind: "remove" } | { kind: "restore" } | { kind: "delete" };

// One person: contact details, guardian and dependents, group memberships and leadership history, with the actions the caller may take. Every action is confirmed when it is
// consequential (remove, delete) and reports the server's answer: a refusal keeps the dialog open with the reason, success is only announced after the server said so.
export default function MemberDetailDialog({ id, caps, onClose, onChanged }: { id: string; caps: ChurchCapabilities; onClose: () => void; onChanged: (message: string) => void }) {
  const { t, locale } = useLanguage();
  const c = t.churchPeople;
  const d = c.people.detail;
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [actionError, setActionError] = useState("");

  const load = useCallback(async () => {
    setError("");
    const r = await churchApi<Detail>(`/api/church/members/${id}`);
    if (r.ok) setData(r.body);
    else setError(errorText(c.errors, r.code));
  }, [id, c.errors]);
  useEffect(() => {
    load();
  }, [load]);

  const m = data?.member;
  const act = async (method: "PATCH" | "DELETE", body: unknown, done: string): Promise<string> => {
    const r = await churchApi(`/api/church/members/${id}`, { method, body });
    if (!r.ok) return errorText(c.errors, r.code);
    setPending(null);
    onChanged(done);
    return "";
  };

  return (
    <>
      <Modal title={m?.full_name ?? d.loadError} onClose={onClose} wide labelledBy="church-member-detail-title">
        {!data && !error && <ListSkeleton rows={3} />}
        {error && (
          <div className="flex flex-col gap-3">
            <ErrorLine message={error} />
            <button type="button" className={BTN_SECONDARY} onClick={load}>
              {c.common.retry}
            </button>
          </div>
        )}
        {data && m && (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={m.status}>{c.status[m.status]}</Badge>
              <Badge tone={m.age_group}>{c.age[m.age_group]}</Badge>
              <span className="text-xs text-ringo-muted">{m.status === "removed" ? d.removedOn(formatDay(m.removed_at, locale)) : d.addedOn(formatDay(m.created_at, locale))}</span>
            </div>

            {m.age_group !== "child" && (
              <section aria-labelledby="md-contact">
                <h3 id="md-contact" className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ringo-muted">
                  {d.contact}
                </h3>
                {data.contact_hidden ? (
                  <p className="text-sm text-ringo-muted">{d.contactHidden}</p>
                ) : m.phone || m.email ? (
                  <dl className="grid gap-1 text-sm text-ringo-text">
                    {m.phone && (
                      <div className="flex gap-2">
                        <dt className="w-20 shrink-0 text-ringo-muted">{c.people.form.phone}</dt>
                        <dd>{m.phone}</dd>
                      </div>
                    )}
                    {m.email && (
                      <div className="flex gap-2">
                        <dt className="w-20 shrink-0 text-ringo-muted">{c.people.form.email}</dt>
                        <dd className="break-all">{m.email}</dd>
                      </div>
                    )}
                    {m.preferred_language && (
                      <div className="flex gap-2">
                        <dt className="w-20 shrink-0 text-ringo-muted">{c.people.form.language}</dt>
                        <dd>{c.language[m.preferred_language]}</dd>
                      </div>
                    )}
                  </dl>
                ) : (
                  <p className="text-sm text-ringo-muted">{d.noContact}</p>
                )}
              </section>
            )}

            {data.guardian && (
              <section aria-labelledby="md-guardian">
                <h3 id="md-guardian" className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ringo-muted">
                  {d.guardian}
                </h3>
                <p className="text-sm text-ringo-text">{data.guardian.full_name}</p>
              </section>
            )}

            {data.dependents.length > 0 && (
              <section aria-labelledby="md-deps">
                <h3 id="md-deps" className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ringo-muted">
                  {d.dependents}
                </h3>
                <ul className="flex flex-col gap-1 text-sm text-ringo-text">
                  {data.dependents.map((x) => (
                    <li key={x.id}>{x.full_name}</li>
                  ))}
                </ul>
              </section>
            )}

            <section aria-labelledby="md-groups">
              <h3 id="md-groups" className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ringo-muted">
                {d.groups}
              </h3>
              {data.groups.length === 0 ? (
                <p className="text-sm text-ringo-muted">{d.noGroups}</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {data.groups.map((g) => (
                    <li key={g.membership_id} className="flex items-center justify-between gap-2 text-sm text-ringo-text">
                      <span className="truncate">{g.name ?? c.common.unnamed}</span>
                      <Badge tone={g.role === "leader" || g.role === "assistant" ? g.role : "inactive"}>{c.roles[g.role as keyof typeof c.roles] ?? g.role}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {m.age_group === "adult" && (
              <section aria-labelledby="md-lead">
                <h3 id="md-lead" className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ringo-muted">
                  {d.leadership}
                </h3>
                {data.leadership.length === 0 ? (
                  <p className="text-sm text-ringo-muted">{d.noLeadership}</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {data.leadership.map((l) => (
                      <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 text-sm text-ringo-text">
                        <span>
                          {l.title}
                          <span className="ml-2 text-xs text-ringo-muted">{c.leadership.period(l.started_on ? formatDay(l.started_on, locale) : null, l.ended_on ? formatDay(l.ended_on, locale) : null)}</span>
                        </span>
                        <Badge tone={l.ended_on ? "ended" : "current"}>{l.ended_on ? d.ended : d.current}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {(data.can.edit || data.can.remove || data.can.delete) && (
              <section aria-labelledby="md-actions" className="border-t border-ringo-border/70 pt-4">
                <h3 id="md-actions" className="sr-only">
                  {d.actions}
                </h3>
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  {data.can.edit && (
                    <button type="button" className={BTN_SECONDARY} onClick={() => setEditing(true)}>
                      <Pencil size={14} aria-hidden="true" />
                      {c.common.edit}
                    </button>
                  )}
                  {data.can.remove && m.status !== "removed" && (
                    <button type="button" className={BTN_SECONDARY} onClick={() => { setActionError(""); setPending({ kind: "remove" }); }}>
                      <UserMinus size={14} aria-hidden="true" />
                      {d.remove}
                    </button>
                  )}
                  {data.can.remove && m.status === "removed" && (
                    <button type="button" className={BTN_SECONDARY} onClick={() => setPending({ kind: "restore" })}>
                      <RotateCcw size={14} aria-hidden="true" />
                      {d.restore}
                    </button>
                  )}
                  {data.can.delete && (
                    <button type="button" className={`${BTN_DANGER} sm:ml-auto`} onClick={() => { setActionError(""); setPending({ kind: "delete" }); }}>
                      <Trash2 size={14} aria-hidden="true" />
                      {d.delete}
                    </button>
                  )}
                </div>
                <ErrorLine message={actionError} />
              </section>
            )}
          </div>
        )}
      </Modal>

      {editing && data && m && (
        <MemberFormDialog
          mode="edit"
          member={m}
          guardian={data.guardian ? { id: data.guardian.id, full_name: data.guardian.full_name } : null}
          caps={caps}
          onClose={() => setEditing(false)}
          onSaved={(message) => {
            setEditing(false);
            onChanged(message);
          }}
        />
      )}

      {pending?.kind === "remove" && m && (
        <ConfirmDialog title={c.people.confirm.removeTitle(m.full_name)} body={c.people.confirm.removeBody} confirmLabel={c.people.confirm.removeAction} danger onCancel={() => setPending(null)} onConfirm={() => act("PATCH", { status: "removed" }, c.people.confirm.removedDone)} />
      )}
      {pending?.kind === "restore" && m && (
        <ConfirmDialog title={c.people.confirm.statusTitle(m.full_name, c.status.active)} body={c.people.confirm.restoreBody} confirmLabel={c.people.confirm.statusAction} onCancel={() => setPending(null)} onConfirm={() => act("PATCH", { status: "active" }, c.people.confirm.restoredDone)} />
      )}
      {pending?.kind === "delete" && m && (
        <ConfirmDialog title={c.people.confirm.deleteTitle(m.full_name)} body={c.people.confirm.deleteBody} confirmLabel={c.people.confirm.deleteAction} danger onCancel={() => setPending(null)} onConfirm={() => act("DELETE", undefined, c.people.confirm.deletedDone)} />
      )}
    </>
  );
}
