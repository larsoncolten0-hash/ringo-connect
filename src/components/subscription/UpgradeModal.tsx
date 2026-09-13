"use client";

import { useEffect, useRef, useState } from "react";
import { Smartphone, CreditCard, Loader2, CheckCircle2, X, ArrowLeft, Hash, CalendarDays, Copy, Check } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { formatPrice } from "@/lib/currency";

type Method = "mobile_money" | "card";
type Interval = "monthly" | "yearly";
type Step = "choose" | "mm-form" | "mm-processing" | "mm-success" | "mm-error" | "card-redirecting" | "card-error";

export default function UpgradeModal({
  planName,
  priceXaf: priceXafMonthlyRaw,
  priceUsd: priceUsdMonthlyRaw,
  priceXafYearly: priceXafYearlyRaw,
  priceUsdYearly: priceUsdYearlyRaw,
  defaultMethod,
  defaultInterval = "monthly",
  isCameroon = false,
  fapshiEnabled = true,
  stripeEnabled = true,
  onClose,
  onSuccess,
  __previewStep,
  __previewReceipt,
}: {
  planName: "basic" | "pro" | "business";
  priceXaf: number;
  priceUsd: number;
  priceXafYearly: number;
  priceUsdYearly: number;
  defaultMethod: Method;
  defaultInterval?: Interval;
  // Which single method to actually offer: Mobile Money in Cameroon, card
  // everywhere else — no picking between the two, since a card is
  // normally unusable for a Cameroon Mobile Money line and vice versa.
  // Only falls back to the other one if the admin has turned off the
  // method this location would otherwise get (see `methods` below), so
  // there's still always at least one working option rather than a dead
  // modal.
  isCameroon?: boolean;
  fapshiEnabled?: boolean;
  stripeEnabled?: boolean;
  onClose: () => void;
  onSuccess: () => void;
  // TEMP — visual QA only, lets a throwaway preview page force this modal
  // straight to the receipt step without a real payment. Not wired up
  // from anywhere in the real app. Remove once the redesign is verified.
  __previewStep?: Step;
  __previewReceipt?: { transId: string; amount: number; medium: string; date: string };
}) {
  const { t, locale } = useLanguage();
  const [step, setStep] = useState<Step>(__previewStep ?? "choose");
  const [method, setMethod] = useState<Method>(defaultMethod);
  const [billingInterval, setBillingInterval] = useState<Interval>(defaultInterval);
  const [phone, setPhone] = useState("");
  const [medium, setMedium] = useState<"mobile money" | "orange money">("mobile money");
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<{ transId: string; amount: number; medium: string; date: string } | null>(
    __previewReceipt ?? null
  );
  const [copied, setCopied] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval>>();
  const pollAttempts = useRef(0);

  useEffect(() => () => clearInterval(pollTimer.current), []);

  const priceXaf = formatPrice(billingInterval === "yearly" ? priceXafYearlyRaw : priceXafMonthlyRaw, "XAF");
  const priceUsd = formatPrice(billingInterval === "yearly" ? priceUsdYearlyRaw : priceUsdMonthlyRaw, "USD");

  // Location decides which single method is offered — Mobile Money only
  // in Cameroon, card only abroad. If that location's own method has been
  // switched off platform-wide, fall back to whichever one is actually
  // enabled rather than showing a method nobody can complete.
  const locationPreferred: Method = isCameroon ? "mobile_money" : "card";
  const showMobileMoney =
    locationPreferred === "mobile_money" ? fapshiEnabled : fapshiEnabled && !stripeEnabled;
  const showCard = locationPreferred === "card" ? stripeEnabled : stripeEnabled && !fapshiEnabled;

  // Savings badge: how much cheaper yearly is vs. paying monthly x12.
  const yearlyMonthlyEquivalent = priceUsdYearlyRaw / 12;
  const savingsPct =
    priceUsdMonthlyRaw > 0 ? Math.round((1 - yearlyMonthlyEquivalent / priceUsdMonthlyRaw) * 100) : 0;

  const startCard = async () => {
    setStep("card-redirecting");
    try {
      const res = await fetch("/api/billing/stripe/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planName, interval: billingInterval }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || "Could not start checkout");
      window.location.href = data.url;
    } catch (err: any) {
      setError(err.message);
      setStep("card-error");
    }
  };

  const pollStatus = (transId: string) => {
    pollTimer.current = setInterval(async () => {
      pollAttempts.current += 1;
      try {
        const res = await fetch(`/api/billing/fapshi/status/${transId}`);
        const data = await res.json();
        if (data.status === "SUCCESSFUL") {
          clearInterval(pollTimer.current);
          setReceipt({
            transId,
            amount: data.amount,
            medium: data.medium,
            date: data.dateConfirmed || new Date().toISOString(),
          });
          setStep("mm-success");
        } else if (data.status === "FAILED" || data.status === "EXPIRED") {
          clearInterval(pollTimer.current);
          setError(t.subscription.paymentFailed);
          setStep("mm-error");
        } else if (pollAttempts.current > 40) {
          // ~2 minutes of polling at 3s intervals — stop rather than poll forever
          clearInterval(pollTimer.current);
          setError(t.subscription.paymentFailed);
          setStep("mm-error");
        }
      } catch {
        // transient network error — keep polling, next tick may succeed
      }
    }, 3000);
  };

  const startMobileMoney = async (e: React.FormEvent) => {
    e.preventDefault();
    setStep("mm-processing");
    setError("");
    try {
      const res = await fetch("/api/billing/fapshi/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planName, phone, medium, interval: billingInterval }),
      });
      const data = await res.json();
      if (!res.ok || !data.transId) throw new Error(data.error || "Could not start payment");
      pollAttempts.current = 0;
      pollStatus(data.transId);
    } catch (err: any) {
      setError(err.message);
      setStep("mm-error");
    }
  };

  const closable = step !== "mm-processing" && step !== "card-redirecting";

  const copyReference = () => {
    if (!receipt) return;
    navigator.clipboard?.writeText(receipt.transId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/40" onClick={closable ? onClose : undefined} />
      <div
        className={`relative w-full rounded-card bg-ringo-surface border border-ringo-border p-6 ${
          step === "mm-success" ? "max-w-md" : "max-w-sm"
        }`}
      >
        {closable && (
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute right-4 top-4 text-ringo-muted hover:text-ringo-text"
          >
            <X size={18} />
          </button>
        )}

        {step === "choose" && (
          <>
            <h2 className="font-display text-lg font-medium text-ringo-text mb-4 capitalize">
              {t.subscription.choosePaymentMethod}
            </h2>

            <div className="flex items-center gap-1.5 mb-4 bg-ringo-bg rounded-card p-1 w-fit">
              {(["monthly", "yearly"] as Interval[]).map((i) => (
                <button
                  key={i}
                  onClick={() => setBillingInterval(i)}
                  className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-card transition ${
                    billingInterval === i ? "bg-ringo-surface text-ringo-indigo shadow-sm" : "text-ringo-muted"
                  }`}
                >
                  {i === "monthly" ? t.subscription.billingMonthly : t.subscription.billingYearly}
                  {i === "yearly" && savingsPct > 0 && (
                    <span className="text-[10px] font-medium text-ringo-teal bg-ringo-teal/10 px-1.5 py-0.5 rounded-full">
                      {t.subscription.saveBadge(savingsPct)}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-2.5">
              {showMobileMoney && (
                <button
                  onClick={() => {
                    setMethod("mobile_money");
                    setStep("mm-form");
                  }}
                  className={`flex items-center gap-3 rounded-card border p-3.5 text-left transition ${
                    method === "mobile_money"
                      ? "border-ringo-indigo bg-ringo-indigo/5"
                      : "border-ringo-border hover:border-ringo-indigo"
                  }`}
                >
                  <span className="w-9 h-9 rounded-full bg-ringo-teal/10 flex items-center justify-center shrink-0">
                    <Smartphone size={16} className="text-ringo-teal" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ringo-text">{t.subscription.mobileMoney}</p>
                    <p className="text-xs text-ringo-muted">{t.subscription.mobileMoneyDesc}</p>
                  </span>
                  <span className="text-sm font-medium text-ringo-text shrink-0">{priceXaf}</span>
                </button>
              )}

              {showCard && (
                <button
                  onClick={startCard}
                  className="flex items-center gap-3 rounded-card border border-ringo-border p-3.5 text-left transition hover:border-ringo-indigo"
                >
                  <span className="w-9 h-9 rounded-full bg-ringo-indigo/10 flex items-center justify-center shrink-0">
                    <CreditCard size={16} className="text-ringo-indigo" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ringo-text">{t.subscription.card}</p>
                    <p className="text-xs text-ringo-muted">{t.subscription.cardDesc}</p>
                  </span>
                  <span className="text-sm font-medium text-ringo-text shrink-0">{priceUsd}</span>
                </button>
              )}

              {!showMobileMoney && !showCard && (
                <p className="text-sm text-ringo-muted text-center py-3">{t.subscription.methodUnavailable}</p>
              )}
            </div>
          </>
        )}

        {step === "mm-form" && (
          <form onSubmit={startMobileMoney}>
            <button
              type="button"
              onClick={() => setStep("choose")}
              className="flex items-center gap-1 text-xs text-ringo-muted hover:text-ringo-text mb-4"
            >
              <ArrowLeft size={13} />
              {t.subscription.back}
            </button>
            <h2 className="font-display text-lg font-medium text-ringo-text mb-1 capitalize">
              {t.subscription.mobileMoney}
            </h2>
            <p className="text-sm text-ringo-muted mb-4">{priceXaf}</p>

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

            <button
              type="submit"
              className="w-full rounded-card bg-ringo-indigo text-white text-sm font-medium py-2.5"
            >
              {t.subscription.payNow}
            </button>
          </form>
        )}

        {(step === "mm-processing" || step === "card-redirecting") && (
          <div className="flex flex-col items-center text-center py-6 gap-3">
            <Loader2 size={28} className="animate-spin text-ringo-indigo" />
            <p className="text-sm font-medium text-ringo-text">
              {step === "card-redirecting" ? t.subscription.redirecting : t.subscription.waitingForConfirmation}
            </p>
            {step === "mm-processing" && (
              <p className="text-xs text-ringo-muted max-w-[220px]">{t.subscription.checkPhoneDesc}</p>
            )}
          </div>
        )}

        {step === "mm-success" && receipt && (
          <div className="flex flex-col items-center text-center gap-1 py-2">
            <span className="w-14 h-14 rounded-full bg-ringo-teal/10 flex items-center justify-center mb-2">
              <CheckCircle2 size={30} className="text-ringo-teal" />
            </span>
            <p className="font-display text-lg font-medium text-ringo-text capitalize">
              {t.subscription.paymentSuccess}
            </p>
            <p className="text-sm text-ringo-muted capitalize mb-4">
              {planName} {t.subscription.paymentSuccessDesc}
            </p>

            {/* Itemized receipt — mirrors what a customer expects from a
                real payment confirmation: what was bought, how, and a
                reference they can quote if they ever need support. */}
            <div className="w-full rounded-card border border-ringo-border bg-ringo-bg text-left overflow-hidden">
              <div className="flex items-center gap-2.5 px-4 py-3 border-b border-ringo-border">
                <img src="/logo.png" alt="" className="w-6 h-6 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ringo-text truncate">Ringo Connect</p>
                  <p className="text-[11px] text-ringo-muted">{t.subscription.receiptTitle}</p>
                </div>
              </div>

              <div className="px-4 py-3 flex flex-col gap-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-ringo-muted">{t.subscription.receiptPlan}</span>
                  <span className="text-sm font-medium text-ringo-text capitalize">
                    {planName} · {billingInterval === "yearly" ? t.subscription.billingYearly : t.subscription.billingMonthly}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-ringo-muted">{t.subscription.receiptMethod}</span>
                  <span className="text-sm font-medium text-ringo-text">
                    {receipt.medium === "orange money" ? t.subscription.orangeMoney : t.subscription.mtnMomo}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-ringo-muted flex items-center gap-1">
                    <CalendarDays size={12} />
                    {t.subscription.receiptDate}
                  </span>
                  <span className="text-sm font-medium text-ringo-text">
                    {new Date(receipt.date).toLocaleString(locale, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </span>
                </div>
              </div>

              <div className="border-t border-dashed border-ringo-border px-4 py-3 flex items-center justify-between">
                <span className="text-sm font-medium text-ringo-text">{t.subscription.receiptAmountPaid}</span>
                <span className="font-display text-base font-medium text-ringo-teal tabular-nums">
                  {formatPrice(receipt.amount, "XAF", locale)}
                </span>
              </div>

              <button
                onClick={copyReference}
                className="w-full flex items-center justify-between gap-3 px-4 py-2.5 border-t border-ringo-border bg-ringo-surface hover:bg-ringo-border/20 transition text-left"
              >
                <span className="text-xs text-ringo-muted flex items-center gap-1">
                  <Hash size={12} />
                  {t.subscription.receiptReference}
                </span>
                <span className="text-xs font-mono text-ringo-text flex items-center gap-1.5 shrink-0">
                  {receipt.transId}
                  {copied ? (
                    <Check size={12} className="text-ringo-teal" />
                  ) : (
                    <Copy size={12} className="text-ringo-muted" />
                  )}
                </span>
              </button>
            </div>

            <button
              onClick={onSuccess}
              className="w-full rounded-card bg-ringo-indigo text-white text-sm font-medium py-2.5 mt-4"
            >
              {t.subscription.done}
            </button>
          </div>
        )}

        {(step === "mm-error" || step === "card-error") && (
          <div className="flex flex-col items-center text-center py-4 gap-3">
            <p className="text-sm text-red-500">{error || t.subscription.paymentFailed}</p>
            <button
              onClick={() => setStep(step === "card-error" ? "choose" : "mm-form")}
              className="w-full rounded-card border border-ringo-border text-sm font-medium py-2.5"
            >
              {t.subscription.tryAgain}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}