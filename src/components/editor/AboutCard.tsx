"use client";

import { useState } from "react";
import { Info } from "lucide-react";
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
}: {
  profileId: string;
  initialLongBio: string | null;
  initialEmail: string | null;
  initialPhone: string | null;
  initialCompany: string | null;
  initialPosition: string | null;
  initialLocation: string | null;
  initialHours: string | null;
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