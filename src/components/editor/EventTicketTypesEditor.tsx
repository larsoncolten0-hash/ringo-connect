"use client";

import { useState } from "react";
import { Reorder, useDragControls } from "framer-motion";
import { GripVertical, Plus, Trash2, Star } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLanguage } from "@/components/LanguageProvider";
import { formatPrice } from "@/lib/currency";
import { remainingForTicketType, isSoldOut } from "@/lib/ticketTypes";

// Unlimited/custom ticket tiers for one event (Standard/VIP/Backstage/
// whatever the artist wants to call them — see
// supabase/migrations/2026-09-21_event_ticket_types.sql). Nested inside
// EventRow's own expanded panel, below the original single-price "Sell
// tickets through Ringo" fields: those keep working completely unchanged
// for an event with no tiers — the moment one exists here, it's what the
// public ticket selector (ItemDetailPage's TicketDetail) and the public
// profile's "Primary ticket" line (EventsSection/PinnedSpotlight) actually
// use instead.
//
// Every write goes straight to event_ticket_types via the regular client
// (RLS-protected — "event_ticket_types owner write" — the same pattern
// EventsCard/TrackRow/ProductRow already use for their own tables), not
// through EventRow's onPersist (that only ever writes real `events`
// columns). `onChange` here only updates the local/live-preview copy
// nested on the event — see EventsCard's updateEvent, which merges
// whatever patch this bubbles up to it.
export default function EventTicketTypesEditor({
  eventId,
  ticketTypes,
  currency,
  onChange,
}: {
  eventId: string;
  ticketTypes: any[];
  currency: string;
  onChange: (next: any[]) => void;
}) {
  const supabase = createClient();
  const { t } = useLanguage();
  const [justAddedId, setJustAddedId] = useState<string | null>(null);

  const sorted = [...ticketTypes].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  const addTicketType = async () => {
    const { data } = await supabase
      .from("event_ticket_types")
      .insert({
        event_id: eventId,
        name: "",
        price: 0,
        sort_order: sorted.length,
        // The first tier an event ever gets defaults to primary — an
        // event with ticket types always needs exactly one, and there's
        // nothing yet to prefer over it. Every tier after the first stays
        // off until the artist explicitly picks it (see setPrimary).
        is_primary: sorted.length === 0,
      })
      .select()
      .single();
    if (data) {
      onChange([...ticketTypes, data]);
      setJustAddedId(data.id);
    }
  };

  const updateLocal = (id: string, patch: any) => onChange(ticketTypes.map((tt) => (tt.id === id ? { ...tt, ...patch } : tt)));

  const persist = async (id: string, patch: any) => {
    await supabase.from("event_ticket_types").update(patch).eq("id", id);
  };

  const setPrimary = async (id: string) => {
    onChange(ticketTypes.map((tt) => ({ ...tt, is_primary: tt.id === id })));
    // Two writes, not one — the unique partial index only ever allows a
    // single is_primary=true row at a time, so the old one has to clear
    // first. A brief moment with zero primaries in between is harmless;
    // two primaries at once is what the index actually prevents.
    await supabase.from("event_ticket_types").update({ is_primary: false }).eq("event_id", eventId).neq("id", id);
    await supabase.from("event_ticket_types").update({ is_primary: true }).eq("id", id);
  };

  const deleteTicketType = async (id: string) => {
    const wasPrimary = ticketTypes.find((tt) => tt.id === id)?.is_primary;
    const remaining = ticketTypes.filter((tt) => tt.id !== id);
    // Deleting the primary tier never leaves the event with zero primary
    // ticket types (as long as one is left) — the public profile's
    // "Primary ticket" line would otherwise silently disappear.
    if (wasPrimary && remaining.length > 0) {
      remaining[0] = { ...remaining[0], is_primary: true };
      await supabase.from("event_ticket_types").update({ is_primary: true }).eq("id", remaining[0].id);
    }
    onChange(remaining);
    await supabase.from("event_ticket_types").delete().eq("id", id);
  };

  const handleReorder = (newOrder: any[]) => {
    const reindexed = newOrder.map((tt, i) => ({ ...tt, sort_order: i }));
    onChange(reindexed);
    Promise.all(reindexed.map((tt) => supabase.from("event_ticket_types").update({ sort_order: tt.sort_order }).eq("id", tt.id)));
  };

  return (
    <div className="rounded-card border border-dashed border-ringo-border p-2.5 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-ringo-text">{t.music.ticketTypesTitle}</p>
          <p className="text-[11px] text-ringo-muted -mt-0.5">{t.music.ticketTypesHint}</p>
        </div>
        <button
          onClick={addTicketType}
          className="text-xs px-2.5 py-1.5 rounded-card bg-ringo-indigo text-white whitespace-nowrap transition hover:brightness-110 active:scale-[0.97]"
        >
          {t.music.addTicketType}
        </button>
      </div>

      {sorted.length === 0 && <p className="text-xs text-ringo-muted">{t.music.noTicketTypesYet}</p>}

      <Reorder.Group axis="y" values={sorted} onReorder={handleReorder} className="flex flex-col gap-2">
        {sorted.map((tt) => (
          <TicketTypeRow
            key={tt.id}
            ticketType={tt}
            currency={currency}
            startExpanded={tt.id === justAddedId}
            onChange={(patch) => updateLocal(tt.id, patch)}
            onPersist={(patch) => persist(tt.id, patch)}
            onSetPrimary={() => setPrimary(tt.id)}
            onDelete={() => deleteTicketType(tt.id)}
          />
        ))}
      </Reorder.Group>
    </div>
  );
}

function TicketTypeRow({
  ticketType,
  currency,
  startExpanded,
  onChange,
  onPersist,
  onSetPrimary,
  onDelete,
}: {
  ticketType: any;
  currency: string;
  startExpanded?: boolean;
  onChange: (patch: any) => void;
  onPersist: (patch: any) => void;
  onSetPrimary: () => void;
  onDelete: () => void;
}) {
  const { t } = useLanguage();
  const controls = useDragControls();
  const [expanded, setExpanded] = useState(!!startExpanded);

  const remaining = remainingForTicketType(ticketType);
  const soldOut = isSoldOut(ticketType);
  const benefitsText = (ticketType.benefits || []).join("\n");

  const toIsoOrNull = (v: string) => (v ? new Date(v).toISOString() : null);
  const toLocalInputValue = (iso?: string | null) => (iso ? new Date(iso).toISOString().slice(0, 16) : "");

  return (
    <Reorder.Item
      value={ticketType}
      dragListener={false}
      dragControls={controls}
      className="border border-ringo-border rounded-card bg-ringo-surface overflow-hidden"
      whileDrag={{ scale: 1.02, boxShadow: "0 12px 28px -8px rgba(0,0,0,0.25)", zIndex: 10 }}
    >
      <div className="flex items-center gap-2 p-2">
        <div
          onPointerDown={(e) => controls.start(e)}
          className="touch-none cursor-grab active:cursor-grabbing text-ringo-muted p-1.5 -m-1.5 shrink-0"
          aria-label={t.editor.dragHint}
        >
          <GripVertical size={14} />
        </div>

        <button type="button" onClick={() => setExpanded((v) => !v)} className="flex-1 min-w-0 text-left">
          <p className="text-sm font-medium text-ringo-text truncate flex items-center gap-1.5">
            {ticketType.name || t.music.untitledTicketType}
            {ticketType.is_primary && <Star size={11} className="shrink-0 fill-ringo-indigo text-ringo-indigo" />}
            {ticketType.is_active === false && (
              <span className="text-[10px] font-normal px-1.5 py-0.5 rounded-full bg-ringo-muted/15 text-ringo-muted shrink-0">
                {t.music.ticketTypeInactiveBadge}
              </span>
            )}
            {soldOut && (
              <span className="text-[10px] font-normal px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-500 shrink-0">{t.music.soldOut}</span>
            )}
          </p>
          <p className="text-xs text-ringo-muted truncate" suppressHydrationWarning>
            {formatPrice(ticketType.price, currency)}
            {" · "}
            {ticketType.total_quantity != null
              ? `${ticketType.sold_quantity || 0} / ${ticketType.total_quantity}`
              : `${ticketType.sold_quantity || 0} ${t.music.ticketTypeUnlimitedSold}`}
          </p>
        </button>
      </div>

      {expanded && (
        <div className="px-2.5 pb-2.5 pt-1 border-t border-ringo-border flex flex-col gap-2">
          <input
            value={ticketType.name}
            onChange={(e) => onChange({ name: e.target.value })}
            onBlur={(e) => onPersist({ name: e.target.value })}
            placeholder={t.music.ticketTypeNamePlaceholder}
            className="w-full text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-bg text-ringo-text"
          />
          <input
            value={ticketType.description ?? ""}
            onChange={(e) => onChange({ description: e.target.value })}
            onBlur={(e) => onPersist({ description: e.target.value })}
            placeholder={t.music.ticketTypeDescriptionPlaceholder}
            className="w-full text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-bg text-ringo-text"
          />
          <label className="flex flex-col gap-1">
            <span className="text-xs text-ringo-muted">{t.music.ticketTypeBenefitsLabel}</span>
            <textarea
              value={benefitsText}
              onChange={(e) => onChange({ benefits: e.target.value.split("\n") })}
              onBlur={(e) =>
                onPersist({ benefits: e.target.value.split("\n").map((b) => b.trim()).filter(Boolean) })
              }
              placeholder={t.music.ticketTypeBenefitsPlaceholder}
              rows={3}
              className="w-full text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-bg text-ringo-text resize-y"
            />
          </label>

          <div className="flex gap-2">
            <label className="flex-1 flex flex-col gap-1">
              <span className="text-xs text-ringo-muted">{t.editor.price}</span>
              <input
                value={ticketType.price ?? ""}
                onChange={(e) => onChange({ price: e.target.value.replace(/[^0-9.]/g, "") })}
                onBlur={(e) => onPersist({ price: Number(e.target.value) || 0 })}
                inputMode="decimal"
                className="text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-bg text-ringo-text"
              />
            </label>
            <label className="flex-1 flex flex-col gap-1">
              <span className="text-xs text-ringo-muted">{t.music.ticketTypeQuantityLabel}</span>
              <input
                value={ticketType.total_quantity ?? ""}
                onChange={(e) => onChange({ total_quantity: e.target.value.replace(/[^0-9]/g, "") })}
                onBlur={(e) => onPersist({ total_quantity: e.target.value ? Number(e.target.value) : null })}
                placeholder={t.music.ticketTypeQuantityPlaceholder}
                inputMode="numeric"
                className="text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-bg text-ringo-text"
              />
            </label>
          </div>

          {remaining !== null && (
            <p className="text-xs text-ringo-muted">
              {t.music.ticketTypeRemainingLabel}: {Math.max(remaining, 0)} / {ticketType.total_quantity}
            </p>
          )}

          <label className="flex flex-col gap-1">
            <span className="text-xs text-ringo-muted">{t.music.ticketTypeMaxPerCustomerLabel}</span>
            <input
              value={ticketType.max_per_customer ?? ""}
              onChange={(e) => onChange({ max_per_customer: e.target.value.replace(/[^0-9]/g, "") })}
              onBlur={(e) => onPersist({ max_per_customer: e.target.value ? Number(e.target.value) : null })}
              placeholder={t.music.ticketTypeMaxPerCustomerPlaceholder}
              inputMode="numeric"
              className="w-full text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-bg text-ringo-text"
            />
          </label>

          <div className="flex gap-2">
            <label className="flex-1 flex flex-col gap-1">
              <span className="text-xs text-ringo-muted">{t.music.ticketTypeSalesStartLabel}</span>
              <input
                type="datetime-local"
                value={toLocalInputValue(ticketType.sales_start_at)}
                onChange={(e) => onChange({ sales_start_at: e.target.value })}
                onBlur={(e) => onPersist({ sales_start_at: toIsoOrNull(e.target.value) })}
                className="text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-bg text-ringo-text"
              />
            </label>
            <label className="flex-1 flex flex-col gap-1">
              <span className="text-xs text-ringo-muted">{t.music.ticketTypeSalesEndLabel}</span>
              <input
                type="datetime-local"
                value={toLocalInputValue(ticketType.sales_end_at)}
                onChange={(e) => onChange({ sales_end_at: e.target.value })}
                onBlur={(e) => onPersist({ sales_end_at: toIsoOrNull(e.target.value) })}
                className="text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-bg text-ringo-text"
              />
            </label>
          </div>

          <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
            <label className="flex items-center gap-1.5 text-xs text-ringo-text">
              <input
                type="checkbox"
                checked={ticketType.is_active !== false}
                onChange={(e) => {
                  onChange({ is_active: e.target.checked });
                  onPersist({ is_active: e.target.checked });
                }}
              />
              {t.music.ticketTypeActiveLabel}
            </label>

            {!ticketType.is_primary && (
              <button onClick={onSetPrimary} className="text-xs font-medium text-ringo-indigo flex items-center gap-1">
                <Star size={12} />
                {t.music.setPrimaryButton}
              </button>
            )}
            {ticketType.is_primary && <span className="text-xs font-medium text-ringo-indigo flex items-center gap-1"><Star size={12} className="fill-ringo-indigo" />{t.music.ticketTypePrimaryLabel}</span>}

            <button onClick={onDelete} className="text-xs text-red-500 flex items-center gap-1">
              <Trash2 size={12} />
              {t.editor.delete}
            </button>
          </div>
        </div>
      )}
    </Reorder.Item>
  );
}
