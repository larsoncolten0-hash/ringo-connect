"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Loader2, BellRing, X } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import RegisterServiceWorker from "@/components/RegisterServiceWorker";
import { getPushStatus, subscribeToPush } from "@/lib/push/subscribeClient";

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
//
// Three steps, not two: "form" -> "notifications" -> "confirmation". The
// notifications step is a distinct, deliberate screen (not folded into
// either the form or the success screen) offering the SAME push mechanism
// /community/manage/[token] already uses (subscribeToPush against
// /api/push/subscribe-subscriber, keyed by this subscriber's own
// unsubscribe_token) — no new push infrastructure here, just an earlier,
// inline moment to reach it right after joining instead of only via the
// "Manage preferences" link. That link still works exactly as before for
// anyone who skips this (see the confirmation screen below) — this is
// additive, not a replacement.
//
// Skipped entirely (straight to confirmation) when there's nothing useful
// to offer: unsupported browser, permission already denied (asking again
// would silently do nothing — see subscribeClient.ts's own comment on why
// requestPermission() never re-prompts once denied), or already
// subscribed somehow. getPushStatus() only reads state, it never itself
// prompts for permission, so checking it here doesn't count as the
// "automatically on page load" request the spec explicitly rules out —
// only clicking "Enable Notifications" below does that.
export default function CommunityJoinPage({ profile }: { profile: any }) {
  const { t } = useLanguage();
  const accent = profile.theme_color || "#D4A954";
  const displayName = profile.name || profile.username;
  const profileHref = `/${profile.username}`;
  const label = profile.community_label?.trim() || t.nav.community;

  const [step, setStep] = useState<"form" | "notifications" | "confirmation">("form");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [honeypot, setHoneypot] = useState("");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [consentEmail, setConsentEmail] = useState(false);
  const [consentWhatsapp, setConsentWhatsapp] = useState(false);
  const [manageUrl, setManageUrl] = useState("");
  const [subscriberToken, setSubscriberToken] = useState("");
  const [notifResult, setNotifResult] = useState<"idle" | "enabled" | "failed">("idle");
  const [notifBusy, setNotifBusy] = useState(false);

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
        setSubscriberToken(data.unsubscribe_token);
        // Lets FanRecognitionHeader.tsx recognize this visitor's browser
        // as a member of THIS profile on a future visit — keyed by
        // username so it's scoped per-profile by construction (joining
        // creator A's community never makes creator B's page think this
        // browser already joined). Best-effort: a failed write (private
        // browsing, storage blocked) just means the header widget won't
        // show up later, never blocks the join itself.
        try {
          localStorage.setItem(
            `ringo-community-member-${profile.username}`,
            JSON.stringify({ token: data.unsubscribe_token, name: name.trim() })
          );
        } catch {
          // See comment above — non-critical.
        }
      }

      // Only worth offering the inline prompt when there's a real
      // permission decision left to make — see this component's own
      // header comment for the three skip cases.
      const pushState = data?.unsubscribe_token ? await getPushStatus() : { supported: false, permission: "unsupported" as const, subscribed: false };
      if (pushState.supported && pushState.permission !== "denied" && !pushState.subscribed) {
        setStep("notifications");
      } else {
        setStep("confirmation");
      }
    } catch (err: any) {
      setError(err?.message || t.communityJoin.submitFailed);
    } finally {
      setSubmitting(false);
    }
  };

  const enableNotifications = async () => {
    if (notifBusy) return;
    setNotifBusy(true);
    // The exact same call /community/manage/[token]'s enablePush() makes —
    // reusing it directly rather than reimplementing the permission/
    // PushManager/fetch dance a second time.
    const result = await subscribeToPush({ subscribeUrl: "/api/push/subscribe-subscriber", extra: { token: subscriberToken } });
    setNotifResult(result.ok ? "enabled" : "failed");
    setNotifBusy(false);
  };

  if (step === "notifications") {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center px-4 py-10" style={{ color: "#14202B" }}>
        {/* Registers pwa-sw.js as early as this step as possible — a
            brand-new fan has very likely never hit any page on this site
            before, so subscribeToPush()'s navigator.serviceWorker.ready
            needs somewhere to actually resolve from. Same reasoning as
            /community/manage/[token]'s own mount of this. */}
        <RegisterServiceWorker />
        <div className="w-full max-w-md flex flex-col items-center gap-4 text-center">
          <span className="w-16 h-16 rounded-full flex items-center justify-center" style={{ backgroundColor: `${accent}1a` }}>
            <BellRing size={26} style={{ color: accent }} />
          </span>
          <h1 className="font-display text-xl font-bold">{t.communityJoin.notifTitle(displayName)}</h1>
          <p className="text-sm" style={{ opacity: 0.75 }}>
            {t.communityJoin.notifBody}
          </p>

          {notifResult === "idle" ? (
            <div className="flex flex-col sm:flex-row gap-2.5 w-full sm:w-auto mt-1">
              <button
                onClick={enableNotifications}
                disabled={notifBusy}
                className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold text-white transition active:scale-[0.98] disabled:opacity-60"
                style={{ backgroundColor: accent }}
              >
                {notifBusy && <Loader2 size={15} className="animate-spin" />}
                {t.pushNotifications.promptEnable}
              </button>
              <button
                onClick={() => setStep("confirmation")}
                disabled={notifBusy}
                className="px-5 py-2.5 rounded-full text-sm font-medium disabled:opacity-60"
                style={{ opacity: 0.6 }}
              >
                {t.pushNotifications.promptDismiss}
              </button>
            </div>
          ) : (
            <>
              {/* Calm either way — a denied/failed permission never blocks
                  continuing, and never nags again this same visit. */}
              <p
                className="text-xs font-medium flex items-center gap-1.5"
                style={{ color: notifResult === "enabled" ? "#0D9488" : undefined, opacity: notifResult === "enabled" ? 1 : 0.6 }}
              >
                {notifResult === "enabled" ? <Check size={14} /> : <X size={14} />}
                {notifResult === "enabled" ? t.communityJoin.notifEnabledMessage : t.communityJoin.notifFailedMessage}
              </p>
              <button
                onClick={() => setStep("confirmation")}
                className="mt-1 px-5 py-2.5 rounded-full text-sm font-semibold text-white"
                style={{ backgroundColor: accent }}
              >
                {t.getStarted.continueButton}
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  if (step === "confirmation") {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center px-4 py-10" style={{ color: "#14202B" }}>
        <RegisterServiceWorker />
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
      <RegisterServiceWorker />
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
