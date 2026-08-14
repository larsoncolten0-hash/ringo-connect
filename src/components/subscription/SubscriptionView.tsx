"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { formatPrice } from "@/lib/currency";
import { isPaidPlan } from "@/lib/pricing";
import UpgradeModal from "./UpgradeModal";

const ORDER = ["free", "basic", "pro", "business"];

export default function SubscriptionView({
  plans,
  currentPlan,
  currentInterval,
  paymentProvider,
  planExpiresAt,
  defaultMethod,
  isCameroon,
  fapshiEnabled,
  stripeEnabled,
  isOnboarding = false,
}: {
  plans: any[];
  currentPlan: string;
  currentInterval: "monthly" | "yearly";
  paymentProvider: "stripe" | "fapshi" | null;
  planExpiresAt: string | null;
  defaultMethod: "mobile_money" | "card";
  isCameroon: boolean;
  fapshiEnabled: boolean;
  stripeEnabled: boolean;
  isOnboarding?: boolean;
}) {
  const router = useRouter();
  const { t, locale } = useLanguage();
  const [modalPlan, setModalPlan] = useState<any | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [interval, setIntervalState] = useState<"monthly" | "yearly">("monthly");

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
        {isOnboarding ? t.subscription.onboardingEyebrow : t.subscription.eyebrow}
      </p>
      <h1 className="font-display text-2xl font-medium text-ringo-text tracking-[-0.01em] mb-1">
        {isOnboarding ? t.subscription.onboardingTitle : t.subscription.title}
      </h1>
      <p className="text-sm text-ringo-muted mb-6 max-w-md">
        {isOnboarding ? t.subscription.onboardingSubtitle : t.subscription.subtitle}
      </p>

      {/* Page-level billing interval toggle — affects the price shown on
          every card and the interval a new upgrade defaults to. */}
      <div className="flex items-center gap-1.5 mb-8 bg-ringo-muted/10 rounded-card p-1 w-fit">
        {(["monthly", "yearly"] as const).map((i) => {
          const pro = sortedPlans.find((p) => p.name === "pro");
          const monthlyBase = isCameroon ? Number(pro?.price_xaf) : Number(pro?.price_usd);
          const yearlyBase = isCameroon ? Number(pro?.price_xaf_yearly) : Number(pro?.price_usd_yearly);
          const savingsPct = pro && monthlyBase > 0 ? Math.round((1 - yearlyBase / 12 / monthlyBase) * 100) : 0;
          return (
            <button
              key={i}
              onClick={() => setIntervalState(i)}
              className={`flex items-center gap-1.5 text-sm font-medium px-4 py-1.5 rounded-card transition ${
                interval === i ? "bg-ringo-surface text-ringo-indigo shadow-sm" : "text-ringo-muted"
              }`}
            >
              {i === "monthly" ? t.subscription.billingMonthly : t.subscription.billingYearly}
              {i === "yearly" && savingsPct > 0 && (
                <span className="text-[10px] font-medium text-ringo-teal bg-ringo-teal/10 px-1.5 py-0.5 rounded-full">
                  {t.subscription.saveBadge(savingsPct)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="grid sm:grid-cols-3 gap-5">
        {sortedPlans.map((plan) => {
          const copy = (t.plans as any)[plan.name] ?? { tagline: "" };
          const features: string[] =
            (locale === "fr" ? plan.features_fr : plan.features_en) || [];
          const rawPrice = isCameroon
            ? interval === "yearly"
              ? plan.price_xaf_yearly
              : plan.price_xaf
            : interval === "yearly"
            ? plan.price_usd_yearly
            : plan.price_usd;
          const displayPrice = isPaidPlan(plan.name)
            ? formatPrice(rawPrice, isCameroon ? "XAF" : "USD", locale)
            : formatPrice(0, isCameroon ? "XAF" : "USD", locale);
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
                {plan.display_name || plan.name}
              </p>
              <p className="text-xs text-ringo-muted mb-4">{copy.tagline}</p>
              <p className="text-2xl font-display font-medium text-ringo-text tabular-nums tracking-[-0.02em] mb-5">
                {displayPrice}
                {isPaidPlan(plan.name) && (
                  <span className="text-xs text-ringo-muted font-normal">
                    {interval === "yearly" ? t.subscription.perYear : t.subscription.perMonth}
                  </span>
                )}
              </p>

              <ul className="flex flex-col gap-2 mb-6 flex-1">
                {features.map((f: string) => (
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
                isOnboarding ? (
                  <button
                    onClick={() => router.push("/dashboard")}
                    className="text-sm font-medium py-2.5 rounded-card bg-ringo-indigo text-white hover:bg-ringo-indigo/90"
                  >
                    {isPaidPlan(plan.name)
                      ? `${t.subscription.continueWith} ${plan.display_name || plan.name}`
                      : t.subscription.continueFree}
                  </button>
                ) : (
                  <div className="text-center text-xs font-medium text-ringo-teal py-2.5 rounded-card bg-ringo-teal/10">
                    {t.subscription.currentPlan}
                    {isPaidPlan(plan.name) && (
                      <span className="block text-[10px] font-normal text-ringo-muted mt-0.5 capitalize">
                        {currentInterval === "yearly" ? t.subscription.billingYearly : t.subscription.billingMonthly}
                      </span>
                    )}
                  </div>
                )
              ) : isDowngrade ? (
                <button
                  onClick={handleDowngrade}
                  disabled={cancelling}
                  className="text-sm font-medium py-2.5 rounded-card border border-ringo-border text-ringo-text hover:border-ringo-indigo disabled:opacity-50"
                >
                  {t.subscription.downgrade} {t.subscription.to} {plan.display_name || plan.name}
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
                  {isOnboarding
                    ? `${t.subscription.continueWith} ${plan.display_name || plan.name}`
                    : `${t.subscription.upgrade} ${t.subscription.to} ${plan.display_name || plan.name}`}
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
          priceXafYearly={Number(modalPlan.price_xaf_yearly)}
          priceUsdYearly={Number(modalPlan.price_usd_yearly)}
          defaultMethod={defaultMethod}
          defaultInterval={interval}
          fapshiEnabled={fapshiEnabled}
          stripeEnabled={stripeEnabled}
          onClose={() => setModalPlan(null)}
          onSuccess={() => {
            setModalPlan(null);
            if (isOnboarding) {
              router.push("/dashboard");
            } else {
              router.refresh();
            }
          }}
        />
      )}
    </div>
  );
}