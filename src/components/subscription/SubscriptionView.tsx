"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { formatPrice } from "@/lib/currency";
import { isPaidPlan } from "@/lib/pricing";
import UpgradeModal from "./UpgradeModal";

const ORDER = ["free", "pro", "business"];

export default function SubscriptionView({
  plans,
  currentPlan,
  paymentProvider,
  planExpiresAt,
  defaultMethod,
}: {
  plans: any[];
  currentPlan: string;
  paymentProvider: "stripe" | "fapshi" | null;
  planExpiresAt: string | null;
  defaultMethod: "mobile_money" | "card";
}) {
  const router = useRouter();
  const { t, locale } = useLanguage();
  const [modalPlan, setModalPlan] = useState<any | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const sortedPlans = [...plans].sort((a, b) => ORDER.indexOf(a.name) - ORDER.indexOf(b.name));

  const handleDowngrade = async () => {
    setCancelling(true);
    await fetch("/api/billing/cancel", { method: "POST" });
    setCancelling(false);
    router.refresh();
  };

  return (
    <div className="max-w-4xl">
      <p className="text-xs font-medium tracking-wide uppercase text-ringo-indigo mb-2">
        {t.subscription.eyebrow}
      </p>
      <h1 className="font-display text-2xl font-medium text-ringo-text tracking-[-0.01em] mb-1">
        {t.subscription.title}
      </h1>
      <p className="text-sm text-ringo-muted mb-10 max-w-md">{t.subscription.subtitle}</p>

      <div className="grid sm:grid-cols-3 gap-5">
        {sortedPlans.map((plan) => {
          const copy = (t.plans as any)[plan.name] ?? { tagline: "", features: [] };
          const priceUsd = isPaidPlan(plan.name) ? formatPrice(plan.price_usd, "USD", locale) : formatPrice(0, "USD", locale);
          const isCurrent = plan.name === currentPlan;
          const isRecommended = plan.name === "pro";
          const isDowngrade = ORDER.indexOf(plan.name) < ORDER.indexOf(currentPlan);
          const isFapshiCurrentAndPaid = isCurrent && paymentProvider === "fapshi" && isPaidPlan(plan.name);

          return (
            <div
              key={plan.id}
              className={`relative rounded-card p-5 flex flex-col transition-all hover:-translate-y-0.5 ${
                isRecommended
                  ? "border-2 border-ringo-indigo shadow-[0_8px_30px_-8px_rgba(79,70,229,0.35)]"
                  : "border border-ringo-border/70 shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:shadow-[0_4px_16px_-4px_rgba(15,23,42,0.08)]"
              } ${isCurrent ? "ring-2 ring-ringo-teal ring-offset-2 ring-offset-ringo-bg" : ""} bg-ringo-surface`}
            >
              {isRecommended && (
                <span className="absolute -top-3 left-5 text-[11px] font-medium bg-ringo-indigo text-white px-2.5 py-1 rounded-full">
                  {t.subscription.recommended}
                </span>
              )}

              <p className="font-display text-lg font-medium text-ringo-text capitalize tracking-[-0.01em] mb-0.5">
                {plan.name}
              </p>
              <p className="text-xs text-ringo-muted mb-4">{copy.tagline}</p>
              <p className="text-2xl font-display font-medium text-ringo-text tabular-nums tracking-[-0.02em] mb-5">
                {priceUsd}
                {isPaidPlan(plan.name) && <span className="text-xs text-ringo-muted font-normal">/mo</span>}
              </p>

              <ul className="flex flex-col gap-2 mb-6 flex-1">
                {copy.features.map((f: string) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-ringo-text">
                    <Check size={15} className="text-ringo-teal shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>

              {isFapshiCurrentAndPaid ? (
                <div className="flex flex-col gap-2">
                  {planExpiresAt && (
                    <p className="text-[11px] text-ringo-muted text-center">
                      {t.subscription.expiresOn(new Date(planExpiresAt).toLocaleDateString(locale))}
                    </p>
                  )}
                  <button
                    onClick={() => setModalPlan(plan)}
                    className="text-sm font-medium py-2.5 rounded-card border border-ringo-border text-ringo-text hover:border-ringo-indigo"
                  >
                    {t.subscription.renewNow}
                  </button>
                </div>
              ) : isCurrent ? (
                <div className="text-center text-xs font-medium text-ringo-teal py-2.5 rounded-card bg-ringo-teal/10">
                  {t.subscription.currentPlan}
                </div>
              ) : isDowngrade ? (
                <button
                  onClick={handleDowngrade}
                  disabled={cancelling}
                  className="text-sm font-medium py-2.5 rounded-card border border-ringo-border text-ringo-text hover:border-ringo-indigo disabled:opacity-50"
                >
                  {t.subscription.downgrade} {t.subscription.to} {plan.name}
                </button>
              ) : (
                <button
                  onClick={() => setModalPlan(plan)}
                  className={`text-sm font-medium py-2.5 rounded-card transition ${
                    isRecommended
                      ? "bg-ringo-indigo text-white hover:bg-ringo-indigo/90"
                      : "border border-ringo-border text-ringo-text hover:border-ringo-indigo"
                  }`}
                >
                  {t.subscription.upgrade} {t.subscription.to} {plan.name}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {modalPlan && (
        <UpgradeModal
          planName={modalPlan.name}
          priceXaf={Number(modalPlan.price_xaf)}
          priceUsd={Number(modalPlan.price_usd)}
          defaultMethod={defaultMethod}
          onClose={() => setModalPlan(null)}
          onSuccess={() => {
            setModalPlan(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}