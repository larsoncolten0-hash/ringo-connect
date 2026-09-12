"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, MapPin, Calendar, Ticket } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLanguage } from "@/components/LanguageProvider";

// Tickets' own top-level dashboard page — create an event here, then land
// straight on its full management page (basics, ticket types, Gate
// Access, Check-in) rather than editing inline in a list row, unlike the
// old EventsCard/EventRow this replaces.
export default function TicketsEventsList({ profileId, initialEvents }: { profileId: string; initialEvents: any[] }) {
  const supabase = createClient();
  const router = useRouter();
  const { t, locale } = useLanguage();
  const [events, setEvents] = useState(initialEvents);
  const [creating, setCreating] = useState(false);

  const createEvent = async () => {
    setCreating(true);
    const { data } = await supabase
      .from("events")
      .insert({ profile_id: profileId, title: "", sort_order: events.length })
      .select()
      .single();
    setCreating(false);
    if (data) router.push(`/dashboard/tickets/${data.id}`);
  };

  const statusLabel: Record<string, string> = {
    draft: t.music.eventStatusDraft,
    published: t.music.eventStatusPublished,
    cancelled: t.music.eventStatusCancelled,
    completed: t.music.eventStatusCompleted,
  };
  const statusColor: Record<string, string> = {
    draft: "#6B7280",
    published: "#16A34A",
    cancelled: "#DC2626",
    completed: "#6B7280",
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-medium text-ringo-text">{t.music.ticketsPageTitle}</h1>
          <p className="text-sm text-ringo-muted mt-0.5">{t.music.ticketsPageSubtitle}</p>
        </div>
        <button
          onClick={createEvent}
          disabled={creating}
          className="shrink-0 flex items-center gap-1.5 text-sm font-semibold px-3.5 py-2 rounded-card bg-ringo-indigo text-white disabled:opacity-60"
        >
          <Plus size={15} />
          {creating ? t.music.creatingScanner : t.music.createEventButton}
        </button>
      </div>

      {events.length === 0 ? (
        <div className="rounded-card border border-dashed border-ringo-border p-8 text-center">
          <Ticket size={24} className="mx-auto mb-2 text-ringo-muted" />
          <p className="text-sm text-ringo-muted">{t.music.noEventsCreatedYet}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {events.map((event) => {
            const sold = (event.event_ticket_types || []).length > 0
              ? (event.event_ticket_types as any[]).reduce((sum, tt) => sum + (tt.sold_quantity || 0), 0)
              : event.tickets_sold || 0;
            return (
              <button
                key={event.id}
                onClick={() => router.push(`/dashboard/tickets/${event.id}`)}
                className="text-left rounded-card border border-ringo-border/70 bg-ringo-surface p-4 flex items-center justify-between gap-3 transition hover:border-ringo-indigo/50"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ringo-text truncate">{event.title || t.music.untitledEvent}</p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-xs text-ringo-muted">
                    {event.event_date && (
                      <span className="flex items-center gap-1">
                        <Calendar size={11} />
                        {new Date(`${event.event_date}T00:00:00`).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US")}
                      </span>
                    )}
                    {event.location && (
                      <span className="flex items-center gap-1">
                        <MapPin size={11} />
                        {event.location}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Ticket size={11} />
                      {sold} {t.music.ticketTypeSoldLabel}
                    </span>
                  </div>
                </div>
                <span
                  className="shrink-0 text-[11px] font-semibold px-2 py-1 rounded-full"
                  style={{ backgroundColor: `${statusColor[event.status || "published"]}1a`, color: statusColor[event.status || "published"] }}
                >
                  {statusLabel[event.status || "published"]}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
