"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, User, Building2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { formatPrice } from "@/lib/currency";

type Track = "personal" | "business";

// The two tracks a visitor can pick a plan from — the exact same split
// GetStartedFlow.tsx's own "accountType" step uses (plans.team_enabled
// false = Personal, true = Business), so a plan chosen here and a plan
// chosen mid-signup are always the same two groups. Business has
// deliberately no free tier (see the 2026-10-05 pricing migration) —
// someone wanting a free page picks Personal instead.
export default function PricingSection({ plans, isCameroon }: { plans: any[]; isCameroon: boolean }) {
  const { t, locale } = useLanguage();
  const [track, setTrack] = useState<Track>("personal");
  const [interval, setInterval_] = useState<"monthly" | "yearly">("monthly");

  const trackPlans = plans
    .filter((p) => Boolean(p.team_enabled) === (track === "business"))
    .sort((a, b) => Number(a.price_usd) - Number(b.price_usd));

  const getPrice = (plan: any) => {
    const key = isCameroon
      ? interval === "yearly"
        ? "price_xaf_yearly"
        : "price_xaf"
      : interval === "yearly"
      ? "price_usd_yearly"
      : "price_usd";
    return Number(plan[key]);
  };

  return (
    <div>
      <div className="flex flex-col items-center gap-5 mb-12">
        {/* Personal / Business track picker */}
        <div className="flex items-center gap-1 bg-ringo-muted/10 rounded-full p-1">
          {(
            [
              { id: "personal" as const, icon: User, label: t.landing.pricingTrackPersonal },
              { id: "business" as const, icon: Building2, label: t.landing.pricingTrackBusiness },
            ]
          ).map((opt) => (
            <button
              key={opt.id}
              onClick={() => setTrack(opt.id)}
              className={`flex items-center gap-1.5 text-sm font-medium px-5 py-2 rounded-full transition ${
                track === opt.id ? "bg-ringo-surface text-ringo-indigo shadow-sm" : "text-ringo-muted"
              }`}
            >
              <opt.icon size={14} />
              {opt.label}
            </button>
          ))}
        </div>
        <p className="text-sm text-ringo-muted -mt-2">
          {track === "personal" ? t.landing.pricingTrackPersonalDesc : t.landing.pricingTrackBusinessDesc}
        </p>

        {/* Monthly / yearly — every plan in both tracks (besides Free) has a real yearly price */}
        <div className="flex items-center gap-1 bg-ringo-muted/10 rounded-full p-1">
          {(["monthly", "yearly"] as const).map((iv) => (
            <button
              key={iv}
              onClick={() => setInterval_(iv)}
              className={`text-xs font-medium px-4 py-1.5 rounded-full transition ${
                interval === iv ? "bg-ringo-surface text-ringo-indigo shadow-sm" : "text-ringo-muted"
              }`}
            >
              {iv === "monthly" ? t.subscription.billingMonthly : t.subscription.billingYearly}
            </button>
          ))}
        </div>
      </div>

      <div className={`grid gap-5 max-w-5xl mx-auto ${trackPlans.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2 max-w-3xl"}`}>
        {trackPlans.map((plan) => {
          const features: string[] = (locale === "fr" ? plan.features_fr : plan.features_en) || [];
          const price = getPrice(plan);
          const isFeatured = plan.name === "pro" || plan.name === "business_pro";

          return (
            <div
              key={plan.id}
              className={`relative flex flex-col rounded-[22px] border bg-ringo-surface p-6 transition ${
                isFeatured ? "border-ringo-indigo shadow-[0_16px_40px_-16px_rgba(79,70,229,0.35)]" : "border-ringo-border/70"
              }`}
            >
              {isFeatured && (
                <span className="absolute -top-3 left-6 text-[10px] font-semibold uppercase tracking-wide px-2.5 py-1 rounded-full bg-ringo-indigo text-white">
                  {t.landing.pricingMostPopular}
                </span>
              )}

              <p className="font-display text-lg font-bold mb-1">{plan.display_name || plan.name}</p>
              <p className="mb-5" suppressHydrationWarning>
                <span className="text-3xl font-bold tracking-[-0.02em]">{formatPrice(price, isCameroon ? "XAF" : "USD", locale)}</span>
                {price > 0 && <span className="text-sm text-ringo-muted">{interval === "yearly" ? "/yr" : "/mo"}</span>}
              </p>

              {plan.max_team_seats != null && (
                <p className="text-xs font-medium text-ringo-indigo mb-4 -mt-3">{t.landing.pricingSeats(plan.max_team_seats)}</p>
              )}

              <ul className="flex flex-col gap-2.5 mb-8 flex-1">
                {features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-ringo-text">
                    <Check size={14} className="text-ringo-teal shrink-0 mt-0.5" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <Link
                href={`/get-started?plan=${plan.name}`}
                className={`text-center text-sm font-semibold py-3 rounded-full transition-all hover:-translate-y-0.5 ${
                  isFeatured ? "bg-ringo-indigo text-white shadow-[0_12px_28px_-8px_rgba(79,70,229,0.45)]" : "border border-ringo-border text-ringo-text hover:border-ringo-indigo"
                }`}
              >
                {t.landing.pricingCta}
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}
