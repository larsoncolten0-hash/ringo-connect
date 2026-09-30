"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Mail, MessageCircle, ExternalLink } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { normalizeSignupPhone } from "@/lib/signupPaymentClient";
import {
  applyFilters,
  summarize,
  DEFAULT_FILTERS,
  type FollowUpFilters,
  type FollowUpRow,
  type FollowUpStatus,
  type PwaFilter,
  type StageFilter,
  type StaffRow,
} from "@/lib/customerFollowUp";

const PAGE_SIZE = 100;

const inputCls =
  "h-10 w-full rounded-lg border border-ringo-border bg-ringo-surface px-3 text-sm text-ringo-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-ringo-indigo";

function whatsappHref(phone: string): string | null {
  const local = normalizeSignupPhone(phone);
  const digits = local ? `237${local}` : phone.replace(/[^0-9]/g, "");
  return digits.length >= 8 ? `https://wa.me/${digits}` : null;
}

function Badge({ tone, children }: { tone: "green" | "amber" | "red" | "gray" | "indigo"; children: React.ReactNode }) {
  const tones = {
    green: "bg-green-500/10 text-green-700 dark:text-green-400",
    amber: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    red: "bg-red-500/10 text-red-600 dark:text-red-400",
    gray: "bg-ringo-border/50 text-ringo-muted",
    indigo: "bg-ringo-indigo/10 text-ringo-indigo",
  } as const;
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}>{children}</span>;
}

export default function CustomerFollowUp({
  rows,
  staff,
  workflowAvailable,
}: {
  rows: FollowUpRow[];
  staff: StaffRow[];
  workflowAvailable: boolean;
}) {
  const { t, locale } = useLanguage();
  const c = t.adminFollowUp;
  const [filters, setFilters] = useState<FollowUpFilters>(DEFAULT_FILTERS);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [open, setOpen] = useState<string | null>(null);
  // Saved follow-ups are applied locally right away so the table reflects them without a reload.
  const [saved, setSaved] = useState<Record<string, FollowUpRow["followUp"]>>({});

  const merged = useMemo(() => rows.map((r) => (r.key in saved ? { ...r, followUp: saved[r.key] } : r)), [rows, saved]);
  const summary = useMemo(() => summarize(merged), [merged]);
  const filtered = useMemo(() => applyFilters(merged, filters), [merged, filters]);

  const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" }) : "—");
  const set = (patch: Partial<FollowUpFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setVisible(PAGE_SIZE);
  };

  const cards: [string, number, boolean][] = [
    [c.summary.total, summary.total, false],
    [c.summary.awaitingPayment, summary.awaitingPayment, false],
    [c.summary.paidNotActivated, summary.paidNotActivated, summary.paidNotActivated > 0],
    [c.summary.awaitingApproval, summary.awaitingApproval, false],
    [c.summary.activeAccounts, summary.activeAccounts, false],
    [c.summary.activeSubscriptions, summary.activeSubscriptions, false],
    [c.summary.expiredSubscriptions, summary.expiredSubscriptions, false],
    [c.summary.pwaInstalled, summary.pwaInstalled, false],
    [c.summary.pwaNoneConfirmed, summary.pwaNoneConfirmed, false],
    [c.summary.pwaUnknown, summary.pwaUnknown, false],
    [c.summary.pushSubscribed, summary.pushSubscribed, false],
    [c.summary.unassigned, summary.unassigned, summary.unassigned > 0],
    [c.summary.needsFollowUp, summary.needsFollowUp, summary.needsFollowUp > 0],
  ];

  const accountTone = (s: FollowUpRow["accountStatus"]) => (s === "active" ? "green" : s === "awaiting_approval" ? "amber" : s === "no_account" ? "gray" : "red");
  const paymentTone = (s: FollowUpRow["paymentStatus"]) => (s === "paid" ? "green" : s === "not_required" || s === "unknown" || s === "not_recorded" ? "gray" : "amber");
  const subTone = (s: FollowUpRow["subscriptionStatus"]) => (s === "active" ? "green" : s === "expired" ? "red" : "gray");
  const pwaTone = (s: FollowUpRow["pwa"]) => (s === "installed" ? "green" : "gray");

  function attributionText(r: FollowUpRow): string {
    const a = r.attribution;
    if (a.kind === "unassigned") return c.attribution.unassigned;
    if (a.kind === "affiliate") return `${c.attribution.affiliate}: ${a.affiliateName}`;
    return `${c.attribution.ambassador}: ${a.ambassadorName}${a.teamLeaderName ? ` · ${c.attribution.teamLeader}: ${a.teamLeaderName}` : ""}`;
  }

  const followUpLabel = (r: FollowUpRow) => (r.followUp ? c.followUp[r.followUp.status] : c.followUp.none);

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ringo-text">{c.title}</h1>
        <p className="mt-1 text-sm text-ringo-muted">{c.subtitle}</p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7">
        {cards.map(([label, value, attention]) => (
          <div key={label} className={`rounded-xl border p-3 ${attention ? "border-amber-500/40 bg-amber-500/5" : "border-ringo-border bg-ringo-surface"}`}>
            <p className="text-2xl font-semibold text-ringo-text">{value}</p>
            <p className="mt-0.5 text-xs text-ringo-muted">{label}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-ringo-muted">{c.pwaNote}</p>

      {!workflowAvailable && <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-ringo-text">{c.followUp.unavailable}</p>}

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="text-xs text-ringo-muted lg:col-span-2">
          {c.filters.search}
          <input className={`${inputCls} mt-1`} type="search" value={filters.q} placeholder={c.filters.searchPlaceholder} onChange={(e) => set({ q: e.target.value })} />
        </label>
        <label className="text-xs text-ringo-muted">
          {c.filters.stage}
          <select className={`${inputCls} mt-1`} value={filters.stage} onChange={(e) => set({ stage: e.target.value as StageFilter })}>
            {(Object.keys(c.filters.stages) as StageFilter[]).map((k) => (
              <option key={k} value={k}>{c.filters.stages[k]}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-ringo-muted">
          {c.filters.pwa}
          <select className={`${inputCls} mt-1`} value={filters.pwa} onChange={(e) => set({ pwa: e.target.value as PwaFilter })}>
            {(Object.keys(c.filters.pwaOptions) as PwaFilter[]).map((k) => (
              <option key={k} value={k}>{c.filters.pwaOptions[k]}</option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-ringo-muted">
            {c.filters.from}
            <input className={`${inputCls} mt-1 px-2`} type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} />
          </label>
          <label className="text-xs text-ringo-muted">
            {c.filters.to}
            <input className={`${inputCls} mt-1 px-2`} type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} />
          </label>
        </div>
      </section>
      <div className="flex items-center justify-between text-xs text-ringo-muted">
        <span>{c.showing.replace("{shown}", String(Math.min(visible, filtered.length))).replace("{total}", String(filtered.length))}</span>
        <button type="button" className="rounded-md px-2 py-1 underline underline-offset-2 hover:text-ringo-text" onClick={() => { setFilters(DEFAULT_FILTERS); setVisible(PAGE_SIZE); }}>
          {c.filters.reset}
        </button>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-ringo-border bg-ringo-surface p-6 text-center text-sm text-ringo-muted">{c.empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-ringo-border bg-ringo-surface">
          <table className="min-w-[1100px] w-full text-left text-sm">
            <thead className="border-b border-ringo-border text-xs text-ringo-muted">
              <tr>
                <th className="w-8 px-2 py-2" />
                {[c.columns.customer, c.columns.contact, c.columns.registered, c.columns.account, c.columns.payment, c.columns.subscription, c.columns.app, c.columns.lastSeen, c.columns.source, c.columns.referredBy, c.columns.followUp].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, visible).map((r) => {
                const isOpen = open === r.key;
                return (
                  <RowGroup key={r.key}>
                    <tr className="border-b border-ringo-border/60 align-top">
                      <td className="px-2 py-2">
                        <button type="button" aria-label={c.details.toggle} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.key)} className="flex h-8 w-8 items-center justify-center rounded-md text-ringo-muted hover:bg-ringo-border/40">
                          {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </button>
                      </td>
                      <td className="px-3 py-2 font-medium text-ringo-text">{r.name || c.noName}</td>
                      <td className="px-3 py-2 text-xs text-ringo-muted">
                        <div>{r.email || "—"}</div>
                        <div>{r.phone || "—"}</div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-ringo-muted">{fmtDate(r.registeredAt)}</td>
                      <td className="px-3 py-2"><Badge tone={accountTone(r.accountStatus)}>{c.account[r.accountStatus]}</Badge></td>
                      <td className="px-3 py-2"><Badge tone={paymentTone(r.paymentStatus)}>{c.payment[r.paymentStatus]}</Badge></td>
                      <td className="px-3 py-2">
                        <Badge tone={subTone(r.subscriptionStatus)}>{c.subscription[r.subscriptionStatus]}</Badge>
                        {r.planName && r.subscriptionStatus !== "none" && <div className="mt-0.5 text-[11px] text-ringo-muted">{r.planName}</div>}
                      </td>
                      <td className="px-3 py-2"><Badge tone={pwaTone(r.pwa)}>{c.pwa[r.pwa]}</Badge></td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-ringo-muted">{r.lastSeenAt ? fmtDate(r.lastSeenAt) : "—"}</td>
                      <td className="px-3 py-2 text-xs text-ringo-muted">{c.source[r.registrationSource]}</td>
                      <td className="px-3 py-2 text-xs">
                        {r.attribution.kind === "unassigned" ? <Badge tone="amber">{c.attribution.unassigned}</Badge> : <span className="text-ringo-text">{attributionText(r)}</span>}
                      </td>
                      <td className="px-3 py-2"><Badge tone={r.followUp?.status === "needs_follow_up" ? "amber" : r.followUp ? "green" : "gray"}>{followUpLabel(r)}</Badge></td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-ringo-border/60 bg-ringo-border/10">
                        <td />
                        <td colSpan={11} className="px-3 py-4">
                          <Details r={r} c={c} staff={staff} workflowAvailable={workflowAvailable} fmtDate={fmtDate} attributionText={attributionText(r)} onSaved={(fu) => setSaved((s) => ({ ...s, [r.key]: fu }))} />
                        </td>
                      </tr>
                    )}
                  </RowGroup>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {visible < filtered.length && (
        <div className="text-center">
          <button type="button" className="h-10 rounded-lg border border-ringo-border px-4 text-sm text-ringo-text hover:bg-ringo-border/30" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
            {c.showMore}
          </button>
        </div>
      )}
    </div>
  );
}

function RowGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function Details({
  r,
  c,
  staff,
  workflowAvailable,
  fmtDate,
  attributionText,
  onSaved,
}: {
  r: FollowUpRow;
  c: ReturnType<typeof useLanguage>["t"]["adminFollowUp"];
  staff: StaffRow[];
  workflowAvailable: boolean;
  fmtDate: (iso: string | null) => string;
  attributionText: string;
  onSaved: (fu: FollowUpRow["followUp"]) => void;
}) {
  const [status, setStatus] = useState<FollowUpStatus>(r.followUp?.status ?? "needs_follow_up");
  const [date, setDate] = useState(r.followUp?.date ?? "");
  const [assignee, setAssignee] = useState(r.followUp?.assigneeId ?? "");
  const [note, setNote] = useState(r.followUp?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const wa = r.phone ? whatsappHref(r.phone) : null;
  const a = r.attribution;

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/follow-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectType: r.subjectType, subjectId: r.subjectId, status, followUpDate: date || null, assignedTo: assignee || null, note: note || null }),
      });
      if (!res.ok) throw new Error(String(res.status));
      onSaved({ status, date: date || null, assigneeId: assignee || null, assigneeLabel: staff.find((s) => s.id === assignee)?.email ?? null, note: note.trim() || null });
      setMessage(c.followUp.saved);
    } catch {
      setMessage(c.followUp.saveFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1.5 text-xs">
        <dt className="text-ringo-muted">{c.details.plan}</dt>
        <dd className="text-ringo-text">{r.planName ?? "—"}</dd>
        <dt className="text-ringo-muted">{c.details.expires}</dt>
        <dd className="text-ringo-text">{fmtDate(r.planExpiresAt)}</dd>
        <dt className="text-ringo-muted">{c.details.appStatus}</dt>
        <dd className="text-ringo-text">{c.pwaReasons[r.pwaReason]}</dd>
        <dt className="text-ringo-muted">{c.details.push}</dt>
        <dd className="text-ringo-text">{r.pushSubscribed ? c.details.pushOn : c.details.pushOff}</dd>
        <dt className="text-ringo-muted">{c.columns.lastSeen}</dt>
        <dd className="text-ringo-text">{r.lastSeenAt ? fmtDate(r.lastSeenAt) : c.details.never}</dd>
        <dt className="text-ringo-muted">{c.columns.source}</dt>
        <dd className="text-ringo-text">{c.source[r.registrationSource]}</dd>
        <dt className="text-ringo-muted">{c.details.attribution}</dt>
        <dd className="text-ringo-text">
          {attributionText}
          {a.kind === "ambassador" && (
            <>
              {a.teamName && <div>{c.attribution.team}: {a.teamName}</div>}
              <div>{c.details.attributedVia}: {a.via === "sale" ? c.attribution.viaSale : c.attribution.viaCode}</div>
            </>
          )}
        </dd>
        <dt className="text-ringo-muted">{c.followUp.noteLabel}</dt>
        <dd className="whitespace-pre-wrap text-ringo-text">{r.followUp?.note ?? "—"}</dd>
        <dt />
        <dd className="mt-2 flex flex-wrap gap-2">
          {r.email && (
            <a href={`mailto:${r.email}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-ringo-border px-3 text-xs text-ringo-text hover:bg-ringo-border/30">
              <Mail size={14} /> {c.actions.email}
            </a>
          )}
          {wa && (
            <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-ringo-border px-3 text-xs text-ringo-text hover:bg-ringo-border/30">
              <MessageCircle size={14} /> {c.actions.whatsapp}
            </a>
          )}
          {r.subjectType === "request" && (
            <Link href={`/admin/requests/${r.subjectId}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-ringo-border px-3 text-xs text-ringo-text hover:bg-ringo-border/30">
              <ExternalLink size={14} /> {c.actions.openRequest}
            </Link>
          )}
        </dd>
        <dt />
        <dd className="text-[11px] text-ringo-muted">{c.actions.note}</dd>
      </dl>

      {workflowAvailable && (
        <div className="grid gap-3 text-xs sm:grid-cols-2">
          <label className="text-ringo-muted">
            {c.followUp.statusLabel}
            <select className={`${inputCls} mt-1`} value={status} onChange={(e) => setStatus(e.target.value as FollowUpStatus)}>
              <option value="needs_follow_up">{c.followUp.needs_follow_up}</option>
              <option value="completed">{c.followUp.completed}</option>
            </select>
          </label>
          <label className="text-ringo-muted">
            {c.followUp.dateLabel}
            <input className={`${inputCls} mt-1`} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="text-ringo-muted sm:col-span-2">
            {c.followUp.assigneeLabel}
            <select className={`${inputCls} mt-1`} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">{c.followUp.unassignedStaff}</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>{s.email}</option>
              ))}
            </select>
          </label>
          <label className="text-ringo-muted sm:col-span-2">
            {c.followUp.noteLabel}
            <textarea className={`${inputCls} mt-1 h-20 py-2`} maxLength={500} value={note} placeholder={c.followUp.notePlaceholder} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="flex items-center gap-3 sm:col-span-2">
            <button type="button" disabled={busy} onClick={save} className="h-10 rounded-lg bg-ringo-indigo px-4 text-sm font-semibold text-white disabled:opacity-60">
              {busy ? c.followUp.saving : c.followUp.save}
            </button>
            {message && <span role="status" className="text-ringo-muted">{message}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
