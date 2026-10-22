"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

// The cards customers paid for through the WhatsApp sales bot. Read-only for a team member with inbox.view; the owner and a team member with inbox.reply can mark an order completed once the
// card was delivered. Nothing is decided here: the button calls our own route, which asks the database, and the page only shows what came back (including whether the customer could really
// be thanked). The list itself was loaded on the server under row-level security for the organization the server resolved.

export type CardOrderStatus = "paid" | "completed";
export interface CardOrderRow {
  id: string;
  customer_name: string;
  customer_phone: string;
  card_tier: "standard" | "pro" | "premium" | null;
  amount_xaf: number | null;
  delivery_place: string | null;
  status: CardOrderStatus;
  customer_notify_status: "sent" | "window_closed" | "failed" | null;
  created_at: string;
  completed_at: string | null;
}
const GROUPS: CardOrderStatus[] = ["paid", "completed"];
const statusUrl = (id: string) => `/api/inbox/orders/${encodeURIComponent(id)}/status`;

function when(value: string | null, locale: string): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(locale === "fr" ? "fr-FR" : "en-GB", { timeZone: "Africa/Douala", dateStyle: "medium", timeStyle: "short" });
}

function Card({ row, canAct }: { row: CardOrderRow; canAct: boolean }) {
  const { t, locale } = useLanguage();
  const u = t.inbox.cardOrders;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const inFlight = useRef(false);

  async function complete() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(statusUrl(row.id), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "completed" }) });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; notified?: string; unchanged?: boolean } | null;
      if (res.ok && body?.ok) {
        if (body.unchanged) {
          // already completed (a double click or a retry): nothing was changed or sent, and no claim is made about the customer; the card below shows the stored outcome
          setNote({ kind: "ok", text: u.alreadyDone });
        } else {
          const key = (body.notified === "sent" || body.notified === "window_closed" || body.notified === "failed" ? body.notified : "none") as "sent" | "window_closed" | "failed" | "none";
          setNote({ kind: key === "sent" || key === "none" ? "ok" : "error", text: u.notified[key] });
        }
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

  const notifyKey = row.customer_notify_status ?? "none";
  return (
    <li className="rounded-card border border-ringo-border p-4" data-testid="card-order" data-status={row.status}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm font-medium text-ringo-text">{row.customer_name}</p>
        <a href={`https://wa.me/${row.customer_phone}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[36px] items-center rounded-full border border-ringo-border px-3 text-xs text-ringo-text hover:bg-ringo-surface">
          {u.contact}
        </a>
      </div>
      <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-[10rem_1fr]">
        {row.card_tier && (
          <>
            <dt className="text-ringo-muted">{u.card}</dt>
            <dd className="text-ringo-text" data-testid="card-order-card">{row.card_tier.charAt(0).toUpperCase() + row.card_tier.slice(1)}</dd>
          </>
        )}
        {typeof row.amount_xaf === "number" && (
          <>
            <dt className="text-ringo-muted">{u.amount}</dt>
            <dd className="text-ringo-text">{String(row.amount_xaf).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} FCFA</dd>
          </>
        )}
        <dt className="text-ringo-muted">{u.number}</dt>
        <dd className="text-ringo-text">+{row.customer_phone}</dd>
        {row.delivery_place && (
          <>
            <dt className="text-ringo-muted">{u.place}</dt>
            <dd className="text-ringo-text [overflow-wrap:anywhere]">{row.delivery_place}</dd>
          </>
        )}
        <dt className="text-ringo-muted">{u.paidOn}</dt>
        <dd className="text-ringo-text">{when(row.created_at, locale)}</dd>
        {row.completed_at && (
          <>
            <dt className="text-ringo-muted">{u.completedOn}</dt>
            <dd className="text-ringo-text">{when(row.completed_at, locale)}</dd>
          </>
        )}
      </dl>
      {row.status === "completed" && <p className="mt-2 text-xs text-ringo-muted">{u.notified[notifyKey]}</p>}

      {canAct && row.status === "paid" && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => void complete()} data-testid="card-order-complete" className="inline-flex min-h-[44px] items-center rounded-full bg-ringo-indigo px-5 text-sm font-medium text-white disabled:opacity-60">
            {busy ? u.working : u.complete}
          </button>
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

export default function OrdersView({ rows, canAct, loadFailed }: { rows: CardOrderRow[]; canAct: boolean; loadFailed: boolean }) {
  const { t } = useLanguage();
  const u = t.inbox.cardOrders;
  return (
    <div className="flex max-w-3xl flex-col gap-4" data-testid="card-orders-page">
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
            <section key={g} aria-labelledby={`order-${g}`} className="flex flex-col gap-2">
              <h2 id={`order-${g}`} className="text-sm font-medium text-ringo-text">
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
