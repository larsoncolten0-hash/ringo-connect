"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

// The actual "Join Community" surface — its own route (see
// src/app/[username]/community/page.tsx), reached from ProfileView's Stay
// Connected section. Same chrome/shape as BookingPage.tsx (sticky white
// header with a back arrow to the profile, plain neutrals + the creator's
// own accent) — POSTs to /api/community/subscribe, the only thing that
// ever writes a real community_subscribers row.
//
// IMPORTANT PRIVACY NOTE (see the migration's header + the implementation
// plan): the two consent checkboxes below default to UNCHECKED. Neither
// "email filled in" nor "phone filled in" is ever treated as marketing
// consent anywhere in this flow — only an explicitly checked box is.
export default function CommunityJoinPage({ profile }: { profile: any }) {
  const { t } = useLanguage();
  const accent = profile.theme_color || "#D4A954";
  const displayName = profile.name || profile.username;
  const profileHref = `/${profile.username}`;
  const label = profile.community_label?.trim() || t.nav.community;

  const [step, setStep] = useState<"form" | "confirmation">("form");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [honeypot, setHoneypot] = useState("");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [consentEmail, setConsentEmail] = useState(false);
  const [consentWhatsapp, setConsentWhatsapp] = useState(false);
  const [manageUrl, setManageUrl] = useState("");

  const inputClass = "border rounded-card px-3.5 py-2.5 text-sm w-full";
  const inputStyle = { borderColor: "#E5E7EB" } as const;
  const labelClass = "text-xs font-medium mb-1.5 block";
  const labelStyle = { opacity: 0.7 } as const;

  const submit = async () => {
    setError("");
    if (!name.trim()) {
      setError(t.communityJoin.nameRequired);
      return;
    }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError(t.communityJoin.emailRequired);
      return;
    }
    if (!consentEmail && !consentWhatsapp) {
      setError(t.communityJoin.consentRequired);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/community/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile_id: profile.id,
          website: honeypot,
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          consent_email: consentEmail,
          consent_whatsapp: consentWhatsapp,
          source: "ringo_profile",
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || t.communityJoin.submitFailed);
      }
      if (data?.unsubscribe_token) {
        setManageUrl(`${window.location.origin}/community/manage/${data.unsubscribe_token}`);
      }
      setStep("confirmation");
    } catch (err: any) {
      setError(err?.message || t.communityJoin.submitFailed);
    } finally {
      setSubmitting(false);
    }
  };

  if (step === "confirmation") {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center px-4 py-10" style={{ color: "#14202B" }}>
        <div className="w-full max-w-md flex flex-col items-center gap-4 text-center">
          <span className="w-16 h-16 rounded-full flex items-center justify-center" style={{ backgroundColor: `${accent}1a` }}>
            <Check size={28} style={{ color: accent }} />
          </span>
          <h1 className="font-display text-xl font-bold">{t.communityJoin.successTitle}</h1>
          <p className="text-sm" style={{ opacity: 0.75 }}>
            {t.communityJoin.successBody(displayName)}
          </p>
          {manageUrl && (
            <a href={manageUrl} className="text-xs font-medium underline" style={{ opacity: 0.6 }}>
              {t.communityJoin.managePreferences}
            </a>
          )}
          <Link
            href={profileHref}
            className="mt-2 px-5 py-2.5 rounded-full text-sm font-semibold text-white"
            style={{ backgroundColor: accent }}
          >
            {t.communityJoin.backToProfile}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white pb-10" style={{ color: "#14202B" }}>
      <div className="sticky top-0 z-20 bg-white border-b flex items-center gap-3 px-4 py-3" style={{ borderColor: "#E5E7EB" }}>
        <Link href={profileHref} className="shrink-0" aria-label={t.communityJoin.backToProfile}>
          <ArrowLeft size={19} />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate">{t.communityJoin.formTitle(displayName)}</p>
          <p className="text-xs truncate" style={{ opacity: 0.6 }}>
            {t.communityJoin.subtitle}
          </p>
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 py-5 flex flex-col gap-4">
        {error && (
          <p className="text-sm px-3.5 py-2.5 rounded-card" style={{ backgroundColor: "#FEE2E2", color: "#991B1B" }}>
            {error}
          </p>
        )}

        <label className="flex flex-col">
          <span className={labelClass} style={labelStyle}>{t.communityJoin.fullName}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t.communityJoin.fullNamePlaceholder} className={inputClass} style={inputStyle} />
        </label>

        <label className="flex flex-col">
          <span className={labelClass} style={labelStyle}>{t.communityJoin.email}</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t.communityJoin.emailPlaceholder}
            className={inputClass}
            style={inputStyle}
          />
        </label>

        <label className="flex flex-col">
          <span className={labelClass} style={labelStyle}>{t.communityJoin.phone}</span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={t.communityJoin.phonePlaceholder}
            className={inputClass}
            style={inputStyle}
          />
        </label>

        {/* Honeypot — real visitors never see this; a filled value is
            silently discarded server-side. Same pattern BookingPage uses. */}
        <input
          type="text"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          className="absolute -left-[9999px] w-px h-px"
        />

        <div className="rounded-2xl p-3.5 flex flex-col gap-2" style={{ backgroundColor: "#F9FAFB" }}>
          <p className="text-xs font-medium">{t.communityJoin.preferencesTitle}</p>
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input type="checkbox" checked={consentEmail} onChange={(e) => setConsentEmail(e.target.checked)} style={{ accentColor: accent }} />
            {t.communityJoin.consentEmail}
          </label>
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input type="checkbox" checked={consentWhatsapp} onChange={(e) => setConsentWhatsapp(e.target.checked)} style={{ accentColor: accent }} />
            {t.communityJoin.consentWhatsapp}
          </label>
        </div>

        <button
          onClick={submit}
          disabled={submitting}
          className="flex items-center justify-center gap-2 py-3 rounded-full text-sm font-semibold text-white transition active:scale-[0.98] disabled:opacity-60"
          style={{ backgroundColor: accent }}
        >
          {submitting && <Loader2 size={15} className="animate-spin" />}
          {submitting ? t.communityJoin.submitting : t.communityJoin.submit}
        </button>
      </div>
    </div>
  );
}
