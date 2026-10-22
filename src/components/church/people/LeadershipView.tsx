"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarCheck, Crown, Pencil } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import type { ChurchCapabilities } from "@/lib/church/permissions";
import AppointmentFormDialog, { type Appointment } from "./AppointmentFormDialog";
import { Badge, BTN_PRIMARY, BTN_SECONDARY, ConfirmDialog, EmptyState, ErrorLine, ListSkeleton, NoticeBar, churchApi, errorText, formatDay, useNotice } from "./shared";

type Filter = "current" | "history" | "all";

// Who holds which title, with dates. Private to the church: nothing here is shown on the public page. An appointment is never deleted; it is ended, and stays in History.
export default function LeadershipView({ caps }: { caps: ChurchCapabilities }) {
  const { t, locale } = useLanguage();
  const c = t.churchPeople;
  const lp = c.leadership;
  const [filter, setFilter] = useState<Filter>("current");
  const [items, setItems] = useState<Appointment[] | null>(null);
  const [today, setToday] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [ending, setEnding] = useState<Appointment | null>(null);
  const { notice, show } = useNotice();

  const load = useCallback(async () => {
    setError("");
    const qs = filter === "current" ? "?current=true" : filter === "history" ? "?current=false" : "";
    const r = await churchApi<{ appointments: Appointment[]; today: string }>(`/api/church/leadership${qs}`);
    if (r.ok) {
      setItems(r.body.appointments);
      setToday(r.body.today);
    } else setError(errorText(c.errors, r.code));
  }, [filter, c.errors]);
  useEffect(() => {
    load();
  }, [load]);

  const changed = (message: string) => {
    show(message);
    load();
  };
  const anyHidden = !!items && items.some((a) => a.name === null);

  return (
    <div>
      <NoticeBar message={notice} />
      <p className="mb-4 text-sm text-ringo-muted">{lp.privateNote}</p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div role="group" aria-label={lp.filter} className="inline-flex rounded-full border border-ringo-border bg-ringo-surface p-1">
          {(["current", "history", "all"] as const).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={`min-h-[40px] rounded-full px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40 ${filter === f ? "bg-ringo-indigo text-white" : "text-ringo-muted hover:text-ringo-text"}`}
            >
              {lp[f]}
            </button>
          ))}
        </div>
        {caps.manageLeadership && (
          <button type="button" className={`${BTN_PRIMARY} ml-auto`} onClick={() => setCreating(true)}>
            <Crown size={16} aria-hidden="true" />
            {lp.add}
          </button>
        )}
      </div>

      {error ? (
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-ringo-coral/30 bg-ringo-coral/[0.05] p-4">
          <ErrorLine message={`${lp.loadError} ${error}`} />
          <button type="button" className={BTN_SECONDARY} onClick={load}>
            {c.common.retry}
          </button>
        </div>
      ) : !items ? (
        <ListSkeleton rows={4} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<CalendarCheck size={22} />}
          title={filter === "all" ? lp.emptyTitle : lp.emptyFilteredTitle}
          body={filter === "all" ? lp.emptyBody : undefined}
          action={
            caps.manageLeadership && filter === "all" ? (
              <button type="button" className={BTN_PRIMARY} onClick={() => setCreating(true)}>
                <Crown size={16} aria-hidden="true" />
                {lp.add}
              </button>
            ) : undefined
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((a) => (
            <li key={a.id} className="flex flex-col gap-3 rounded-2xl border border-ringo-border/70 bg-ringo-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ringo-text">{a.title}</p>
                <p className="truncate text-sm text-ringo-muted">{a.name ?? c.common.unnamed}</p>
                <p className="text-xs text-ringo-muted">{lp.period(a.started_on ? formatDay(a.started_on, locale) : null, a.ended_on ? formatDay(a.ended_on, locale) : null)}</p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Badge tone={a.is_current ? "current" : "ended"}>{a.is_current ? c.people.detail.current : c.people.detail.ended}</Badge>
                {caps.manageLeadership && (
                  <>
                    <button type="button" className={BTN_SECONDARY} onClick={() => setEditing(a)} aria-label={`${lp.edit}: ${a.title}`}>
                      <Pencil size={14} aria-hidden="true" />
                      {lp.edit}
                    </button>
                    {a.ended_on === null && (
                      <button type="button" className={BTN_SECONDARY} onClick={() => setEnding(a)}>
                        {lp.end}
                      </button>
                    )}
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {anyHidden && <p className="mt-3 text-xs text-ringo-muted">{lp.namesHidden}</p>}
      {!caps.manageLeadership && items && items.length > 0 && <p className="mt-3 text-xs text-ringo-muted">{lp.viewOnly}</p>}

      {creating && (
        <AppointmentFormDialog
          mode="create"
          onClose={() => setCreating(false)}
          onSaved={(message) => {
            setCreating(false);
            changed(message);
          }}
        />
      )}
      {editing && (
        <AppointmentFormDialog
          mode="edit"
          appointment={editing}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            changed(message);
          }}
        />
      )}
      {ending && (
        <ConfirmDialog
          title={lp.endTitle(ending.title, ending.name ?? c.common.unnamed)}
          body={lp.endBody}
          confirmLabel={lp.endAction}
          onCancel={() => setEnding(null)}
          onConfirm={async () => {
            // the end date is today in the church's calendar (Africa/Douala), as the server reports it
            const r = await churchApi(`/api/church/leadership/${ending.id}`, { method: "PATCH", body: { ended_on: today } });
            if (!r.ok) return errorText(c.errors, r.code);
            setEnding(null);
            changed(lp.ended);
            return "";
          }}
        />
      )}
    </div>
  );
}
