"use client";

import { useEffect, useRef, useState } from "react";
import { X, Loader2, CheckCircle2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { formatPrice } from "@/lib/currency";

type Step = "form" | "processing" | "success" | "error";

// Existing-user purchase path for a Card + Subscription bundle — same
// Mobile Money direct-pay + poll pattern UpgradeModal.tsx already uses for
// plan upgrades (phone + provider → /api/ringo-cards/bundle/initiate →
// poll the existing, generic /api/billing/fapshi/status/[transId]), just
// simpler: bundles are Fapshi/Mobile-Money only, no card/Stripe branch.
export default function BundlePurchaseModal({
  addonId,
  name,
  priceXaf,
  onClose,
  onSuccess,
}: {
  addonId: string;
  name: string;
  priceXaf: number;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t, locale } = useLanguage();
  const [step, setStep] = useState<Step>("form");
  const [phone, setPhone] = useState("");
  const [medium, setMedium] = useState<"mobile money" | "orange money">("mobile money");
  const [error, setError] = useState("");
  const pollTimer = useRef<ReturnType<typeof setInterval>>();
  const pollAttempts = useRef(0);

  useEffect(() => () => clearInterval(pollTimer.current), []);

  const pollStatus = (transId: string) => {
    pollTimer.current = setInterval(async () => {
      pollAttempts.current += 1;
      try {
        const res = await fetch(`/api/billing/fapshi/status/${transId}`);
        const data = await res.json();
        if (data.status === "SUCCESSFUL") {
          clearInterval(pollTimer.current);
          setStep("success");
        } else if (data.status === "FAILED" || data.status === "EXPIRED") {
          clearInterval(pollTimer.current);
          setError(t.subscription.paymentFailed);
          setStep("error");
        } else if (pollAttempts.current > 40) {
          clearInterval(pollTimer.current);
          setError(t.subscription.paymentFailed);
          setStep("error");
        }
      } catch {
        // transient network error — keep polling, next tick may succeed
      }
    }, 3000);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStep("processing");
    setError("");
    try {
      const res = await fetch("/api/ringo-cards/bundle/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addonId, phone, medium }),
      });
      const data = await res.json();
      if (!res.ok || !data.transId) throw new Error(data.error || "Could not start payment");
      pollAttempts.current = 0;
      pollStatus(data.transId);
    } catch (err: any) {
      setError(err.message);
      setStep("error");
    }
  };

  const closable = step !== "processing";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/40" onClick={closable ? onClose : undefined} />
      <div className="relative w-full max-w-sm rounded-card bg-ringo-surface border border-ringo-border p-6">
        {closable && (
          <button onClick={onClose} aria-label="Close" className="absolute right-4 top-4 text-ringo-muted hover:text-ringo-text">
            <X size={18} />
          </button>
        )}

        {step === "form" && (
          <form onSubmit={submit}>
            <h2 className="font-display text-lg font-medium text-ringo-text mb-1">{name}</h2>
            <p className="text-sm text-ringo-muted mb-4" suppressHydrationWarning>
              {formatPrice(priceXaf, "XAF", locale)}
            </p>

            <label className="block mb-3">
              <span className="text-xs font-medium text-ringo-text">{t.subscription.selectProvider}</span>
              <div className="flex gap-2 mt-1.5">
                {(["mobile money", "orange money"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMedium(m)}
                    className={`flex-1 text-xs py-2 rounded-card border transition ${
                      medium === m ? "border-ringo-indigo text-ringo-indigo bg-ringo-indigo/5" : "border-ringo-border text-ringo-muted"
                    }`}
                  >
                    {m === "mobile money" ? t.subscription.mtnMomo : t.subscription.orangeMoney}
                  </button>
                ))}
              </div>
            </label>

            <label className="block mb-5">
              <span className="text-xs font-medium text-ringo-text">{t.subscription.phoneNumber}</span>
              <input
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={t.subscription.phonePlaceholder}
                inputMode="tel"
                className="w-full mt-1.5 border border-ringo-border rounded-card px-3 py-2.5 text-sm bg-ringo-bg text-ringo-text"
              />
            </label>

            {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

            <button type="submit" className="w-full rounded-card bg-ringo-indigo text-white text-sm font-medium py-2.5">
              {t.subscription.payNow}
            </button>
          </form>
        )}

        {step === "processing" && (
          <div className="flex flex-col items-center text-center py-6 gap-3">
            <Loader2 size={28} className="animate-spin text-ringo-indigo" />
            <p className="text-sm font-medium text-ringo-text">{t.subscription.waitingForConfirmation}</p>
            <p className="text-xs text-ringo-muted max-w-[220px]">{t.subscription.checkPhoneDesc}</p>
          </div>
        )}

        {step === "success" && (
          <div className="flex flex-col items-center text-center gap-2 py-4">
            <span className="w-14 h-14 rounded-full bg-ringo-teal/10 flex items-center justify-center mb-1">
              <CheckCircle2 size={30} className="text-ringo-teal" />
            </span>
            <p className="font-display text-lg font-medium text-ringo-text">{t.subscription.paymentSuccess}</p>
            <p className="text-sm text-ringo-muted mb-3">We'll be in touch to arrange delivery of your Ringo Card.</p>
            <button onClick={onSuccess} className="w-full rounded-card bg-ringo-indigo text-white text-sm font-medium py-2.5">
              {t.subscription.done}
            </button>
          </div>
        )}

        {step === "error" && (
          <div className="flex flex-col items-center text-center py-4 gap-3">
            <p className="text-sm text-red-500">{error || t.subscription.paymentFailed}</p>
            <button onClick={() => setStep("form")} className="w-full rounded-card border border-ringo-border text-sm font-medium py-2.5">
              {t.subscription.tryAgain}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
