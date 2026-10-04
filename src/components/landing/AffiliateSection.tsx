"use client";

import { ArrowRight, Link2, Share2, Coins, Wallet } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { secondaryButton } from "./Section";

// The real, existing affiliate system (/dashboard/affiliate): a referral link, a commission on referred users' payments, and a
// Mobile Money payout. No commission rate is quoted since it is admin-configurable and could change. The CTA goes straight to
// WhatsApp rather than the self-serve /get-started-affiliate form: affiliate sign-ups are handled personally for now.
// Presented as part of the page (a quiet panel in the Ringo system), not as a separate dark affiliate product.
export default function AffiliateSection() {
  const { t } = useLanguage();
  const whatsappHref = `https://wa.me/237694028846?text=${encodeURIComponent("Hi! I'd like to become a Ringo Connect affiliate.")}`;

  const points = [
    { icon: Link2, text: t.landing.affiliatePointLink },
    { icon: Share2, text: t.landing.affiliatePointShare },
    { icon: Coins, text: t.landing.affiliatePointEarn },
    { icon: Wallet, text: t.landing.affiliatePointPayout },
  ];

  return (
    <div className="grid items-center gap-10 rounded-ringo-xl border border-ringo-line-warm bg-ringo-surface p-8 sm:p-12 lg:grid-cols-2 lg:gap-16">
      <div>
        <h2 className="ringo-display text-[1.75rem] font-semibold leading-[1.1] tracking-[-0.02em] text-balance sm:text-4xl">{t.landing.affiliateTitle}</h2>
        <p className="mt-4 max-w-md leading-relaxed text-ringo-muted">{t.landing.affiliateSubtitle}</p>
        <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className={`${secondaryButton} mt-8`}>
          {t.landing.affiliateCta}
          <ArrowRight size={14} />
        </a>
      </div>
      <ul className="flex flex-col gap-4">
        {points.map((p, i) => (
          <li key={i} className="flex items-start gap-3.5 text-sm leading-relaxed text-ringo-text">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-ringo-sm bg-ringo-gold/15 text-ringo-gold-text">
              <p.icon size={17} />
            </span>
            <span className="pt-2">{p.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
