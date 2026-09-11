"use client";

import { useState } from "react";
import { CalendarCheck, Copy, Check, Share2, X } from "lucide-react";
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
  username,
  siteUrl,
  initialEnabled,
  initialButtonText,
  initialDescription,
  initialServices,
}: {
  profileId: string;
  username: string;
  siteUrl: string;
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
  const [copied, setCopied] = useState(false);
  const pulse = useSavedPulse();

  // The dedicated booking page (src/app/[username]/book) — a separate,
  // copyable link an owner can hand straight to one customer, distinct
  // from sharing their whole profile. Always shown (not just once saved)
  // so an owner can grab it while setting bookings up for the first time;
  // it only actually resolves once bookings_enabled is true (see that
  // route's own check), hence the hint below when it isn't yet.
  const bookingLink = `${siteUrl.replace(/\/$/, "")}/${username}/book`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(bookingLink);
    } catch {
      // Clipboard API can be unavailable (older browsers, insecure
      // context) — the link is still visible and selectable by hand.
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareLink = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ url: bookingLink, title: t.bookings.yourLinkTitle });
      } catch {
        // User cancelled the share sheet — not an error.
      }
    } else {
      copyLink();
    }
  };

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

        <div className="rounded-card border border-ringo-border/70 bg-ringo-bg p-4">
          <p className="text-sm font-medium text-ringo-text mb-1">{t.bookings.yourLinkTitle}</p>
          <p className="text-xs text-ringo-muted mb-3">{t.bookings.yourLinkHint}</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1 min-w-0 flex items-center rounded-card border border-ringo-border bg-ringo-surface px-3.5 py-2.5">
              <p className="text-sm text-ringo-text truncate font-mono">{bookingLink}</p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={copyLink}
                className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-card bg-ringo-indigo text-white text-sm font-medium hover:brightness-110 transition active:scale-[0.97]"
              >
                {copied ? <Check size={15} /> : <Copy size={15} />}
                {copied ? t.bookings.linkCopied : t.bookings.copyLink}
              </button>
              <button
                onClick={shareLink}
                aria-label="Share"
                className="flex items-center justify-center w-10 h-10 shrink-0 rounded-card border border-ringo-border text-ringo-text hover:border-ringo-indigo hover:text-ringo-indigo transition-colors"
              >
                <Share2 size={15} />
              </button>
            </div>
          </div>
          {!enabled && <p className="text-xs text-ringo-muted mt-2.5">{t.bookings.linkDisabledHint}</p>}
        </div>

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
