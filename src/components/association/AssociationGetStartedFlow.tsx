"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Award } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { formatPrice } from "@/lib/currency";
import AssociationPaymentModal from "./AssociationPaymentModal";

const ORDER = ["association_basic", "association_pro", "association_premium"];

export default function AssociationGetStartedFlow({
  isAuthenticated,
  plans,
  fapshiEnabled,
  currentPlanName,
}: {
  isAuthenticated: boolean;
  plans: any[];
  fapshiEnabled: boolean;
  currentPlanName: string | null;
}) {
  const router = useRouter();
  const { t, locale } = useLanguage();
  const a = t.association;
  const [interval, setIntervalState] = useState<"monthly" | "yearly">("monthly");
  const [modalPlan, setModalPlan] = useState<any | null>(null);
  const [done, setDone] = useState(false);

  const sortedPlans = [...plans].sort((x, y) => ORDER.indexOf(x.name) - ORDER.indexOf(y.name));

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-sm text-center flex flex-col items-center gap-4">
          <Award size={32} className="text-ringo-indigo" />
          <h1 className="font-display text-xl font-bold text-ringo-text">{a.entryFlowTitle}</h1>
          <p className="text-sm text-ringo-muted">{a.entryFlowNeedsAccountBody}</p>
          <div className="flex flex-col gap-2 w-full">
            <Link href="/auth/signup" className="w-full text-center rounded-card bg-ringo-indigo text-white text-sm font-medium py-2.5">
              {a.entryFlowCreateAccount}
            </Link>
            <Link href="/auth/login" className="w-full text-center rounded-card border border-ringo-border text-sm font-medium py-2.5 text-ringo-text">
              {a.entryFlowLogIn}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-sm text-center flex flex-col items-center gap-4">
          <span className="w-16 h-16 rounded-full bg-ringo-teal/10 flex items-center justify-center">
            <Check size={28} className="text-ringo-teal" />
          </span>
          <h1 className="font-display text-xl font-bold text-ringo-text">{a.entryFlowSuccessTitle}</h1>
          <button onClick={() => router.push("/dashboard/association")} className="w-full rounded-card bg-ringo-indigo text-white text-sm font-medium py-2.5">
            {a.entryFlowGoToDashboard}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-4 py-10">
      <div className="max-w-4xl mx-auto">
        <p className="text-xs font-medium tracking-wide uppercase text-ringo-indigo mb-2 text-center">{a.entryFlowEyebrow}</p>
        <h1 className="font-display text-2xl font-medium text-ringo-text tracking-[-0.01em] mb-1 text-center">{a.entryFlowTitle}</h1>
        <p className="text-sm text-ringo-muted mb-8 max-w-md mx-auto text-center">{a.entryFlowSubtitle}</p>

        <div className="flex items-center justify-center gap-1.5 mb-8 bg-ringo-muted/10 rounded-card p-1 w-fit mx-auto">
          {(["monthly", "yearly"] as const).map((i) => (
            <button
              key={i}
              onClick={() => setIntervalState(i)}
              className={`text-sm font-medium px-4 py-1.5 rounded-card transition ${interval === i ? "bg-ringo-surface text-ringo-indigo shadow-sm" : "text-ringo-muted"}`}
            >
              {i === "monthly" ? t.subscription.billingMonthly : t.subscription.billingYearly}
            </button>
          ))}
        </div>

        <div className="grid sm:grid-cols-3 gap-5 mb-6">
          {sortedPlans.map((plan) => {
            const features: string[] = (locale === "fr" ? plan.features_fr : plan.features_en) || [];
            const price = interval === "yearly" ? plan.price_xaf_yearly : plan.price_xaf;
            const isCurrent = plan.name === currentPlanName;
            const isRecommended = plan.name === "association_pro";

            return (
              <div
                key={plan.id}
                className={`relative rounded-[20px] p-5 flex flex-col ${isRecommended ? "border-2 border-ringo-indigo shadow-[0_16px_40px_-12px_rgba(79,70,229,0.4)]" : "border border-ringo-border"}`}
              >
                {isRecommended && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] font-semibold uppercase tracking-wide bg-ringo-indigo text-white px-2.5 py-1 rounded-full">
                    {a.recommendedBadge}
                  </span>
                )}
                <p className="text-base font-semibold text-ringo-text mb-1">{plan.display_name}</p>
                <p className="text-2xl font-bold text-ringo-text mb-3 tabular-nums">{formatPrice(price, "XAF", locale)}</p>
                <ul className="flex flex-col gap-1.5 mb-5 flex-1">
                  {features.map((f) => (
                    <li key={f} className="flex items-start gap-1.5 text-xs text-ringo-muted">
                      <Check size={12} className="text-ringo-teal shrink-0 mt-0.5" /> {f}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => setModalPlan(plan)}
                  disabled={isCurrent}
                  className="w-full py-2.5 rounded-card bg-ringo-indigo text-white text-sm font-medium disabled:opacity-50"
                >
                  {isCurrent ? a.currentPlanLabel : a.choosePlanCta}
                </button>
              </div>
            );
          })}
        </div>

        <div className="max-w-sm mx-auto rounded-2xl border border-dashed border-ringo-border p-5 text-center">
          <p className="text-sm font-medium text-ringo-text mb-1">{a.contactUsTierTitle}</p>
          <p className="text-xs text-ringo-muted mb-3">{a.contactUsTierBody}</p>
          <a href="mailto:hello@ringoconnectltd.com" className="text-sm font-medium text-ringo-indigo hover:underline">
            {a.contactUsCta}
          </a>
        </div>
      </div>

      {modalPlan && fapshiEnabled && (
        <AssociationPaymentModal
          planName={modalPlan.name}
          displayName={modalPlan.display_name}
          priceXaf={interval === "yearly" ? modalPlan.price_xaf_yearly : modalPlan.price_xaf}
          interval={interval}
          onClose={() => setModalPlan(null)}
          onSuccess={() => {
            setModalPlan(null);
            setDone(true);
          }}
        />
      )}
    </div>
  );
}
