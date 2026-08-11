"use client";

import { useState } from "react";
import { CreditCard, Loader2, CheckCircle2, X } from "lucide-react";

type Step = "confirm" | "processing" | "success" | "error";

export default function FlutterwaveSimulateModal({
  planName,
  price,
  onClose,
  onSuccess,
}: {
  planName: string;
  price: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [step, setStep] = useState<Step>("confirm");

  const handlePay = async () => {
    setStep("processing");
    try {
      const res = await fetch("/api/billing/upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planName: planName.toLowerCase() }),
      });
      if (!res.ok) throw new Error();
      setStep("success");
      setTimeout(onSuccess, 1100);
    } catch {
      setStep("error");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-sm bg-ringo-surface rounded-card border border-ringo-border overflow-hidden">
        {/* Header styled like a Flutterwave checkout — swap this whole
            component for the real Flutterwave inline/redirect widget when
            going live; the API contract (onSuccess) stays the same. */}
        <div className="bg-[#0B1023] px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-white">
            <CreditCard size={16} />
            <span className="text-sm font-medium">Flutterwave Checkout (simulated)</span>
          </div>
          {step !== "processing" && (
            <button onClick={onClose} aria-label="Close" className="text-white/60 hover:text-white">
              <X size={16} />
            </button>
          )}
        </div>

        <div className="p-6 text-center">
          {step === "confirm" && (
            <>
              <p className="text-sm text-ringo-muted mb-1">Upgrade to</p>
              <p className="font-display text-xl font-medium text-ringo-text mb-1">{planName}</p>
              <p className="text-2xl font-medium text-ringo-indigo mb-6">{price}</p>
              <button
                onClick={handlePay}
                className="w-full rounded-card bg-ringo-indigo text-white text-sm font-medium py-2.5 mb-2"
              >
                Pay with Flutterwave
              </button>
              <button onClick={onClose} className="text-xs text-ringo-muted hover:underline">
                Cancel
              </button>
              <p className="text-[11px] text-ringo-muted/70 mt-4">
                This is a simulated payment for development — no real charge occurs.
              </p>
            </>
          )}

          {step === "processing" && (
            <div className="py-6 flex flex-col items-center gap-3">
              <Loader2 size={28} className="animate-spin text-ringo-indigo" />
              <p className="text-sm text-ringo-muted">Confirming your payment…</p>
            </div>
          )}

          {step === "success" && (
            <div className="py-6 flex flex-col items-center gap-3">
              <CheckCircle2 size={32} className="text-ringo-teal" />
              <p className="text-sm font-medium text-ringo-text">You're on {planName} now</p>
            </div>
          )}

          {step === "error" && (
            <div className="py-4 flex flex-col items-center gap-3">
              <p className="text-sm text-red-500">Something went wrong. Please try again.</p>
              <button
                onClick={() => setStep("confirm")}
                className="text-xs text-ringo-indigo font-medium hover:underline"
              >
                Try again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}