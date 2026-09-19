"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

// Confirmation before disconnecting. The request carries only the profile
// id; the server identifies the customer from the session cookie. Nothing is
// deleted — purchases, receipts and history stay (the copy says so).
export default function DisconnectDialog({
  profile,
  onClose,
  onDisconnected,
}: {
  profile: { id: string; name: string };
  onClose: () => void;
  onDisconnected: (profileId: string) => void;
}) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const confirm = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/customer/connections/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile_id: profile.id }),
      });
      if (res.status === 401) return window.location.replace("/my-ringo/signin");
      if (!res.ok) return setError(t.myRingo.disconnect.failed);
      onDisconnected(profile.id);
    } catch {
      setError(t.myRingo.disconnect.failed);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-4 sm:items-center"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="disconnect-title"
        className="w-full max-w-sm rounded-3xl bg-ringo-surface p-6 text-ringo-text shadow-2xl"
        style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}
      >
        <h2 id="disconnect-title" className="text-lg font-semibold">
          {t.myRingo.disconnect.title(profile.name)}
        </h2>
        <p className="mt-2 text-sm text-ringo-muted">{t.myRingo.disconnect.body}</p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {error}
          </p>
        )}
        <div className="mt-5 flex gap-2.5">
          <button
            onClick={onClose}
            disabled={busy}
            autoFocus
            className="flex-1 rounded-xl border border-ringo-border px-4 py-3 text-sm font-medium transition hover:bg-ringo-muted/10 disabled:opacity-50"
          >
            {t.myRingo.disconnect.cancel}
          </button>
          <button
            onClick={confirm}
            disabled={busy}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-red-700 active:scale-[0.98] disabled:opacity-60"
          >
            {busy && <Loader2 size={15} className="animate-spin" />}
            {busy ? t.myRingo.disconnect.working : t.myRingo.disconnect.confirm}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
