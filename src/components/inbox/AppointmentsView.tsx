"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

// The meeting requests customers sent through the WhatsApp sales bot (Buy a card -> Meet a Ringo agent). Read-only for a team member with inbox.view; the owner and a team member with
// inbox.reply can confirm, decline or cancel. Nothing is decided here: every button calls our own route, which asks the database, and the page only shows what came back (including whether the
// customer could really be told). The list itself was loaded on the server under row-level security for the organization the server resolved.

export type AppointmentStatus = "pending" | "confirmed" | "declined" | "cancelled" | "completed";
export interface AppointmentRow {
  id: string;
  customer_name: string;
  customer_phone: string;
  preferred_time: string;
  meeting_place: string;
  note: string | null;
  status: AppointmentStatus;
  decision_details: string | null;
  customer_notify_status: "sent" | "window_closed" | "failed" | null;
  created_at: string;
  decided_at: string | null;
  lastActor: "owner" | "staff" | "customer" | null;
}
const GROUPS: AppointmentStatus[] = ["pending", "confirmed", "declined", "cancelled", "completed"];
const statusUrl = (id: string) => `/api/inbox/appointments/${encodeURIComponent(id)}/status`;

function when(value: string | null, locale: string): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(locale === "fr" ? "fr-FR" : "en-GB", { timeZone: "Africa/Douala", dateStyle: "medium", timeStyle: "short" });
}

function Card({ row, canAct }: { row: AppointmentRow; canAct: boolean }) {
  const { t, locale } = useLanguage();
  const u = t.inbox.appointments;
  const router = useRouter();
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const inFlight = useRef(false);

  async function change(to: "confirmed" | "declined" | "cancelled" | "completed") {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(statusUrl(row.id), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: to, details: details.trim() || undefined }) });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; notified?: string; unchanged?: boolean } | null;
      if (res.ok && body?.ok) {
        if (body.unchanged) {
          // already in that state (a double click or a retry): nothing was changed or sent, and no notification claim is made; the card below shows the stored outcome
          setNote({ kind: "ok", text: u.alreadyDone });
        } else if (to === "completed") {
          setNote(null);
        } else {
          const key = (body.notified === "sent" || body.notified === "window_closed" || body.notified === "failed" ? body.notified : "none") as "sent" | "window_closed" | "failed" | "none";
          setNote({ kind: key === "sent" || key === "none" ? "ok" : "error", text: u.notified[key] });
        }
        setDetails("");
        router.refresh();
      } else {
        const e = body?.error;
        setNote({ kind: "error", text: e === "forbidden" ? u.errors.forbidden : e === "invalid_transition" ? u.errors.invalid_transition : e === "not_found" ? u.errors.not_found : u.errors.failed });
      }
    } catch {
      setNote({ kind: "error", text: u.errors.failed });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const open = row.status === "pending" || row.status === "confirmed";
  const notifyKey = row.customer_notify_status ?? "none";
  return (
    <li className="rounded-card border border-ringo-border p-4" data-testid="appointment-card" data-status={row.status}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm font-medium text-ringo-text">{row.customer_name}</p>
        <a href={`https://wa.me/${row.customer_phone}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[36px] items-center rounded-full border border-ringo-border px-3 text-xs text-ringo-text hover:bg-ringo-surface">
          {u.contact}
        </a>
      </div>
      <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-[10rem_1fr]">
        <dt className="text-ringo-muted">{u.number}</dt>
        <dd className="text-ringo-text">+{row.customer_phone}</dd>
        <dt className="text-ringo-muted">{u.when}</dt>
        <dd className="text-ringo-text [overflow-wrap:anywhere]">{row.preferred_time}</dd>
        <dt className="text-ringo-muted">{u.where}</dt>
        <dd className="text-ringo-text [overflow-wrap:anywhere]">{row.meeting_place}</dd>
        {row.note && (
          <>
            <dt className="text-ringo-muted">{u.note}</dt>
            <dd className="text-ringo-text [overflow-wrap:anywhere]">{row.note}</dd>
          </>
        )}
        <dt className="text-ringo-muted">{u.received}</dt>
        <dd className="text-ringo-text">{when(row.created_at, locale)}</dd>
        {row.decided_at && (
          <>
            <dt className="text-ringo-muted">{u.decided}</dt>
            <dd className="text-ringo-text">
              {when(row.decided_at, locale)}
              {row.lastActor ? ` · ${u.by[row.lastActor]}` : ""}
            </dd>
          </>
        )}
        {row.decision_details && (
          <>
            <dt className="text-ringo-muted">{u.detailsLabel}</dt>
            <dd className="text-ringo-text [overflow-wrap:anywhere]">{row.decision_details}</dd>
          </>
        )}
      </dl>
      {(row.status === "confirmed" || row.status === "declined" || row.status === "cancelled") && <p className="mt-2 text-xs text-ringo-muted">{u.notified[notifyKey]}</p>}

      {canAct && open && (
        <div className="mt-3 flex flex-col gap-2">
          {row.status === "pending" && (
            <label className="flex flex-col gap-1 text-xs text-ringo-muted">
              {u.detailsLabel}
              <textarea
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                maxLength={300}
                rows={2}
                placeholder={u.detailsPlaceholder}
                className="rounded-md border border-ringo-border bg-transparent p-2 text-sm text-ringo-text"
              />
              <span>{u.detailsHelp}</span>
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            {row.status === "pending" && (
              <>
                <button type="button" disabled={busy} onClick={() => void change("confirmed")} data-testid="appointment-confirm" className="inline-flex min-h-[44px] items-center rounded-full bg-ringo-indigo px-5 text-sm font-medium text-white disabled:opacity-60">
                  {busy ? u.working : u.confirm}
                </button>
                <button type="button" disabled={busy} onClick={() => void change("declined")} data-testid="appointment-decline" className="inline-flex min-h-[44px] items-center rounded-full border border-ringo-border px-5 text-sm text-ringo-text disabled:opacity-60">
                  {u.decline}
                </button>
              </>
            )}
            {row.status === "confirmed" && (
              <button type="button" disabled={busy} onClick={() => void change("completed")} data-testid="appointment-complete" className="inline-flex min-h-[44px] items-center rounded-full bg-ringo-indigo px-5 text-sm font-medium text-white disabled:opacity-60">
                {busy ? u.working : u.complete}
              </button>
            )}
            <button type="button" disabled={busy} onClick={() => void change("cancelled")} data-testid="appointment-cancel" className="inline-flex min-h-[44px] items-center rounded-full border border-ringo-border px-5 text-sm text-ringo-text disabled:opacity-60">
              {u.cancel}
            </button>
          </div>
        </div>
      )}
      <div aria-live="polite" className="mt-2 min-h-[1.25rem] text-sm">
        {note && (
          <p role={note.kind === "error" ? "alert" : "status"} className={note.kind === "error" ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}>
            {note.text}
          </p>
        )}
      </div>
    </li>
  );
}

export default function AppointmentsView({ rows, canAct, loadFailed }: { rows: AppointmentRow[]; canAct: boolean; loadFailed: boolean }) {
  const { t } = useLanguage();
  const u = t.inbox.appointments;
  return (
    <div className="flex max-w-3xl flex-col gap-4" data-testid="appointments-page">
      <div>
        <Link href="/dashboard/inbox" className="mb-2 inline-flex items-center gap-1 text-xs text-ringo-muted hover:text-ringo-text">
          <ArrowLeft size={14} aria-hidden="true" />
          {u.back}
        </Link>
        <h1 className="font-display text-xl font-medium text-ringo-text">{u.title}</h1>
        <p className="mt-1 text-sm text-ringo-muted">{u.intro}</p>
        {!canAct && <p role="status" className="mt-2 rounded-card border border-ringo-border p-3 text-xs text-ringo-muted">{u.viewOnly}</p>}
      </div>
      {loadFailed ? (
        <p role="status" className="rounded-card border border-ringo-border p-3 text-sm text-ringo-muted">{u.loadFailed}</p>
      ) : rows.length === 0 ? (
        <p role="status" className="rounded-card border border-ringo-border p-3 text-sm text-ringo-muted">{u.empty}</p>
      ) : (
        GROUPS.map((g) => {
          const items = rows.filter((r) => r.status === g);
          if (items.length === 0) return null;
          return (
            <section key={g} aria-labelledby={`appt-${g}`} className="flex flex-col gap-2">
              <h2 id={`appt-${g}`} className="text-sm font-medium text-ringo-text">
                {u.groups[g]} ({items.length})
              </h2>
              <ul className="flex flex-col gap-3">
                {items.map((r) => (
                  <Card key={r.id} row={r} canAct={canAct} />
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
