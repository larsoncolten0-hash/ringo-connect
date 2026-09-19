"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

const EMAIL_RE = /^[^\s@<>,;"()]+@[^\s@<>,;"()]+\.[^\s@<>,;"()]+$/;

// My Ringo sign-in for an existing customer (e.g. on a new phone): email →
// emailed code → session cookie → /my-ringo. Uses /api/customer/signin/*,
// which share the Connect flow's code table, atomic verification and session
// code — there is no second auth system, and it never creates a customer.
export default function SignInForm() {
  const { t, locale } = useLanguage();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const inputClass =
    "w-full rounded-xl border border-ringo-border bg-ringo-surface px-4 py-3 text-base text-ringo-text placeholder:text-ringo-muted/60 focus:outline-none focus:ring-2 focus:ring-ringo-indigo";

  const sendCode = async () => {
    setError("");
    if (!EMAIL_RE.test(email.trim())) return setError(t.connect.emailInvalid);
    setBusy(true);
    try {
      const res = await fetch("/api/customer/signin/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), language: locale, website: honeypot }),
      });
      const data = await res.json().catch(() => null);
      if (res.status === 429) return setError(data?.error === "cooldown" ? t.connect.resendWait : t.connect.tooManyRequests);
      if (!res.ok) return setError(data?.error === "invalid_email" ? t.connect.emailInvalid : t.connect.genericError);
      setCode("");
      setStep("code");
    } catch {
      setError(t.connect.genericError);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setError("");
    if (!/^\d{6}$/.test(code.trim())) return setError(t.connect.codeInvalid);
    setBusy(true);
    try {
      const res = await fetch("/api/customer/signin/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), code: code.trim() }),
      });
      if (!res.ok) return setError(t.connect.codeInvalid);
      // Full navigation so the server renders /my-ringo with the new cookie.
      window.location.replace("/my-ringo");
    } catch {
      setError(t.connect.genericError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full max-w-sm rounded-3xl border border-ringo-border/70 bg-ringo-surface p-6 shadow-sm">
      {step === "email" ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) sendCode();
          }}
        >
          <div>
            <h1 className="font-display text-xl font-bold text-ringo-text">{t.myRingo.signin.title}</h1>
            <p className="mt-1.5 text-sm text-ringo-muted">{t.myRingo.signin.body}</p>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ringo-text">{t.connect.emailLabel}</span>
            <input
              className={inputClass}
              type="email"
              inputMode="email"
              autoComplete="email"
              autoFocus
              maxLength={200}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t.connect.emailPlaceholder}
            />
          </label>
          <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", height: 0, overflow: "hidden" }}>
            <input tabIndex={-1} autoComplete="off" name="website" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
          </div>
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="flex items-center justify-center gap-2 rounded-xl bg-ringo-indigo px-5 py-3.5 text-base font-semibold text-white transition active:scale-[0.98] disabled:opacity-60"
          >
            {busy && <Loader2 size={16} className="animate-spin" />}
            {busy ? t.connect.sending : t.myRingo.signin.sendCode}
          </button>
          <p className="text-center text-xs text-ringo-muted">{t.myRingo.signin.newHere}</p>
        </form>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) confirm();
          }}
        >
          <div>
            <h1 className="font-display text-xl font-bold text-ringo-text">{t.connect.codeTitle}</h1>
            <p className="mt-1.5 text-sm text-ringo-muted">{t.connect.codeBody(email.trim())}</p>
            <p className="mt-1 text-xs text-ringo-muted">{t.myRingo.signin.sentNote}</p>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ringo-text">{t.connect.codeLabel}</span>
            <input
              className={`${inputClass} text-center text-2xl font-semibold tracking-[0.4em]`}
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder={t.connect.codePlaceholder}
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
            className="flex items-center justify-center gap-2 rounded-xl bg-ringo-indigo px-5 py-3.5 text-base font-semibold text-white transition active:scale-[0.98] disabled:opacity-60"
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
                setStep("email");
              }}
              className="text-ringo-muted hover:underline"
            >
              {t.connect.backToForm}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
