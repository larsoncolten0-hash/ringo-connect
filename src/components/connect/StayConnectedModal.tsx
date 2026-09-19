"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Loader2, X } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import ConnectedNotificationsPrompt from "./ConnectedNotificationsPrompt";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9][0-9\s().-]{5,39}$/;

type Step = "form" | "code" | "done";

// "Stay Connected" — the lightweight onboarding shown when a visitor with
// no Ringo customer session taps ＋ Connect. Deliberately not called (or
// worded as) an account creation: name, phone, email, then a code sent to
// that email. Nothing is stored as a customer until the code is confirmed
// (see /api/customer/connect/start and /verify). The marketing checkbox is
// separate, optional, and OFF by default — connecting never implies it.
//
// `initialStep="done"` reopens straight on the confirmation/notifications
// step for someone who is already connected (or was connected in one tap).
export default function StayConnectedModal({
  open,
  onClose,
  profile,
  accent,
  initialStep,
  onConnected,
}: {
  open: boolean;
  onClose: () => void;
  profile: { id: string; name: string };
  accent: string;
  initialStep: Step;
  onConnected: () => void;
}) {
  const { t, locale } = useLanguage();
  const [step, setStep] = useState<Step>(initialStep);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [marketing, setMarketing] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The typed email already has a Ringo account, so we fell back to a sign-in code.
  const [existingAccount, setExistingAccount] = useState(false);

  useEffect(() => {
    if (open) {
      setStep(initialStep);
      setError("");
      setCode("");
      setExistingAccount(false);
    }
  }, [open, initialStep]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  const errorMessage = (code: string | undefined) => {
    switch (code) {
      case "invalid_name":
        return t.connect.nameRequired;
      case "invalid_phone":
        return t.connect.phoneInvalid;
      case "invalid_email":
        return t.connect.emailInvalid;
      case "cooldown":
        return t.connect.resendWait;
      case "rate_limited":
        return t.connect.tooManyRequests;
      case "email_failed":
        return t.connect.emailSendFailed;
      default:
        return t.connect.genericError;
    }
  };

  const sendCode = async () => {
    setError("");
    if (!name.trim()) return setError(t.connect.nameRequired);
    if (!PHONE_RE.test(phone.trim())) return setError(t.connect.phoneInvalid);
    if (!EMAIL_RE.test(email.trim())) return setError(t.connect.emailInvalid);

    setBusy(true);
    try {
      const res = await fetch("/api/customer/connect/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile_id: profile.id,
          name: name.trim(),
          phone: phone.trim(),
          email: email.trim(),
          marketing_consent: marketing,
          website: honeypot,
          language: locale,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) return setError(errorMessage(data?.error));
      setCode("");
      setStep("code");
    } catch {
      setError(t.connect.genericError);
    } finally {
      setBusy(false);
    }
  };

  // The normal path for a NEW customer: one request creates the account, starts the
  // session and connects — no email, no code. Only when the email already belongs to
  // an existing account (never signed into from the form alone) do we fall back to
  // the emailed-code sign-in.
  const submitForm = async () => {
    setError("");
    if (!name.trim()) return setError(t.connect.nameRequired);
    if (!PHONE_RE.test(phone.trim())) return setError(t.connect.phoneInvalid);
    if (!EMAIL_RE.test(email.trim())) return setError(t.connect.emailInvalid);

    let fallBackToCode = false;
    setBusy(true);
    try {
      const res = await fetch("/api/customer/connect/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile_id: profile.id,
          name: name.trim(),
          phone: phone.trim(),
          email: email.trim(),
          marketing_consent: marketing,
          website: honeypot,
          language: locale,
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        if (!data?.connected) return setError(t.connect.genericError);
        onConnected();
        return setStep("done");
      }
      if (res.status === 409 && data?.error === "account_exists") {
        // No `return` here: the fallback below must still run after `finally`.
        fallBackToCode = true;
      } else {
        setError(errorMessage(data?.error));
      }
    } catch {
      setError(t.connect.genericError);
    } finally {
      setBusy(false);
    }
    if (fallBackToCode) {
      setExistingAccount(true);
      await sendCode();
    }
  };

  const confirmCode = async () => {
    setError("");
    if (!/^\d{6}$/.test(code.trim())) return setError(t.connect.codeInvalid);

    setBusy(true);
    try {
      const res = await fetch("/api/customer/connect/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), code: code.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) return setError(data?.error === "invalid_code" ? t.connect.codeInvalid : t.connect.genericError);
      if (!data?.connected) return setError(t.connect.genericError);
      onConnected();
      setStep("done");
    } catch {
      setError(t.connect.genericError);
    } finally {
      setBusy(false);
    }
  };

  const inputClass =
    "w-full rounded-xl border border-ringo-border bg-ringo-surface px-4 py-3 text-base text-ringo-text placeholder:text-ringo-muted/60 focus:outline-none focus:ring-2";

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="connect-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 36 }}
            role="dialog"
            aria-modal="true"
            aria-label={t.connect.modalTitle}
            className="relative w-full max-h-[92vh] overflow-y-auto rounded-t-3xl bg-ringo-surface p-6 text-ringo-text shadow-2xl sm:max-w-md sm:rounded-3xl"
            style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}
          >
            <button
              onClick={onClose}
              aria-label={t.connect.close}
              className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-ringo-muted hover:bg-ringo-muted/10 transition"
            >
              <X size={16} />
            </button>

            {step === "form" && (
              <form
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!busy) submitForm();
                }}
              >
                <div className="pr-8">
                  <h2 className="text-xl font-semibold">{t.connect.modalTitle}</h2>
                  <p className="mt-1.5 text-sm text-ringo-muted">{t.connect.modalBody(profile.name)}</p>
                </div>

                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium">{t.connect.nameLabel}</span>
                  <input
                    className={inputClass}
                    style={{ ["--tw-ring-color" as any]: accent }}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t.connect.namePlaceholder}
                    autoComplete="name"
                    maxLength={120}
                    autoFocus
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium">{t.connect.phoneLabel}</span>
                  <input
                    className={inputClass}
                    style={{ ["--tw-ring-color" as any]: accent }}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder={t.connect.phonePlaceholder}
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    maxLength={40}
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium">{t.connect.emailLabel}</span>
                  <input
                    className={inputClass}
                    style={{ ["--tw-ring-color" as any]: accent }}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t.connect.emailPlaceholder}
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    maxLength={200}
                  />
                </label>

                {/* Honeypot — hidden from people and assistive tech, named to
                    look legitimate to a bot. Any value silently discards the
                    submission server-side. */}
                <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", height: 0, overflow: "hidden" }}>
                  <input tabIndex={-1} autoComplete="off" name="website" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
                </div>

                <label className="flex items-start gap-3 rounded-xl border border-ringo-border/70 p-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={marketing}
                    onChange={(e) => setMarketing(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0"
                    style={{ accentColor: accent }}
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm">{t.connect.marketingLabel}</span>
                    <span className="text-xs text-ringo-muted">{t.connect.marketingHint}</span>
                  </span>
                </label>

                {error && (
                  <p role="alert" className="text-sm text-red-600">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={busy}
                  className="flex items-center justify-center gap-2 rounded-xl px-5 py-3.5 text-base font-semibold text-white transition active:scale-[0.98] disabled:opacity-60"
                  style={{ backgroundColor: accent }}
                >
                  {busy && <Loader2 size={16} className="animate-spin" />}
                  {busy ? t.connect.sending : t.connect.submit}
                </button>
              </form>
            )}

            {step === "code" && (
              <form
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!busy) confirmCode();
                }}
              >
                <div className="pr-8">
                  <h2 className="text-xl font-semibold">{t.connect.codeTitle}</h2>
                  {existingAccount && <p className="mt-1.5 text-sm font-medium text-ringo-text">{t.myRingo.account.existingAccountNote}</p>}
                  <p className="mt-1.5 text-sm text-ringo-muted">{t.connect.codeBody(email.trim())}</p>
                </div>

                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium">{t.connect.codeLabel}</span>
                  <input
                    className={`${inputClass} text-center text-2xl font-semibold tracking-[0.4em]`}
                    style={{ ["--tw-ring-color" as any]: accent }}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder={t.connect.codePlaceholder}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    autoFocus
                  />
                </label>

                {error && (
                  <p role="alert" className="text-sm text-red-600">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={busy || code.length !== 6}
                  className="flex items-center justify-center gap-2 rounded-xl px-5 py-3.5 text-base font-semibold text-white transition active:scale-[0.98] disabled:opacity-60"
                  style={{ backgroundColor: accent }}
                >
                  {busy && <Loader2 size={16} className="animate-spin" />}
                  {busy ? t.connect.verifying : t.connect.verify}
                </button>

                <div className="flex items-center justify-between text-sm">
                  <button type="button" onClick={sendCode} disabled={busy} className="text-ringo-muted hover:underline disabled:opacity-50">
                    {t.connect.resend}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setError("");
                      setStep("form");
                    }}
                    className="text-ringo-muted hover:underline"
                  >
                    {t.connect.backToForm}
                  </button>
                </div>
              </form>
            )}

            {step === "done" && (
              <div className="flex flex-col gap-4 text-center">
                <div
                  className="mx-auto mt-2 flex h-14 w-14 items-center justify-center rounded-full text-white"
                  style={{ backgroundColor: accent }}
                >
                  <Check size={28} />
                </div>
                <div>
                  <h2 className="text-xl font-semibold">{t.connect.successTitle}</h2>
                  <p className="mt-1.5 text-sm text-ringo-muted">{t.connect.successBody(profile.name)}</p>
                </div>
                <ConnectedNotificationsPrompt profileName={profile.name} accent={accent} onDone={onClose} />
                {/* A plain link, never an automatic redirect — browsing on
                    this profile stays undisturbed. */}
                <a href="/my-ringo" className="text-sm font-medium hover:underline" style={{ color: accent }}>
                  {t.myRingo.openMyRingo} →
                </a>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
