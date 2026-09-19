"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Loader2, X } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

type Step = "intro" | "code" | "done";

// OPTIONAL email confirmation for a signed-in customer. The address always comes
// from the session on the server — this dialog only ever sends a code request and
// the six digits. Confirming or skipping changes nothing about how the account
// works (the copy says so).
export default function ConfirmEmailDialog({
  email,
  onClose,
  onConfirmed,
}: {
  email: string;
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const { t, locale } = useLanguage();
  const [step, setStep] = useState<Step>("intro");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const messageFor = (code: string | undefined) => {
    switch (code) {
      case "cooldown":
        return t.connect.resendWait;
      case "rate_limited":
        return t.connect.tooManyRequests;
      case "email_failed":
        return t.connect.emailSendFailed;
      case "invalid_code":
        return t.connect.codeInvalid;
      default:
        return t.connect.genericError;
    }
  };

  const post = async (url: string, payload: Record<string, unknown>) => {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (res.status === 401) {
      window.location.replace("/my-ringo/signin");
      return { ok: false, data: null as any };
    }
    return { ok: res.ok, data: await res.json().catch(() => null) };
  };

  const sendCode = async () => {
    setBusy(true);
    setError("");
    try {
      const { ok, data } = await post("/api/customer/email/send-code", { language: locale });
      if (!ok) return setError(messageFor(data?.error));
      if (data?.already) {
        onConfirmed();
        return setStep("done");
      }
      setCode("");
      setStep("code");
    } catch {
      setError(t.connect.genericError);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!/^\d{6}$/.test(code.trim())) return setError(t.connect.codeInvalid);
    setBusy(true);
    setError("");
    try {
      const { ok, data } = await post("/api/customer/email/confirm", { code: code.trim() });
      if (!ok) return setError(messageFor(data?.error));
      onConfirmed();
      setStep("done");
    } catch {
      setError(t.connect.genericError);
    } finally {
      setBusy(false);
    }
  };

  const primary =
    "flex w-full items-center justify-center gap-2 rounded-xl bg-ringo-indigo px-5 py-3 text-sm font-semibold text-white transition active:scale-[0.98] disabled:opacity-60";

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-4 sm:items-center"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-email-title"
        className="relative w-full max-w-sm rounded-3xl bg-ringo-surface p-6 text-ringo-text shadow-2xl"
        style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}
      >
        <button
          onClick={onClose}
          aria-label={t.connect.close}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-ringo-muted hover:bg-ringo-muted/10 transition"
        >
          <X size={16} />
        </button>

        {step === "intro" && (
          <div className="flex flex-col gap-4">
            <div className="pr-8">
              <h2 id="confirm-email-title" className="text-lg font-semibold">
                {t.myRingo.account.confirmTitle}
              </h2>
              <p className="mt-1.5 text-sm text-ringo-muted">{t.myRingo.account.confirmBody(email)}</p>
              <p className="mt-2 text-xs text-ringo-muted">{t.myRingo.account.optionalNote}</p>
            </div>
            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}
            <button onClick={sendCode} disabled={busy} className={primary}>
              {busy && <Loader2 size={15} className="animate-spin" />}
              {busy ? t.connect.sending : t.myRingo.account.sendCode}
            </button>
          </div>
        )}

        {step === "code" && (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy) confirm();
            }}
          >
            <div className="pr-8">
              <h2 id="confirm-email-title" className="text-lg font-semibold">
                {t.connect.codeTitle}
              </h2>
              <p className="mt-1.5 text-sm text-ringo-muted">{t.myRingo.account.codeSent(email)}</p>
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium">{t.connect.codeLabel}</span>
              <input
                className="w-full rounded-xl border border-ringo-border bg-ringo-surface px-4 py-3 text-center text-2xl font-semibold tracking-[0.4em] text-ringo-text placeholder:text-ringo-muted/60 focus:outline-none focus:ring-2 focus:ring-ringo-indigo"
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
            <button type="submit" disabled={busy || code.length !== 6} className={primary}>
              {busy && <Loader2 size={15} className="animate-spin" />}
              {busy ? t.connect.verifying : t.connect.verify}
            </button>
            <button type="button" onClick={sendCode} disabled={busy} className="text-sm text-ringo-muted hover:underline disabled:opacity-50">
              {t.connect.resend}
            </button>
          </form>
        )}

        {step === "done" && (
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
              <Check size={28} />
            </span>
            <h2 id="confirm-email-title" className="text-lg font-semibold">
              {t.myRingo.account.confirmedTitle}
            </h2>
            <p className="text-sm text-ringo-muted">{t.myRingo.account.confirmedBody}</p>
            <button onClick={onClose} className={`${primary} mt-2`}>
              {t.connect.done}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
