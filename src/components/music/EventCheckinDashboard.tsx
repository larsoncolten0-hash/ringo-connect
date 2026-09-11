"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, QrCode, Plus, Copy, Check, Ban, DoorOpen, LogOut, Users, Clock, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLanguage } from "@/components/LanguageProvider";
import ImageUploadField from "@/components/editor/ImageUploadField";
import EventTicketTypesEditor from "@/components/editor/EventTicketTypesEditor";

// Gate Access + Check-in — organizer-facing. Scanner session rows are
// created/deactivated straight against scanner_sessions via the regular
// (RLS-protected) client, same "owner write" pattern every other editor
// card already uses — the token itself is generated server-side by
// set_scanner_session_token() the moment the row is inserted, never
// something this component invents. See EventScannerView.tsx for what a
// security officer actually sees once they open the link this page
// produces — never this dashboard, never anything on it.
export default function EventCheckinDashboard({
  event,
  userId,
  ticketTypes,
  initialScannerSessions,
  digitalTickets,
  checkinLogs,
  currency,
}: {
  event: any;
  userId: string;
  ticketTypes: any[];
  initialScannerSessions: any[];
  digitalTickets: { id: string; ticket_type_id: string | null; status: string; entry_state: string }[];
  checkinLogs: any[];
  currency: string;
}) {
  const supabase = createClient();
  const router = useRouter();
  const { t, locale } = useLanguage();

  // Basics — the fields EventRow used to own before Tickets got its own
  // dashboard section. Local state + onBlur persistence, same pattern as
  // every other editor field in this codebase, just flattened: there's no
  // parent list to bubble a patch up to anymore, this page IS the event.
  const [fields, setFields] = useState({
    title: event.title || "",
    location: event.location || "",
    event_date: event.event_date || "",
    event_time: event.event_time || "",
    cover_image_url: event.cover_image_url || "",
    price: event.price ?? "",
    ticket_type: event.ticket_type || "",
    ticket_capacity: event.ticket_capacity ?? "",
    ticket_url: event.ticket_url || "",
    max_tickets_per_customer: event.max_tickets_per_customer ?? "",
    status: event.status || "published",
  });
  const [ticketTypesState, setTicketTypesState] = useState(ticketTypes);
  const [deleting, setDeleting] = useState(false);

  const patchField = (key: keyof typeof fields, value: any) => setFields((prev) => ({ ...prev, [key]: value }));
  const persistField = async (key: string, value: any) => {
    await supabase.from("events").update({ [key]: value }).eq("id", event.id);
  };

  const deleteEvent = async () => {
    setDeleting(true);
    await supabase.from("events").delete().eq("id", event.id);
    router.push("/dashboard/tickets");
  };

  const [entryPolicy, setEntryPolicy] = useState(event.entry_policy || "single_entry");
  const [requireId, setRequireId] = useState(!!event.require_id_verification);
  const [sessions, setSessions] = useState(initialScannerSessions);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [gateName, setGateName] = useState("");
  const [scannerType, setScannerType] = useState<"entry" | "exit">("entry");
  const [permissionLevel, setPermissionLevel] = useState<"scanner" | "supervisor">("scanner");
  const [expiresAt, setExpiresAt] = useState(() => {
    // Defaults to the event's own date (end of that day) when set, else
    // 24h out — always proposes *something* rather than "never expires",
    // per "automatically expire based on event configuration".
    const base = event.event_date ? new Date(`${event.event_date}T23:59:00`) : new Date(Date.now() + 24 * 3600 * 1000);
    return base.toISOString().slice(0, 16);
  });
  const [creating, setCreating] = useState(false);

  const updateEvent = async (patch: any) => {
    await supabase.from("events").update(patch).eq("id", event.id);
  };

  const createScanner = async () => {
    if (!gateName.trim()) return;
    setCreating(true);
    const { data } = await supabase
      .from("scanner_sessions")
      .insert({
        event_id: event.id,
        profile_id: event.profile_id,
        gate_name: gateName.trim(),
        scanner_type: scannerType,
        permission_level: permissionLevel,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
      })
      .select()
      .single();
    setCreating(false);
    if (data) {
      setSessions((prev) => [data, ...prev]);
      setGateName("");
      setShowCreate(false);
    }
  };

  const deactivateScanner = async (id: string) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, is_active: false, revoked_at: new Date().toISOString() } : s)));
    await supabase.from("scanner_sessions").update({ is_active: false, revoked_at: new Date().toISOString() }).eq("id", id);
  };

  const copyLink = (session: any) => {
    const url = `${window.location.origin}/scanner/${session.token}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(session.id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  // Live stats — real digital_tickets rows only, no fabricated numbers.
  // entry_state (not status) is the authority on admission (see the
  // migration's own header on why the two are separate for re-entry).
  const stats = useMemo(() => {
    const live = digitalTickets.filter((d) => d.status !== "cancelled" && d.status !== "refunded");
    const checkedIn = live.filter((d) => d.entry_state !== "not_checked_in").length;
    const inside = live.filter((d) => d.entry_state === "inside").length;
    const outside = live.filter((d) => d.entry_state === "outside").length;
    return {
      sold: digitalTickets.length,
      checkedIn,
      inside,
      outside,
      notYetCheckedIn: live.length - checkedIn,
    };
  }, [digitalTickets]);

  const byTicketType = useMemo(() => {
    const groups = new Map<string, { name: string; sold: number; checkedIn: number; inside: number }>();
    for (const d of digitalTickets) {
      if (d.status === "cancelled" || d.status === "refunded") continue;
      const key = d.ticket_type_id || "__legacy__";
      const name = ticketTypesState.find((tt) => tt.id === d.ticket_type_id)?.name || t.music.ticketTypeLegacyLabel;
      const g = groups.get(key) || { name, sold: 0, checkedIn: 0, inside: 0 };
      g.sold += 1;
      if (d.entry_state !== "not_checked_in") g.checkedIn += 1;
      if (d.entry_state === "inside") g.inside += 1;
      groups.set(key, g);
    }
    return Array.from(groups.values());
  }, [digitalTickets, ticketTypesState, t]);

  const byGate = useMemo(() => {
    const tally = new Map<string, number>();
    for (const log of checkinLogs) {
      if (log.result !== "approved" || log.direction !== "entry") continue;
      tally.set(log.gate_name, (tally.get(log.gate_name) || 0) + 1);
    }
    return Array.from(tally.entries()).sort((a, b) => b[1] - a[1]);
  }, [checkinLogs]);

  const now = Date.now();

  return (
    <div className="max-w-2xl flex flex-col gap-6">
      <Link href="/dashboard/tickets" className="flex items-center gap-1.5 text-sm text-ringo-muted w-fit">
        <ArrowLeft size={15} />
        {t.music.backToTicketsList}
      </Link>

      <div>
        <h1 className="font-display text-xl font-bold text-ringo-text">{fields.title || t.music.untitledEvent}</h1>
        <p className="text-sm text-ringo-muted">{t.music.checkinPageSubtitle}</p>
      </div>

      {/* Basics — title/cover/location/date/time, same fields EventRow
          used to own before Tickets got its own dashboard section. */}
      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-4 flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <ImageUploadField
            value={fields.cover_image_url}
            onChange={(url) => {
              patchField("cover_image_url", url || "");
              persistField("cover_image_url", url || null);
            }}
            userId={userId}
            folder="events"
            size={56}
            errorText={t.editor.upload}
          />
          <input
            value={fields.title}
            onChange={(e) => patchField("title", e.target.value)}
            onBlur={(e) => persistField("title", e.target.value)}
            placeholder={t.music.eventTitlePlaceholder}
            className="flex-1 min-w-0 text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-bg text-ringo-text"
          />
        </div>
        <input
          value={fields.location}
          onChange={(e) => patchField("location", e.target.value)}
          onBlur={(e) => persistField("location", e.target.value)}
          placeholder={t.music.locationPlaceholder}
          className="w-full text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-bg text-ringo-text"
        />
        <div className="flex gap-2">
          <input
            type="date"
            value={fields.event_date}
            onChange={(e) => patchField("event_date", e.target.value)}
            onBlur={(e) => persistField("event_date", e.target.value || null)}
            className="flex-1 min-w-0 text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-bg text-ringo-text"
          />
          <input
            value={fields.event_time}
            onChange={(e) => patchField("event_time", e.target.value)}
            onBlur={(e) => persistField("event_time", e.target.value)}
            placeholder={t.music.timePlaceholder}
            className="w-32 text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-bg text-ringo-text"
          />
        </div>
      </div>

      {/* Entry policy + ID verification — event-wide settings the scanner
          and checkin_ticket() both read server-side. */}
      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-4 flex flex-col gap-3">
        <div className="flex gap-2">
          <label className="flex-1 flex flex-col gap-1">
            <span className="text-xs font-medium text-ringo-muted">{t.music.eventStatusLabel}</span>
            <select
              value={fields.status}
              onChange={(e) => {
                patchField("status", e.target.value);
                persistField("status", e.target.value);
              }}
              className="text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-bg text-ringo-text"
            >
              <option value="draft">{t.music.eventStatusDraft}</option>
              <option value="published">{t.music.eventStatusPublished}</option>
              <option value="cancelled">{t.music.eventStatusCancelled}</option>
              <option value="completed">{t.music.eventStatusCompleted}</option>
            </select>
          </label>
          <label className="flex-1 flex flex-col gap-1">
            <span className="text-xs font-medium text-ringo-muted">{t.music.maxTicketsPerCustomerLabel}</span>
            <input
              value={fields.max_tickets_per_customer}
              onChange={(e) => patchField("max_tickets_per_customer", e.target.value.replace(/[^0-9]/g, ""))}
              onBlur={(e) => persistField("max_tickets_per_customer", e.target.value ? Number(e.target.value) : null)}
              placeholder={t.music.maxTicketsPerCustomerPlaceholder}
              inputMode="numeric"
              className="text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-bg text-ringo-text"
            />
          </label>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-ringo-muted">{t.music.entryPolicyLabel}</span>
          <select
            value={entryPolicy}
            onChange={(e) => {
              setEntryPolicy(e.target.value);
              updateEvent({ entry_policy: e.target.value });
            }}
            className="text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-bg text-ringo-text w-fit"
          >
            <option value="single_entry">{t.music.entryPolicySingle}</option>
            <option value="re_entry_allowed">{t.music.entryPolicyReEntry}</option>
            <option value="unlimited_re_entry">{t.music.entryPolicyUnlimited}</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-ringo-text">
          <input
            type="checkbox"
            checked={requireId}
            onChange={(e) => {
              setRequireId(e.target.checked);
              updateEvent({ require_id_verification: e.target.checked });
            }}
          />
          {t.music.requireIdVerificationLabel}
        </label>
      </div>

      {/* Ticket Types — unlimited custom tiers (Standard/VIP/etc). An
          event with none of these keeps using the legacy single-price
          fields below instead (see EventTicketTypesEditor's own hint). */}
      <EventTicketTypesEditor
        eventId={event.id}
        ticketTypes={ticketTypesState}
        currency={currency}
        onChange={setTicketTypesState}
      />

      {/* Legacy single ticket price/link — superseded the moment any
          ticket type above exists, kept for an event that doesn't use
          tiers at all (see checkinPageSubtitle's own reasoning in
          ItemDetailPage.tsx/MusicStorePage.tsx). */}
      <div className="rounded-card border border-dashed border-ringo-border p-3 flex flex-col gap-2">
        <p className="text-xs font-medium text-ringo-text">{t.music.sellTicketsTitle}</p>
        <p className="text-xs text-ringo-muted -mt-1">
          {ticketTypesState.length > 0 ? t.music.sellTicketsSupersededHint : t.music.sellTicketsHint}
        </p>
        <div className="flex gap-2">
          <input
            value={fields.price}
            onChange={(e) => patchField("price", e.target.value.replace(/[^0-9.]/g, ""))}
            onBlur={(e) => persistField("price", e.target.value ? Number(e.target.value) : null)}
            placeholder={t.restaurant.itemPricePlaceholder}
            inputMode="decimal"
            className="w-24 text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-bg text-ringo-text"
          />
          <input
            value={fields.ticket_type}
            onChange={(e) => patchField("ticket_type", e.target.value)}
            onBlur={(e) => persistField("ticket_type", e.target.value)}
            placeholder={t.music.ticketTypePlaceholder}
            className="flex-1 min-w-0 text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-bg text-ringo-text"
          />
          <input
            value={fields.ticket_capacity}
            onChange={(e) => patchField("ticket_capacity", e.target.value.replace(/[^0-9]/g, ""))}
            onBlur={(e) => persistField("ticket_capacity", e.target.value ? Number(e.target.value) : null)}
            placeholder={t.music.ticketCapacityPlaceholder}
            inputMode="numeric"
            className="w-24 text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-bg text-ringo-text"
          />
        </div>
        {event.ticket_capacity != null && (
          <p className="text-xs text-ringo-muted">
            {t.music.ticketsSoldLabel}: {event.tickets_sold || 0} / {event.ticket_capacity}
          </p>
        )}
        <input
          value={fields.ticket_url}
          onChange={(e) => patchField("ticket_url", e.target.value)}
          onBlur={(e) => persistField("ticket_url", e.target.value)}
          placeholder={t.music.ticketUrlPlaceholder}
          inputMode="url"
          className="w-full text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-bg text-ringo-text"
        />
      </div>

      {/* Live check-in stats — real digital_tickets counts only. */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: t.music.statTicketsSold, value: stats.sold },
          { label: t.music.statCheckedIn, value: stats.checkedIn },
          { label: t.music.statCurrentlyInside, value: stats.inside },
          { label: t.music.statCurrentlyOutside, value: stats.outside },
          { label: t.music.statNotYetCheckedIn, value: stats.notYetCheckedIn },
        ].map((s) => (
          <div key={s.label} className="rounded-card border border-ringo-border/70 bg-ringo-surface p-3">
            <p className="text-[11px] text-ringo-muted mb-1">{s.label}</p>
            <p className="text-lg font-bold text-ringo-text tabular-nums">{s.value}</p>
          </div>
        ))}
      </div>

      {byTicketType.length > 0 && (
        <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-4">
          <h2 className="text-sm font-medium text-ringo-text mb-3">{t.music.checkinByTicketTypeHeading}</h2>
          <div className="flex flex-col gap-2">
            {byTicketType.map((g) => (
              <div key={g.name} className="flex items-center justify-between text-sm">
                <span className="text-ringo-text">{g.name}</span>
                <span className="text-ringo-muted tabular-nums">
                  {t.music.statCheckedIn}: {g.checkedIn}/{g.sold} · {t.music.statCurrentlyInside}: {g.inside}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {byGate.length > 0 && (
        <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-4">
          <h2 className="text-sm font-medium text-ringo-text mb-3">{t.music.gatesHeading}</h2>
          <div className="flex flex-col gap-2">
            {byGate.map(([gate, count]) => (
              <div key={gate} className="flex items-center justify-between text-sm">
                <span className="text-ringo-text">{gate}</span>
                <span className="text-ringo-muted tabular-nums">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Gate Access — create/manage scanner sessions. */}
      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-ringo-text">{t.music.gateAccessHeading}</h2>
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="text-xs px-3 py-1.5 rounded-card bg-ringo-indigo text-white flex items-center gap-1"
          >
            <Plus size={13} />
            {t.music.createScannerButton}
          </button>
        </div>

        {showCreate && (
          <div className="rounded-card border border-dashed border-ringo-border p-3 flex flex-col gap-2">
            <input
              value={gateName}
              onChange={(e) => setGateName(e.target.value)}
              placeholder={t.music.gateNamePlaceholder}
              className="text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-bg text-ringo-text"
            />
            <div className="flex gap-2">
              <select
                value={scannerType}
                onChange={(e) => setScannerType(e.target.value as "entry" | "exit")}
                className="flex-1 text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-bg text-ringo-text"
              >
                <option value="entry">{t.music.scannerTypeEntry}</option>
                <option value="exit">{t.music.scannerTypeExit}</option>
              </select>
              <select
                value={permissionLevel}
                onChange={(e) => setPermissionLevel(e.target.value as "scanner" | "supervisor")}
                className="flex-1 text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-bg text-ringo-text"
              >
                <option value="scanner">{t.music.permissionScanner}</option>
                <option value="supervisor">{t.music.permissionSupervisor}</option>
              </select>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-ringo-muted">{t.music.scannerExpiresLabel}</span>
              <input
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-bg text-ringo-text"
              />
            </label>
            <button
              onClick={createScanner}
              disabled={creating || !gateName.trim()}
              className="self-start text-xs font-semibold px-3.5 py-2 rounded-card bg-ringo-indigo text-white disabled:opacity-50"
            >
              {creating ? t.music.creatingScanner : t.music.createScannerButton}
            </button>
          </div>
        )}

        {sessions.length === 0 && <p className="text-sm text-ringo-muted">{t.music.noScannersYet}</p>}

        <div className="flex flex-col gap-2">
          {sessions.map((s) => {
            const expired = s.expires_at && new Date(s.expires_at).getTime() < now;
            const statusLabel = !s.is_active ? t.music.scannerStatusRevoked : expired ? t.music.scannerStatusExpired : t.music.scannerStatusActive;
            const statusColor = !s.is_active || expired ? "#6B7280" : "#16A34A";
            const gateCount = checkinLogs.filter((l) => l.scanner_session_id === s.id && l.result === "approved").length;

            return (
              <div key={s.id} className="rounded-card border border-ringo-border p-3 flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-ringo-text flex items-center gap-1.5">
                    {s.scanner_type === "exit" ? <LogOut size={13} /> : <DoorOpen size={13} />}
                    {s.gate_name}
                    {s.permission_level === "supervisor" && (
                      <span className="text-[10px] font-normal px-1.5 py-0.5 rounded-full bg-ringo-indigo/10 text-ringo-indigo">
                        {t.music.permissionSupervisor}
                      </span>
                    )}
                  </p>
                  <span className="text-[11px] font-semibold" style={{ color: statusColor }}>
                    {statusLabel}
                  </span>
                </div>
                <p className="text-xs text-ringo-muted flex items-center gap-1.5">
                  <Users size={11} />
                  {gateCount} {t.music.ticketTypeSoldLabel}
                  {s.expires_at && (
                    <>
                      <Clock size={11} className="ml-2" />
                      {new Date(s.expires_at).toLocaleString(locale === "fr" ? "fr-FR" : "en-US")}
                    </>
                  )}
                </p>
                {s.is_active && !expired && (
                  <div className="flex gap-2 mt-1">
                    <button
                      onClick={() => copyLink(s)}
                      className="flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-card border border-ringo-border text-ringo-text"
                    >
                      {copiedId === s.id ? <Check size={12} /> : <Copy size={12} />}
                      {copiedId === s.id ? t.music.linkCopiedLabel : t.music.copyScannerLink}
                    </button>
                    <button
                      onClick={() => deactivateScanner(s.id)}
                      className="flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-card border border-red-500/30 text-red-500"
                    >
                      <Ban size={12} />
                      {t.music.deactivateScannerButton}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Live scan history — last 50, most recent first. */}
      {checkinLogs.length > 0 && (
        <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-4">
          <h2 className="text-sm font-medium text-ringo-text mb-3 flex items-center gap-1.5">
            <QrCode size={14} />
            {t.music.scanHistoryHeading}
          </h2>
          <div className="flex flex-col gap-1.5 max-h-96 overflow-y-auto">
            {checkinLogs.slice(0, 50).map((log) => (
              <div key={log.id} className="flex items-center justify-between text-xs py-1.5 border-b border-ringo-border/40 last:border-0">
                <span className="text-ringo-muted shrink-0 w-14">
                  {new Date(log.created_at).toLocaleTimeString(locale === "fr" ? "fr-FR" : "en-US", { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="text-ringo-text flex-1 min-w-0 truncate px-2">
                  {log.ticket_type_name || "—"} · {log.ticket_holder_name || "—"}
                </span>
                <span className="text-ringo-muted shrink-0">{log.gate_name}</span>
                <span
                  className="shrink-0 ml-2 font-semibold uppercase"
                  style={{ color: log.result === "approved" ? "#16A34A" : log.result.includes("already") ? "#EA580C" : "#DC2626" }}
                >
                  {log.direction === "exit" ? t.music.logDirectionExit : t.music.logDirectionEntry}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={() => {
          if (window.confirm(t.music.deleteEventConfirm)) deleteEvent();
        }}
        disabled={deleting}
        className="self-start flex items-center gap-1.5 text-xs font-medium text-red-500 px-1 py-1 disabled:opacity-50"
      >
        <Trash2 size={13} />
        {deleting ? t.music.deletingEvent : t.music.deleteEventButton}
      </button>
    </div>
  );
}
