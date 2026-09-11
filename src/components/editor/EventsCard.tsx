"use client";

import { useState, useRef } from "react";
import { Reorder } from "framer-motion";
import { Ticket } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLanguage } from "@/components/LanguageProvider";
import EditorCard from "./EditorCard";
import EventRow from "./EventRow";
import { useEditorPreview } from "./EditorPreviewContext";

// Only ever rendered for a profile tagged Music & Entertainment. There is
// no in-house ticket purchasing system — "Get Ticket" on the public page
// links out to ticket_url when set, or falls back to a WhatsApp message
// the same way a product without a landing_url already does.
export default function EventsCard({
  profileId,
  userId,
  initialEvents,
  currency,
}: {
  profileId: string;
  userId: string;
  initialEvents: any[];
  currency: string;
}) {
  const supabase = createClient();
  const { t } = useLanguage();
  const [events, setEvents] = useState([...initialEvents].sort((a, b) => a.sort_order - b.sort_order));
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const persistTimer = useRef<ReturnType<typeof setTimeout>>();
  const { updateDraft } = useEditorPreview();

  const addEvent = async () => {
    const { data } = await supabase
      .from("events")
      .insert({ profile_id: profileId, title: "", sort_order: events.length })
      .select()
      .single();
    if (data) {
      const next = [...events, data];
      setEvents(next);
      updateDraft({ events: next });
      setJustAddedId(data.id);
    }
  };

  const updateEvent = (id: string, patch: any) => {
    setEvents((prev) => {
      const next = prev.map((ev) => (ev.id === id ? { ...ev, ...patch } : ev));
      updateDraft({ events: next });
      return next;
    });
  };

  const persistEvent = async (id: string, patch: any) => {
    await supabase.from("events").update(patch).eq("id", id);
  };

  const deleteEvent = async (id: string) => {
    setEvents((prev) => {
      const next = prev.filter((ev) => ev.id !== id);
      updateDraft({ events: next });
      return next;
    });
    await supabase.from("events").delete().eq("id", id);
  };

  const handleReorder = (newOrder: any[]) => {
    const reindexed = newOrder.map((ev, i) => ({ ...ev, sort_order: i }));
    setEvents(reindexed);
    updateDraft({ events: reindexed });
    clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      Promise.all(reindexed.map((ev) => supabase.from("events").update({ sort_order: ev.sort_order }).eq("id", ev.id)));
    }, 400);
  };

  return (
    <EditorCard
      icon={Ticket}
      title={t.music.upcomingTitle}
      action={
        <button onClick={addEvent} className="text-xs px-3 py-1.5 rounded-card bg-ringo-indigo text-white whitespace-nowrap transition hover:brightness-110 active:scale-[0.97]">
          {t.music.addEvent}
        </button>
      }
    >
      <p className="text-xs text-ringo-muted -mt-2 mb-3">{t.music.eventsHint}</p>

      {events.length === 0 && <p className="text-sm text-ringo-muted">{t.music.noEventsYet}</p>}

      <Reorder.Group axis="y" values={events} onReorder={handleReorder} className="flex flex-col gap-2">
        {events.map((event) => (
          <EventRow
            key={event.id}
            event={event}
            userId={userId}
            currency={currency}
            startExpanded={event.id === justAddedId}
            onChange={(patch) => updateEvent(event.id, patch)}
            onPersist={(patch) => persistEvent(event.id, patch)}
            onDelete={() => deleteEvent(event.id)}
          />
        ))}
      </Reorder.Group>
    </EditorCard>
  );
}
