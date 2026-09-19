"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, ShieldCheck, X } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { api } from "@/components/loyalty/format";

// My Ringo -> My QR. The QR arrives as a ready-made SVG drawn on the server for the signed-in
// customer: the code text itself is never given to this component, never shown, and contains no
// name, email, phone or customer id (see src/lib/loyalty/qrCrypto.ts). Regenerating replaces the
// code only; connections, rewards, packages and history are untouched.
export default function MyQrView({ svg }: { svg: string | null }) {
  const { t } = useLanguage();
  const q = t.myRingo.loyalty.qr;
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function regenerate() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const res = await api("/api/customer/loyalty/qr/regenerate", { method: "POST", body: {} });
    setBusy(false);
    setConfirming(false);
    if (res.status === 200) {
      setMessage({ kind: "ok", text: q.done });
      router.refresh(); // the server draws the new code
    } else {
      setMessage({ kind: "error", text: res.status === 429 ? q.tooMany : q.failed });
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-ringo-text">{q.title}</h1>
        <p className="mt-1 text-sm text-ringo-muted">{q.subtitle}</p>
      </div>

      <section className="flex flex-col items-center gap-4 rounded-3xl border border-ringo-border/70 bg-ringo-surface p-5">
        {svg ? (
          <div
            role="img"
            aria-label={q.alt}
            className="w-full max-w-[18rem] overflow-hidden rounded-2xl bg-white p-3 shadow-sm [&>svg]:h-auto [&>svg]:w-full"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <p role="alert" className="rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-700">
            {q.unavailable}
          </p>
        )}
        <p className="text-xs text-ringo-muted">{q.tip}</p>
      </section>

      <section className="flex gap-3 rounded-2xl border border-ringo-border/70 bg-ringo-surface p-4">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600">
          <ShieldCheck size={18} />
        </span>
        <div>
          <p className="text-sm font-semibold text-ringo-text">{q.privacyTitle}</p>
          <p className="mt-1 text-sm text-ringo-muted">{q.privacyBody}</p>
        </div>
      </section>

      <div aria-live="polite" role="status">
        {message && (
          <p className={`rounded-xl px-4 py-3 text-sm font-medium ${message.kind === "ok" ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-500"}`}>{message.text}</p>
        )}
      </div>

      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={busy || !svg}
        className="inline-flex items-center justify-center gap-2 self-start rounded-xl border border-ringo-border px-4 py-2.5 text-sm font-medium text-ringo-text transition hover:border-ringo-indigo/40 disabled:opacity-50"
      >
        <RefreshCw size={15} /> {q.regenerate}
      </button>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label={q.confirmTitle}>
          <div className="w-full max-w-md rounded-2xl bg-ringo-surface p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-base font-bold text-ringo-text">{q.confirmTitle}</h2>
              <button type="button" aria-label={q.cancel} onClick={() => setConfirming(false)} className="text-ringo-muted">
                <X size={18} />
              </button>
            </div>
            <p className="mt-2 text-sm text-ringo-muted">{q.confirmBody}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirming(false)} disabled={busy} className="rounded-xl border border-ringo-border px-4 py-2.5 text-sm font-medium text-ringo-text">
                {q.cancel}
              </button>
              <button
                type="button"
                onClick={regenerate}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-xl bg-ringo-indigo px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy ? (
                  <>
                    <Loader2 size={15} className="animate-spin" /> {q.working}
                  </>
                ) : (
                  q.confirm
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
