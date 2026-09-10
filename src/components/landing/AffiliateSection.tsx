"use client";

import { ArrowRight, Link2, Share2, Coins, Wallet } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

// The real, existing affiliate system (/dashboard/affiliate) — a referral
// link, a commission on referred users' payments, and a Mobile Money
// payout. No commission rate is quoted since it's admin-configurable and
// could change. The CTA goes straight to WhatsApp rather than the
// self-serve /get-started-affiliate form — affiliate sign-ups are handled
// personally for now.
export default function AffiliateSection() {
  const { t } = useLanguage();
  const whatsappHref = `https://wa.me/237694028846?text=${encodeURIComponent(
    "Hi! I'd like to become a Ringo Connect affiliate."
  )}`;

  const points = [
    { icon: Link2, text: t.landing.affiliatePointLink },
    { icon: Share2, text: t.landing.affiliatePointShare },
    { icon: Coins, text: t.landing.affiliatePointEarn },
    { icon: Wallet, text: t.landing.affiliatePointPayout },
  ];

  return (
    <div
      className="relative overflow-hidden rounded-[28px] px-8 py-14 sm:px-16 sm:py-16 text-center"
      style={{ backgroundColor: "#0B0B12" }}
    >
      <div
        className="absolute -top-24 left-1/2 -translate-x-1/2 w-[520px] h-[260px] rounded-full blur-[100px] opacity-30"
        style={{ backgroundColor: "#F2B705" }}
        aria-hidden="true"
      />
      <div className="relative">
        <span className="inline-flex text-xs font-semibold tracking-[0.14em] uppercase mb-5" style={{ color: "#F2B705" }}>
          {t.landing.affiliateEyebrow}
        </span>
        <h2 className="font-display text-3xl sm:text-4xl font-medium tracking-[-0.02em] text-white mb-4 max-w-xl mx-auto">
          {t.landing.affiliateTitle}
        </h2>
        <p className="text-white/65 max-w-lg mx-auto mb-10">{t.landing.affiliateSubtitle}</p>

        <div className="grid sm:grid-cols-4 gap-4 mb-10 max-w-3xl mx-auto">
          {points.map((p, i) => (
            <div key={i} className="flex flex-col items-center gap-2.5">
              <span
                className="w-11 h-11 rounded-full flex items-center justify-center"
                style={{ backgroundColor: "rgba(242,183,5,0.12)", color: "#F2B705" }}
              >
                <p.icon size={17} />
              </span>
              <span className="text-xs text-white/75 leading-snug">{p.text}</span>
            </div>
          ))}
        </div>

        <a
          href={whatsappHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-6 py-3 rounded-full text-sm font-semibold transition-transform hover:-translate-y-0.5"
          style={{ backgroundColor: "#F2B705", color: "#171009" }}
        >
          {t.landing.affiliateCta}
          <ArrowRight size={14} />
        </a>
      </div>
    </div>
  );
}
