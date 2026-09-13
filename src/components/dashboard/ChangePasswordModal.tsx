"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { KeyRound, Mail, X, Loader2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { createClient } from "@/lib/supabase/client";

// The profile menu's "Change password" action — deliberately doesn't ask
// for a new password here at all. It sends the exact same recovery email
// /auth/forgot-password already sends (same `resetPasswordForEmail`
// call, same redirect target), so there's only ever one password-setting
// flow in this app (/auth/reset-password) rather than a second inline
// current/new-password form to keep in sync with it — and, same as most
// systems that offer this from inside an account menu, requiring the
// emailed link (not just being logged in) means a stolen/left-open
// session alone can't silently take over the password.
//
// A full-screen modal rather than a small anchored dropdown — same
// reasoning as VerificationRequestModal — and portaled to document.body
// for the same reason: AvatarMenu lives inside the header's own
// backdrop-blur, which makes the header a containing block for
// `position: fixed` descendants (see MenuBackdrop.tsx's comment), so a
// same-place modal would be sized against that instead of the viewport.
export default function ChangePasswordModal({ email, onClose }: { email: string; onClose: () => void }) {
  const { t } = useLanguage();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const sendLink = async () => {
    setSending(true);
    setError("");
    const supabase = createClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    });
    setSending(false);
    if (resetError) {
      setError(t.changePassword.error);
      return;
    }
    setSent(true);
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
        aria-hidden="true"
      />
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 24 }}
        transition={{ type: "spring", stiffness: 420, damping: 38 }}
        role="dialog"
        aria-modal="true"
        aria-label={t.changePassword.title}
        className="relative w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl bg-ringo-surface p-5 sm:p-6 flex flex-col gap-4"
      >
        <button
          onClick={onClose}
          aria-label={t.changePassword.close}
          className="absolute right-4 top-4 w-8 h-8 rounded-full flex items-center justify-center text-ringo-muted hover:bg-ringo-muted/10 transition"
        >
          <X size={15} />
        </button>

        <span className="w-11 h-11 rounded-full bg-ringo-indigo/10 flex items-center justify-center shrink-0">
          {sent ? <Mail size={20} className="text-ringo-indigo" /> : <KeyRound size={20} className="text-ringo-indigo" />}
        </span>

        {sent ? (
          <div className="flex flex-col gap-3">
            <div>
              <h2 className="font-display text-lg font-semibold text-ringo-text pr-8">{t.changePassword.sentTitle}</h2>
              <p className="text-sm text-ringo-muted mt-1 leading-relaxed">
                {t.changePassword.sentBody} <strong className="text-ringo-text">{email}</strong>.
              </p>
            </div>
            <button
              onClick={sendLink}
              disabled={sending}
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-full text-sm font-semibold border border-ringo-border text-ringo-text hover:bg-ringo-muted/10 transition disabled:opacity-60"
            >
              {sending && <Loader2 size={15} className="animate-spin" />}
              {t.changePassword.resend}
            </button>
          </div>
        ) : (
          <>
            <div>
              <h2 className="font-display text-lg font-semibold text-ringo-text pr-8">{t.changePassword.title}</h2>
              <p className="text-sm text-ringo-muted mt-1 leading-relaxed">{t.changePassword.subtitle}</p>
            </div>

            {error && <p className="text-xs text-ringo-coral">{error}</p>}

            <button
              onClick={sendLink}
              disabled={sending}
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-full text-sm font-semibold bg-ringo-indigo text-white hover:brightness-110 active:scale-[0.98] transition disabled:opacity-70"
            >
              {sending && <Loader2 size={15} className="animate-spin" />}
              {sending ? t.changePassword.sending : t.changePassword.sendCta}
            </button>
          </>
        )}
      </motion.div>
    </div>,
    document.body
  );
}
