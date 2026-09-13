"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { BadgeCheck, Clock, RotateCcw, X, Loader2, type LucideIcon } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

type RequestRow = { status: "pending" | "approved" | "rejected"; full_name: string; phone_number: string; location: string } | null;

// The "Request verification" flow, opened from AvatarMenu's profile
// menu — a small form (real name, phone, location) feeding the admin
// review queue at /admin/verification (see
// src/app/api/verification/request/route.ts). A full-screen modal
// rather than a small anchored dropdown, same reasoning as ShareButton's
// QR modal: a form needs real room, and — since AvatarMenu lives inside
// the header's own backdrop-blur, which makes the header a containing
// block for `position: fixed` descendants (see MenuBackdrop.tsx's own
// comment on this) — it's portaled straight to document.body so it's
// always sized against the true viewport.
//
// On open it fetches the account's current status and renders whichever
// of four states applies: already verified, a request awaiting review, a
// rejected request (with a "try again" that reopens the form, prefilled
// with what was submitted before), or the form itself.
export default function VerificationRequestModal({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [verified, setVerified] = useState(false);
  const [existing, setExisting] = useState<RequestRow>(null);
  const [showForm, setShowForm] = useState(false);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/verification/request");
        const data = await res.json();
        if (cancelled) return;
        setVerified(!!data.verified);
        setExisting(data.request || null);
        if (data.request) {
          setFullName(data.request.full_name || "");
          setPhone(data.request.phone_number || "");
          setLocation(data.request.location || "");
        }
      } catch {
        if (!cancelled) setError(t.verification.genericError);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    if (!fullName.trim() || !phone.trim() || !location.trim()) {
      setError(t.verification.fieldsRequired);
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/verification/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name: fullName.trim(), phone_number: phone.trim(), location: location.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "failed");
      setExisting(data.request);
      setShowForm(false);
    } catch (err: any) {
      setError(err?.message && err.message !== "failed" ? err.message : t.verification.genericError);
    } finally {
      setSubmitting(false);
    }
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
        aria-label={t.verification.title}
        className="relative w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl bg-ringo-surface p-5 sm:p-6 flex flex-col gap-4 max-h-[88vh] overflow-y-auto"
      >
        <button
          onClick={onClose}
          aria-label={t.verification.close}
          className="absolute right-4 top-4 w-8 h-8 rounded-full flex items-center justify-center text-ringo-muted hover:bg-ringo-muted/10 transition"
        >
          <X size={15} />
        </button>

        <span className="w-11 h-11 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
          <BadgeCheck size={20} className="text-blue-500" />
        </span>

        {loading ? (
          <div className="py-8 flex items-center justify-center">
            <Loader2 size={20} className="animate-spin text-ringo-muted" />
          </div>
        ) : verified ? (
          <StatusBlock title={t.verification.verifiedTitle} body={t.verification.verifiedBody} tone="blue" icon={BadgeCheck} />
        ) : existing?.status === "pending" ? (
          <StatusBlock title={t.verification.pendingTitle} body={t.verification.pendingBody} tone="indigo" icon={Clock} />
        ) : existing?.status === "rejected" && !showForm ? (
          <>
            <StatusBlock title={t.verification.rejectedTitle} body={t.verification.rejectedBody} tone="coral" icon={RotateCcw} />
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-full text-sm font-semibold bg-ringo-indigo text-white hover:brightness-110 active:scale-[0.98] transition"
            >
              {t.verification.resubmit}
            </button>
          </>
        ) : (
          <>
            <div>
              <h2 className="font-display text-lg font-semibold text-ringo-text pr-8">{t.verification.title}</h2>
              <p className="text-sm text-ringo-muted mt-1 leading-relaxed">{t.verification.subtitle}</p>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
              className="flex flex-col gap-3"
            >
              <Field label={t.verification.fullName}>
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder={t.verification.fullNamePlaceholder}
                  disabled={submitting}
                  className="w-full text-sm border border-ringo-border rounded-card px-3 py-2.5 bg-ringo-bg text-ringo-text disabled:opacity-60"
                />
              </Field>
              <Field label={t.verification.phone}>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder={t.verification.phonePlaceholder}
                  disabled={submitting}
                  className="w-full text-sm border border-ringo-border rounded-card px-3 py-2.5 bg-ringo-bg text-ringo-text disabled:opacity-60"
                />
              </Field>
              <Field label={t.verification.location}>
                <input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder={t.verification.locationPlaceholder}
                  disabled={submitting}
                  className="w-full text-sm border border-ringo-border rounded-card px-3 py-2.5 bg-ringo-bg text-ringo-text disabled:opacity-60"
                />
              </Field>

              <AnimatePresence>
                {error && (
                  <motion.p
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="text-xs text-ringo-coral"
                  >
                    {error}
                  </motion.p>
                )}
              </AnimatePresence>

              <button
                type="submit"
                disabled={submitting}
                className="flex items-center justify-center gap-2 w-full py-2.5 mt-1 rounded-full text-sm font-semibold bg-ringo-indigo text-white hover:brightness-110 active:scale-[0.98] transition disabled:opacity-70"
              >
                {submitting && <Loader2 size={15} className="animate-spin" />}
                {submitting ? t.verification.submitting : t.verification.submit}
              </button>
            </form>
          </>
        )}
      </motion.div>
    </div>,
    document.body
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-ringo-muted">{label}</span>
      {children}
    </label>
  );
}

function StatusBlock({
  title,
  body,
  tone,
  icon: Icon,
}: {
  title: string;
  body: string;
  tone: "blue" | "indigo" | "coral";
  icon: LucideIcon;
}) {
  const toneClass = tone === "blue" ? "text-blue-500" : tone === "indigo" ? "text-ringo-indigo" : "text-ringo-coral";
  return (
    <div className="flex flex-col gap-1">
      <p className={`text-sm font-semibold flex items-center gap-1.5 ${toneClass}`}>
        <Icon size={15} />
        {title}
      </p>
      <p className="text-sm text-ringo-muted leading-relaxed">{body}</p>
    </div>
  );
}
