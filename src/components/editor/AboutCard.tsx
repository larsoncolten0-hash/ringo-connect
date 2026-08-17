"use client";

import { useState } from "react";
import { Info, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLanguage } from "@/components/LanguageProvider";
import EditorCard from "./EditorCard";
import SavedPulse, { useSavedPulse } from "./SavedPulse";

export default function AboutCard({
  profileId,
  initialLongBio,
  initialEmail,
  initialPhone,
  initialCompany,
  initialPosition,
  initialLocation,
  initialHours,
  initialExtraPhones,
}: {
  profileId: string;
  initialLongBio: string | null;
  initialEmail: string | null;
  initialPhone: string | null;
  initialCompany: string | null;
  initialPosition: string | null;
  initialLocation: string | null;
  initialHours: string | null;
  initialExtraPhones: { id: string; phone_number: string }[];
}) {
  const supabase = createClient();
  const { t } = useLanguage();
  const [longBio, setLongBio] = useState(initialLongBio || "");
  const [email, setEmail] = useState(initialEmail || "");
  const [phone, setPhone] = useState(initialPhone || "");
  const [company, setCompany] = useState(initialCompany || "");
  const [position, setPosition] = useState(initialPosition || "");
  const [location, setLocation] = useState(initialLocation || "");
  const [hours, setHours] = useState(initialHours || "");
  const [extraPhones, setExtraPhones] = useState(initialExtraPhones);
  const pulse = useSavedPulse();

  const save = async () => {
    await supabase
      .from("profiles")
      .update({
        about_long_bio: longBio,
        about_email: email,
        about_phone: phone,
        about_company: company,
        about_position: position,
        about_location: location,
        about_hours: hours,
      })
      .eq("id", profileId);
    pulse.show();
  };

  const addExtraPhone = async () => {
    const { data } = await supabase
      .from("profile_phone_numbers")
      .insert({ profile_id: profileId, phone_number: "", sort_order: extraPhones.length })
      .select()
      .single();
    if (data) setExtraPhones((prev) => [...prev, data]);
  };

  const updateExtraPhone = (id: string, phone_number: string) => {
    setExtraPhones((prev) => prev.map((p) => (p.id === id ? { ...p, phone_number } : p)));
  };

  const persistExtraPhone = async (id: string, phone_number: string) => {
    await supabase.from("profile_phone_numbers").update({ phone_number }).eq("id", id);
    pulse.show();
  };

  const removeExtraPhone = async (id: string) => {
    setExtraPhones((prev) => prev.filter((p) => p.id !== id));
    await supabase.from("profile_phone_numbers").delete().eq("id", id);
  };

  return (
    <EditorCard icon={Info} title={t.editor.about.title} action={<SavedPulse visible={pulse.visible} label={t.editor.saved} />}>
      <div className="flex flex-col gap-3">
        <textarea
          value={longBio}
          onChange={(e) => setLongBio(e.target.value)}
          onBlur={save}
          placeholder={t.editor.about.longBioPlaceholder}
          rows={3}
          className="w-full border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text resize-none"
        />

        {/* Company + position — read as a job-title line together */}
        <div className="grid sm:grid-cols-2 gap-2">
          <input
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            onBlur={save}
            placeholder={t.editor.about.company}
            className="border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
          />
          <input
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            onBlur={save}
            placeholder={t.editor.about.position}
            className="border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
          />
        </div>

        {/* Contact details */}
        <div className="grid sm:grid-cols-2 gap-2">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={save}
            placeholder={t.editor.about.email}
            inputMode="email"
            className="border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onBlur={save}
            placeholder={t.editor.about.phone}
            inputMode="tel"
            className="border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
          />
        </div>

        {/* Additional phone numbers — shown below the primary one on the
            live page's business card, not replacing it. */}
        <div className="flex flex-col gap-2 border-t border-ringo-border pt-3">
          <div>
            <p className="text-sm font-medium text-ringo-text">{t.editor.about.extraPhonesLabel}</p>
            <p className="text-xs text-ringo-muted">{t.editor.about.extraPhonesHint}</p>
          </div>
          {extraPhones.map((p) => (
            <div key={p.id} className="flex items-center gap-2">
              <input
                value={p.phone_number}
                onChange={(e) => updateExtraPhone(p.id, e.target.value)}
                onBlur={(e) => persistExtraPhone(p.id, e.target.value)}
                placeholder={t.editor.about.phonePlaceholder}
                inputMode="tel"
                className="flex-1 border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
              />
              <button
                onClick={() => removeExtraPhone(p.id)}
                className="shrink-0 text-ringo-muted hover:text-red-500"
              >
                <X size={15} />
              </button>
            </div>
          ))}
          <button onClick={addExtraPhone} className="text-sm font-medium text-ringo-indigo text-left">
            {t.editor.about.addPhone}
          </button>
        </div>

        <div className="grid sm:grid-cols-2 gap-2">
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            onBlur={save}
            placeholder={t.editor.about.location}
            className="border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
          />
          <input
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            onBlur={save}
            placeholder={t.editor.about.hours}
            className="border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
          />
        </div>
      </div>
    </EditorCard>
  );
}