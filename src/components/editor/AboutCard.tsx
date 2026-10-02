"use client";

import { useId, useState } from "react";
import { Info, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLanguage } from "@/components/LanguageProvider";
import { useSectionSave } from "@/components/dashboard/sectionSave";
import Disclosure from "@/components/ui/Disclosure";
import EditorCard from "./EditorCard";
import SavedPulse, { useSavedPulse } from "./SavedPulse";
import { useEditorPreview } from "./EditorPreviewContext";
import { useAutosavedRows } from "./useAutosavedRows";

// An email is checked only for the obvious mistakes (something@something.something); it never blocks Save.
const looksLikeEmail = (v: string) => /^\S+@\S+\.\S+$/.test(v.trim());

const field = "border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text";

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
  const [emailTouched, setEmailTouched] = useState(false);
  const emailHintId = useId();
  // Extra phone numbers: removing one saves at once (and comes back if that fails). "Add a phone" makes a
  // row on screen only; Save creates it once a number is typed and drops it if it stays empty.
  const { rows: extraPhones, update: updateExtraPhone, remove: removeExtraPhone, addLocal, replace } = useAutosavedRows<any>(
    "profile_phone_numbers",
    "profile_phone_numbers",
    initialExtraPhones as any[]
  );
  const pulse = useSavedPulse();
  const { updateDraft } = useEditorPreview();

  const emailInvalid = emailTouched && email.trim() !== "" && !looksLikeEmail(email);

  // One explicit save for the whole card, including any extra phone numbers — mirrors WhatsAppCard:
  // typing only updates local state (and the live preview) above, nothing reaches Supabase until this
  // runs. Every field here is optional.
  const save = async (): Promise<boolean> => {
    const profileWrite = supabase
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

    const writes: PromiseLike<{ error: unknown }>[] = [profileWrite];
    const inserts: any[] = [];
    for (const p of extraPhones) {
      const number = (p.phone_number ?? "").trim();
      const isNew = typeof p.id === "string" && p.id.startsWith("new:");
      if (isNew) {
        if (number) inserts.push(p); // an empty number added on screen is simply dropped
      } else if (number) {
        writes.push(supabase.from("profile_phone_numbers").update({ phone_number: number }).eq("id", p.id));
      } else {
        writes.push(supabase.from("profile_phone_numbers").delete().eq("id", p.id)); // cleared on purpose
      }
    }
    const results = await Promise.all(writes);
    let failed = results.some((r) => r.error);

    const created = new Map<string, any>();
    for (const p of inserts) {
      const { data, error } = await supabase
        .from("profile_phone_numbers")
        .insert({ profile_id: profileId, phone_number: p.phone_number.trim(), sort_order: p.sort_order })
        .select()
        .single();
      if (error || !data) {
        failed = true;
        continue;
      }
      created.set(p.id, data);
    }
    // One update of the screen: created rows take their real ids (so a retry cannot create them twice),
    // empty rows added on screen are dropped, and numbers cleared on purpose disappear once deleted.
    replace(
      extraPhones
        .map((p) => created.get(p.id) ?? p)
        .filter((p) => {
          const isNew = typeof p.id === "string" && p.id.startsWith("new:");
          const empty = !(p.phone_number ?? "").trim();
          return !empty || (!isNew && failed);
        })
    );
    if (failed) return false;
    pulse.show();
    return true;
  };
  const inSection = useSectionSave(save);

  const addExtraPhone = () => {
    addLocal({ phone_number: "" } as any);
  };

  const moreDetailsFilled = !!(company.trim() || position.trim() || extraPhones.length > 0);

  return (
    <EditorCard icon={Info} title={t.editor.about.title} action={<SavedPulse visible={pulse.visible} label={t.editor.saved} />}>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-ringo-muted">{t.editor.about.allOptionalHint}</p>

        <textarea
          value={longBio}
          onChange={(e) => {
            setLongBio(e.target.value);
            updateDraft({ about_long_bio: e.target.value });
          }}
          placeholder={t.editor.about.longBioPlaceholder}
          aria-label={t.editor.about.longBio}
          rows={3}
          className={`w-full resize-none ${field}`}
        />

        {/* The basics visitors look for first */}
        <div className="grid sm:grid-cols-2 gap-2">
          <input
            value={location}
            onChange={(e) => {
              setLocation(e.target.value);
              updateDraft({ about_location: e.target.value });
            }}
            placeholder={t.editor.about.location}
            aria-label={t.editor.about.location}
            autoComplete="street-address"
            className={field}
          />
          <input
            value={hours}
            onChange={(e) => {
              setHours(e.target.value);
              updateDraft({ about_hours: e.target.value });
            }}
            placeholder={t.editor.about.hours}
            aria-label={t.editor.about.hours}
            className={field}
          />
        </div>

        {/* Contact details */}
        <div className="grid sm:grid-cols-2 gap-2">
          <div>
            <input
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                updateDraft({ about_email: e.target.value });
              }}
              onBlur={() => setEmailTouched(true)}
              placeholder={t.editor.about.email}
              aria-label={t.editor.about.email}
              aria-invalid={emailInvalid}
              aria-describedby={emailInvalid ? emailHintId : undefined}
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              className={`w-full ${field} ${emailInvalid ? "border-red-500" : ""}`}
            />
            {emailInvalid && (
              <p id={emailHintId} className="text-xs text-red-500 mt-1">
                {t.editor.validation.emailInvalid}
              </p>
            )}
          </div>
          <input
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              updateDraft({ about_phone: e.target.value });
            }}
            placeholder={t.editor.about.phone}
            aria-label={t.editor.about.phone}
            inputMode="tel"
            autoComplete="tel"
            className={field}
          />
        </div>

        {/* Less common details, grouped so the section stays short. Open by default when they already hold something. */}
        <Disclosure title={t.editor.about.moreDetails} hint={t.editor.about.moreDetailsHint} defaultOpen={moreDetailsFilled}>
          {/* Company + position — read as a job-title line together */}
          <div className="grid sm:grid-cols-2 gap-2">
            <input
              value={company}
              onChange={(e) => {
                setCompany(e.target.value);
                updateDraft({ about_company: e.target.value });
              }}
              placeholder={t.editor.about.company}
              aria-label={t.editor.about.company}
              className={field}
            />
            <input
              value={position}
              onChange={(e) => {
                setPosition(e.target.value);
                updateDraft({ about_position: e.target.value });
              }}
              placeholder={t.editor.about.position}
              aria-label={t.editor.about.position}
              className={field}
            />
          </div>

          {/* Additional phone numbers — shown below the primary one on the
              live page's business card, not replacing it. */}
          <div className="flex flex-col gap-2 pt-2">
            <div>
              <p className="text-sm font-medium text-ringo-text">{t.editor.about.extraPhonesLabel}</p>
              <p className="text-xs text-ringo-muted">{t.editor.about.extraPhonesHint}</p>
            </div>
            {extraPhones.map((p) => (
              <div key={p.id} className="flex items-center gap-1">
                <input
                  value={p.phone_number}
                  onChange={(e) => updateExtraPhone(p.id, { phone_number: e.target.value })}
                  placeholder={t.editor.about.phonePlaceholder}
                  aria-label={t.editor.about.phonePlaceholder}
                  inputMode="tel"
                  className={`flex-1 min-w-0 ${field}`}
                />
                <button
                  type="button"
                  onClick={() => void removeExtraPhone(p.id)}
                  aria-label={t.editor.removeSocial}
                  className="shrink-0 w-11 h-11 flex items-center justify-center rounded-full text-ringo-muted hover:text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/50"
                >
                  <X size={15} aria-hidden="true" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addExtraPhone}
              className="self-start min-h-[44px] px-1 text-sm font-medium text-ringo-indigo text-left rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/50"
            >
              {t.editor.about.addPhone}
            </button>
          </div>
        </Disclosure>

        {!inSection && (
          <button
            type="button"
            onClick={save}
            className="self-start px-4 py-2 min-h-[44px] rounded-card bg-ringo-indigo text-white text-sm font-medium transition hover:brightness-110 active:scale-[0.97]"
          >
            {t.editor.save}
          </button>
        )}
      </div>
    </EditorCard>
  );
}
