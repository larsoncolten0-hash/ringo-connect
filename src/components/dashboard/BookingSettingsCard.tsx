"use client";

import { useState } from "react";
import { CalendarCheck, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLanguage } from "@/components/LanguageProvider";
import EditorCard from "@/components/editor/EditorCard";
import EmptyState from "@/components/editor/EmptyState";
import SavedPulse, { useSavedPulse } from "@/components/editor/SavedPulse";

// Same "type things, then click Save" pattern as every other dashboard
// card (see WhatsAppCard/AboutCard) — nothing here writes to Supabase
// until Save is clicked, except adding/removing a service, which (like
// adding a product or a link) is a structural action that happens right
// away.
export default function BookingSettingsCard({
  profileId,
  initialEnabled,
  initialButtonText,
  initialDescription,
  initialServices,
}: {
  profileId: string;
  initialEnabled: boolean;
  initialButtonText: string | null;
  initialDescription: string | null;
  initialServices: any[];
}) {
  const supabase = createClient();
  const { t } = useLanguage();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [buttonText, setButtonText] = useState(initialButtonText || "");
  const [description, setDescription] = useState(initialDescription || "");
  const [services, setServices] = useState(
    [...initialServices].sort((a, b) => a.sort_order - b.sort_order)
  );
  const [newService, setNewService] = useState("");
  const pulse = useSavedPulse();

  const save = async () => {
    await supabase
      .from("profiles")
      .update({
        bookings_enabled: enabled,
        booking_button_text: buttonText.trim() || null,
        booking_description: description.trim() || null,
      })
      .eq("id", profileId);
    pulse.show();
  };

  const addService = async () => {
    const name = newService.trim();
    if (!name) return;
    const { data } = await supabase
      .from("booking_services")
      .insert({ profile_id: profileId, name, sort_order: services.length })
      .select()
      .single();
    if (data) {
      setServices((prev) => [...prev, data]);
      setNewService("");
    }
  };

  const removeService = async (id: string) => {
    setServices((prev) => prev.filter((s) => s.id !== id));
    await supabase.from("booking_services").delete().eq("id", id);
  };

  return (
    <EditorCard icon={CalendarCheck} title={t.bookings.settingsTitle} action={<SavedPulse visible={pulse.visible} label={t.editor.saved} />}>
      <div className="flex flex-col gap-4">
        <label className="flex items-center justify-between gap-3 cursor-pointer">
          <span>
            <span className="block text-sm font-medium text-ringo-text">{t.bookings.enableLabel}</span>
            <span className="block text-xs text-ringo-muted mt-0.5">{t.bookings.enableHint}</span>
          </span>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="accent-ringo-indigo w-5 h-5 shrink-0"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-ringo-text">{t.bookings.buttonTextLabel}</span>
          <input
            value={buttonText}
            onChange={(e) => setButtonText(e.target.value)}
            placeholder={t.bookings.buttonTextPlaceholder}
            className="border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-ringo-text">{t.bookings.descriptionLabel}</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t.bookings.descriptionPlaceholder}
            rows={2}
            className="border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text resize-none"
          />
        </label>

        <button
          onClick={save}
          className="self-start px-4 py-2 rounded-card bg-ringo-indigo text-white text-sm font-medium transition hover:brightness-110 active:scale-[0.97]"
        >
          {t.editor.save}
        </button>

        <div className="border-t border-ringo-border pt-4 flex flex-col gap-2">
          <div>
            <p className="text-sm font-medium text-ringo-text">{t.bookings.servicesTitle}</p>
            <p className="text-xs text-ringo-muted">{t.bookings.servicesHint}</p>
          </div>

          {services.length === 0 && <EmptyState icon={CalendarCheck} title={t.bookings.noServicesYet} />}

          {services.map((s) => (
            <div key={s.id} className="flex items-center gap-2 border border-ringo-border rounded-card px-3 py-2">
              <span className="flex-1 text-sm text-ringo-text truncate">{s.name}</span>
              <button
                onClick={() => removeService(s.id)}
                aria-label={t.editor.delete}
                className="shrink-0 text-ringo-muted hover:text-red-500"
              >
                <X size={15} />
              </button>
            </div>
          ))}

          <div className="flex gap-2">
            <input
              value={newService}
              onChange={(e) => setNewService(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addService()}
              placeholder={t.bookings.servicePlaceholder}
              className="flex-1 min-w-0 border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
            />
            <button
              onClick={addService}
              className="shrink-0 text-xs px-3 py-1.5 rounded-card bg-ringo-indigo text-white transition hover:brightness-110 active:scale-[0.97]"
            >
              {t.bookings.addService}
            </button>
          </div>
        </div>
      </div>
    </EditorCard>
  );
}
